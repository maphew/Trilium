/**
 * Web search through a search provider the user configured (`kind: "search"` in the
 * `llmProviders` option), offered to the model as a `web_search` tool in place of the model's
 * built-in search.
 */

import { tool } from "ai";
import { z } from "zod";

import { llmFetch } from "./providers/fetch.js";

/** A configured search provider, as stored in the `llmProviders` option. */
export interface WebSearchSetup {
    provider: string;
    apiKey: string;
    baseURL?: string;
}

export interface WebSearchSource {
    title: string;
    url: string;
    snippet: string;
}

const MAX_RESULTS = 8;
const SEARCH_TIMEOUT_MS = 30_000;

/**
 * The `web_search` tool for `setup`. Its result has the `sources` the chat lists under the tool's
 * line, and a failure is returned as `{ error }` so the model can tell the user about it.
 */
export function createWebSearchTool(setup: WebSearchSetup) {
    return tool({
        description: "Search the web for current information. Returns the title, URL and an excerpt of each matching page.",
        inputSchema: z.object({
            query: z.string().describe("The search query")
        }),
        execute: async ({ query }) => {
            try {
                return { query, sources: await searchWeb(setup, query) };
            } catch (e) {
                return { error: e instanceof Error ? e.message : String(e) };
            }
        }
    });
}

/**
 * Run `query` against the search provider in `setup`.
 *
 * A switch over literal cases, as `createProviderInstance()` is, because the provider type is
 * user-controlled.
 */
export async function searchWeb(setup: WebSearchSetup, query: string): Promise<WebSearchSource[]> {
    switch (setup.provider) {
        case "brave": {
            const base = setup.baseURL ?? "https://api.search.brave.com/res/v1";
            const params = new URLSearchParams({ q: query, count: String(MAX_RESULTS) });
            const payload = await requestJson(`${base}/web/search?${params}`, {
                headers: { "Accept": "application/json", "X-Subscription-Token": setup.apiKey }
            }) as { web?: { results?: unknown[] } };
            return toSources(payload.web?.results, "description");
        }
        case "tavily": {
            const payload = await requestJson(`${setup.baseURL ?? "https://api.tavily.com"}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${setup.apiKey}` },
                body: JSON.stringify({ query, max_results: MAX_RESULTS })
            }) as { results?: unknown[] };
            return toSources(payload.results, "content");
        }
        case "exa": {
            const payload = await requestJson(`${setup.baseURL ?? "https://api.exa.ai"}/search`, {
                method: "POST",
                headers: { "Content-Type": "application/json", "x-api-key": setup.apiKey },
                body: JSON.stringify({ query, numResults: MAX_RESULTS, contents: { text: { maxCharacters: 1000 } } })
            }) as { results?: unknown[] };
            return toSources(payload.results, "text");
        }
        case "searxng": {
            if (!setup.baseURL) {
                throw new Error("The SearXNG search provider has no address.");
            }
            const params = new URLSearchParams({ q: query, format: "json" });
            const payload = await requestJson(`${setup.baseURL.replace(/\/+$/, "")}/search?${params}`, {
                headers: { "Accept": "application/json", ...(setup.apiKey && { "Authorization": `Bearer ${setup.apiKey}` }) }
            }) as { results?: unknown[] };
            return toSources(payload.results, "content").slice(0, MAX_RESULTS);
        }
        default:
            throw new Error(`Unknown search provider type: ${setup.provider}`);
    }
}

async function requestJson(url: string, init: RequestInit): Promise<unknown> {
    const response = await llmFetch(url, { ...init, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error(`The search provider refused the request (HTTP ${response.status}); check its API key in the AI settings.`);
        }
        throw new Error(`The search provider answered HTTP ${response.status}.`);
    }
    return await response.json();
}

/** The results that carry a web URL, with the excerpt read from `snippetField`. */
function toSources(results: unknown[] | undefined, snippetField: string): WebSearchSource[] {
    const sources: WebSearchSource[] = [];
    for (const result of results ?? []) {
        const { title, url, [snippetField]: snippet } = (result ?? {}) as Record<string, unknown>;
        if (typeof url === "string" && /^https?:\/\//i.test(url)) {
            sources.push({
                title: typeof title === "string" ? title : url,
                url,
                snippet: typeof snippet === "string" ? snippet : ""
            });
        }
    }
    return sources;
}
