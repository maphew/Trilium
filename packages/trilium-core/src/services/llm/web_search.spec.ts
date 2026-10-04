import { afterEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
vi.mock("./providers/fetch.js", () => ({ llmFetch: fetchMock }));

import { createWebSearchTool, searchWeb } from "./web_search.js";

function respond(body: unknown, status = 200) {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify(body), { status }));
}

/** The URL and init of the one request the search made. */
function request() {
    expect(fetchMock).toHaveBeenCalledOnce();
    const [ url, init ] = fetchMock.mock.calls[0] as [ string, RequestInit ];
    return { url, init, headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(init.body as string) : undefined };
}

const PAGE = { title: "Trilium", url: "https://triliumnotes.org" };

afterEach(() => {
    fetchMock.mockReset();
});

describe("searchWeb", () => {
    it("queries Brave with its subscription token and reads its descriptions", async () => {
        respond({ web: { results: [ { ...PAGE, description: "Notes" } ] } });
        const sources = await searchWeb({ provider: "brave", apiKey: "bk" }, "trilium notes");

        const { url, headers } = request();
        expect(url).toBe("https://api.search.brave.com/res/v1/web/search?q=trilium+notes&count=8");
        expect(headers["X-Subscription-Token"]).toBe("bk");
        expect(sources).toEqual([ { ...PAGE, snippet: "Notes" } ]);
    });

    it("posts to Tavily and Exa with their keys, honoring a base URL override", async () => {
        respond({ results: [ { ...PAGE, content: "From Tavily" } ] });
        expect(await searchWeb({ provider: "tavily", apiKey: "tk", baseURL: "https://proxy.example" }, "q"))
            .toEqual([ { ...PAGE, snippet: "From Tavily" } ]);
        const tavily = request();
        expect(tavily.url).toBe("https://proxy.example/search");
        expect(tavily.init.method).toBe("POST");
        expect(tavily.headers.Authorization).toBe("Bearer tk");
        expect(tavily.body).toEqual({ query: "q", max_results: 8 });

        fetchMock.mockReset();
        respond({ results: [ { ...PAGE, text: "From Exa" } ] });
        expect(await searchWeb({ provider: "exa", apiKey: "ek" }, "q")).toEqual([ { ...PAGE, snippet: "From Exa" } ]);
        const exa = request();
        expect(exa.url).toBe("https://api.exa.ai/search");
        expect(exa.headers["x-api-key"]).toBe("ek");
        expect(exa.body).toMatchObject({ query: "q", numResults: 8 });
    });

    it("asks SearXNG for JSON, sends a key only when there is one, and keeps web URLs only", async () => {
        respond({ results: [ { ...PAGE, content: "Hit" }, { title: "Local", url: "file:///etc/passwd" }, { url: "https://untitled.example" } ] });
        const sources = await searchWeb({ provider: "searxng", apiKey: "", baseURL: "http://localhost:8888/" }, "q");

        const { url, headers } = request();
        expect(url).toBe("http://localhost:8888/search?q=q&format=json");
        expect(headers).not.toHaveProperty("Authorization");
        expect(sources).toEqual([
            { ...PAGE, snippet: "Hit" },
            { title: "https://untitled.example", url: "https://untitled.example", snippet: "" }
        ]);

        await expect(searchWeb({ provider: "searxng", apiKey: "" }, "q")).rejects.toThrow("has no address");
    });

    it("names a refused key, any other HTTP failure, and an unknown provider type", async () => {
        respond({}, 401);
        await expect(searchWeb({ provider: "brave", apiKey: "bad" }, "q")).rejects.toThrow("check its API key");
        respond({}, 500);
        await expect(searchWeb({ provider: "brave", apiKey: "bk" }, "q")).rejects.toThrow("HTTP 500");
        await expect(searchWeb({ provider: "bing", apiKey: "" }, "q")).rejects.toThrow("Unknown search provider type: bing");
    });
});

describe("createWebSearchTool", () => {
    const run = (tool: ReturnType<typeof createWebSearchTool>, query: string) =>
        tool.execute?.({ query }, { toolCallId: "1", messages: [], context: {} });

    it("returns the query and its sources, or the failure for the model to report", async () => {
        const tool = createWebSearchTool({ provider: "tavily", apiKey: "tk" });

        respond({ results: [ { ...PAGE, content: "Hit" } ] });
        expect(await run(tool, "trilium")).toEqual({ query: "trilium", sources: [ { ...PAGE, snippet: "Hit" } ] });

        respond({}, 403);
        expect(await run(tool, "trilium")).toEqual({ error: expect.stringContaining("HTTP 403") });
    });
});
