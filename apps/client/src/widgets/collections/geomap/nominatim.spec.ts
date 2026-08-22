/**
 * The Nominatim geocoder: the request it makes, what it makes of the answer, and the rate its usage
 * policy holds it to.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { nominatim as provider } from "./nominatim";

vi.mock("../../../services/i18n", () => ({ getCurrentLanguage: () => "pt_br" }));

/** One entry as Nominatim's `jsonv2` answer carries it. */
function place(overrides: Record<string, unknown> = {}) {
    return {
        place_id: 240109189,
        display_name: "Berlin, Germany",
        lat: "52.5170365",
        lon: "13.3888599",
        ...overrides
    };
}

function respondWith(body: unknown, init: { ok?: boolean; status?: number } = {}) {
    const fetchMock = vi.fn(async (_url: string) => ({
        ok: init.ok ?? true,
        status: init.status ?? 200,
        statusText: "",
        json: async () => body
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

/** Runs a search, letting the rate limiter's wait elapse rather than sitting through it. */
async function search(query: string) {
    const results = provider.search(query);
    await vi.runAllTimersAsync();
    return results;
}

function requestedUrl(fetchMock: ReturnType<typeof respondWith>) {
    return new URL(fetchMock.mock.calls[0][0]);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe("Nominatim geocoding", () => {
    it("asks Nominatim for the query, capped, in the language the app runs in", async () => {
        const fetchMock = respondWith([]);

        await search("berlin");

        const url = requestedUrl(fetchMock);
        expect(url.origin + url.pathname).toBe("https://nominatim.openstreetmap.org/search");
        expect(url.searchParams.get("q")).toBe("berlin");
        expect(url.searchParams.get("format")).toBe("jsonv2");
        expect(Number(url.searchParams.get("limit"))).toBeGreaterThan(0);
        // Written as a language tag rather than as Trilium's own locale id.
        expect(url.searchParams.get("accept-language")).toBe("pt-br");
    });

    it("takes the places from the answer, and leaves out any without a readable position", async () => {
        respondWith([
            place(),
            place({ place_id: 2, display_name: "Nowhere", lat: "not a number" }),
            place({ place_id: 3, display_name: undefined }),
            place({ place_id: 4, display_name: "Paris, France", lat: "48.8566", lon: "2.3522" })
        ]);

        expect(await search("anywhere")).toEqual([
            { id: "240109189", label: "Berlin, Germany", lat: 52.5170365, lng: 13.3888599 },
            { id: "4", label: "Paris, France", lat: 48.8566, lng: 2.3522 }
        ]);
    });

    it("reports a refused request rather than answering with no places", async () => {
        respondWith([], { ok: false, status: 429 });

        // The expectation is attached before the timers run, so the rejection is never loose.
        const refused = expect(provider.search("berlin")).rejects.toThrow("429");
        await vi.runAllTimersAsync();
        await refused;
    });

    it("holds searches to the one request a second the usage policy allows", async () => {
        const requestedAt: number[] = [];
        vi.stubGlobal("fetch", vi.fn(async () => {
            requestedAt.push(Date.now());
            return { ok: true, status: 200, statusText: "", json: async () => [] };
        }));

        const first = provider.search("berlin");
        const second = provider.search("paris");
        await vi.runAllTimersAsync();
        await Promise.all([ first, second ]);

        expect(requestedAt[1] - requestedAt[0]).toBeGreaterThanOrEqual(1000);
    });
});
