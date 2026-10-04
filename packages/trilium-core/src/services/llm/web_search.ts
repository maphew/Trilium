/**
 * Web search through a search provider the user configured (`kind: "search"` in the
 * `llmProviders` option), offered to the model as a `web_search` tool in place of the model's
 * built-in search, with a `read_web_page` tool to read what it finds.
 */

import { tool } from "ai";
import { parse as parseHtml } from "node-html-parser";
import { z } from "zod";

import markdownExport from "../export/markdown.js";
import request, { validateFetchableUrl } from "../request.js";
import { decodeUtf8 } from "../utils/binary.js";
import { llmFetch } from "./providers/fetch.js";

/** A configured search provider, as stored in the `llmProviders` option. */
export interface WebSearchSetup {
    provider: string;
    /** The name the user sees the provider by; the provider type stands in when absent. */
    name?: string;
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
 * line and the `searchProvider` whose mark the line shows, and a failure is returned as
 * `{ error }` so the model can tell the user about it.
 */
export function createWebSearchTool(setup: WebSearchSetup) {
    return tool({
        description: "Search the web for current information. Returns the title, URL and an excerpt of each matching page.",
        inputSchema: z.object({
            query: z.string().describe("The search query")
        }),
        execute: async ({ query }) => {
            try {
                return {
                    query,
                    searchProvider: { type: setup.provider, name: setup.name ?? setup.provider },
                    sources: await searchWeb(setup, query)
                };
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

const MAX_PAGE_BYTES = 5 * 1024 * 1024;
const MAX_PAGE_CHARS = 20_000;
const HTML_TYPES = new Set([ "text/html", "application/xhtml+xml" ]);
const TEXT_TYPES = new Set([ "text/plain", "text/markdown" ]);
/** Elements that are page furniture rather than content. */
const NON_CONTENT = "script, style, noscript, template, svg, iframe, nav, header, footer, aside, form";

/**
 * The `read_web_page` tool. Its result is the page as Markdown, which the chat previews under the
 * tool's line; a failure is returned as `{ error }` so the model can tell the user about it.
 */
export function createReadWebPageTool() {
    return tool({
        description: "Read a web page, such as a web search result or a link the user gave, as Markdown. Long pages are cut off.",
        inputSchema: z.object({
            url: z.string().describe("The http(s) URL of the page")
        }),
        execute: async ({ url }) => {
            try {
                return await readWebPage(url);
            } catch (e) {
                return { error: e instanceof Error ? e.message : String(e) };
            }
        }
    });
}

/**
 * The page at `url` as Markdown, cut off at {@link MAX_PAGE_CHARS}.
 *
 * The URL is the model's to choose, and a note or a search result can steer it, so the page is
 * fetched with `fetchResource()`: the policy for addresses that arrive in content, which refuses
 * private networks, vets each redirect and caps the body.
 */
export async function readWebPage(url: string): Promise<string> {
    const response = await request.fetchResource(validateFetchableUrl(url).toString(), {
        maxBytes: MAX_PAGE_BYTES,
        headers: { "Accept": "text/html, application/xhtml+xml, text/plain;q=0.9" }
    });
    if (!response.ok) {
        throw new Error(`The page answered HTTP ${response.status}.`);
    }
    const contentType = response.contentType || "text/html";
    let content: string;
    if (HTML_TYPES.has(contentType)) {
        content = htmlToMarkdown(decodeUtf8(response.bytes));
    } else if (TEXT_TYPES.has(contentType)) {
        content = decodeUtf8(response.bytes).trim();
    } else {
        throw new Error(`The page is ${contentType}, which can't be read as text.`);
    }
    return content.length > MAX_PAGE_CHARS
        ? `${content.slice(0, MAX_PAGE_CHARS)}\n\n[The page continues; only its first ${MAX_PAGE_CHARS} characters are shown.]`
        : content;
}

/** The content of a page as Markdown, headed by its title: its `main` or `article` where it has one. */
function htmlToMarkdown(html: string): string {
    const root = parseHtml(html);
    const title = root.querySelector("title")?.textContent.trim();
    for (const element of root.querySelectorAll(NON_CONTENT)) {
        element.remove();
    }
    const content = root.querySelector("main, article, [role=main]") ?? root.querySelector("body") ?? root;
    const markdown = markdownExport.toMarkdown(content.innerHTML, { headerlessTables: "emptyHeader" }).trim();
    return title ? `# ${title}\n\n${markdown}` : markdown;
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
