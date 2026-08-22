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
        name: "Berlin",
        osm_type: "relation",
        osm_id: 62422,
        display_name: "Berlin, Germany",
        boundingbox: [ "52.3382448", "52.6755087", "13.0883450", "13.7611609" ],
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

/** Answers each request in turn, for a search that makes more than one (see the two passes). */
function respondInTurn(bodies: unknown[]) {
    let call = 0;
    const fetchMock = vi.fn(async (_url: string) => ({
        ok: true,
        status: 200,
        statusText: "",
        json: async () => bodies[Math.min(call++, bodies.length - 1)]
    }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
}

/** Runs a search, letting the rate limiter's wait elapse rather than sitting through it. */
async function search(query: string, options?: Parameters<typeof provider.search>[1]) {
    const results = provider.search(query, options);
    await vi.runAllTimersAsync();
    return results;
}

function requestedUrl(fetchMock: ReturnType<typeof respondWith>, call = 0) {
    return new URL(fetchMock.mock.calls[call][0]);
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
            place({
                place_id: 4, name: undefined, display_name: "Paris, France", lat: "48.8566", lon: "2.3522",
                boundingbox: [ "not", "a", "box", "at all" ], osm_type: "node", osm_id: 17807753
            })
        ]);

        expect(await search("anywhere")).toEqual([
            {
                id: "240109189", label: "Berlin, Germany", name: "Berlin", lat: 52.5170365, lng: 13.3888599,
                // Written south-north-west-east by Nominatim, and read as MapLibre frames one.
                bounds: [ [ 13.088345, 52.3382448 ], [ 13.7611609, 52.6755087 ] ],
                outline: expect.any(Function)
            },
            // Named by the leading part of its label, Nominatim having named it nothing itself, and
            // framed by nothing: its extent is unreadable, and a node has no boundary to fetch.
            {
                id: "4", label: "Paris, France", name: "Paris", lat: 48.8566, lng: 2.3522,
                bounds: undefined, outline: undefined
            }
        ]);
    });

    it("reports a refused request rather than answering with no places", async () => {
        respondWith([], { ok: false, status: 429 });

        // The expectation is attached before the timers run, so the rejection is never loose.
        const refused = expect(provider.search("berlin")).rejects.toThrow("429");
        await vi.runAllTimersAsync();
        await refused;
    });

    it("asks what the map is showing first, then the wider world", async () => {
        const inSibiu = place({ place_id: 1, name: "Jumbo", display_name: "Jumbo, Sibiu, Romania" });
        const inTheUnitedStates = place({ place_id: 2, name: "Jumbo", display_name: "Jumbo, Ohio, USA" });
        const fetchMock = respondInTurn([ [ inSibiu ], [ inTheUnitedStates, inSibiu ] ]);

        const results = await search("jumbo", { viewport: [ [ 23, 45 ], [ 25, 47 ] ] });

        // Restricted to the view first: a viewbox alone is only a nudge next to how well known a
        // place is, so a shop in Sibiu would otherwise stay under every Jumbo in the United States.
        const nearby = requestedUrl(fetchMock, 0).searchParams;
        // Two opposite corners, longitude first, as Nominatim reads a preferred area.
        expect(nearby.get("viewbox")).toBe("23,45,25,47");
        expect(nearby.get("bounded")).toBe("1");

        // Then unrestricted, so a place nowhere near the map is still found.
        const elsewhere = requestedUrl(fetchMock, 1).searchParams;
        expect(elsewhere.get("viewbox")).toBe("23,45,25,47");
        expect(elsewhere.get("bounded")).toBeNull();

        // What is at hand comes first, and is not offered twice for being in both answers.
        expect(results.map((result) => result.label)).toEqual([
            "Jumbo, Sibiu, Romania",
            "Jumbo, Ohio, USA"
        ]);
    });

    it("searches the town around a view of one neighbourhood, not the neighbourhood alone", async () => {
        const fetchMock = respondWith([]);

        // A few streets of Sibiu, some 500 m across.
        await search("jumbo", { viewport: [ [ 24.147, 45.796 ], [ 24.153, 45.800 ] ] });

        const [ west, south, east, north ] = (requestedUrl(fetchMock).searchParams.get("viewbox") ?? "")
            .split(",").map(Number);

        // Grown about the same middle rather than shifted off it.
        expect((west + east) / 2).toBeCloseTo(24.15, 4);
        expect((south + north) / 2).toBeCloseTo(45.798, 4);

        // Wide enough to hold the town: a degree of latitude is about 111 km, so 25 km either way of
        // the middle is a little over 0.2 degrees.
        expect(north - south).toBeGreaterThan(0.4);
        // Longitude is shorter this far north, so the box is wider in degrees than it is tall.
        expect(east - west).toBeGreaterThan(north - south);
    });

    it("does not go looking further afield where the view already fills the list", async () => {
        const local = Array.from({ length: 8 }, (_, index) => place({ place_id: index, display_name: `Jumbo ${index}` }));
        const fetchMock = respondInTurn([ local, [] ]);

        const results = await search("jumbo", { viewport: [ [ 23, 45 ], [ 25, 47 ] ] });

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(results).toHaveLength(8);
    });

    it("asks once, from nowhere in particular, where the view says nothing usable", async () => {
        const fromNowhere = respondWith([]);
        await search("jumbo");
        expect(fromNowhere).toHaveBeenCalledOnce();
        expect(requestedUrl(fromNowhere).searchParams.get("viewbox")).toBeNull();

        // Panned across the antimeridian, where the view runs the other way round and no pair of
        // corners describes it.
        const wrapped = respondWith([]);
        await search("jumbo", { viewport: [ [ 170, 39.5 ], [ -170, 39.8 ] ] });
        expect(wrapped).toHaveBeenCalledOnce();
        expect(requestedUrl(wrapped).searchParams.get("viewbox")).toBeNull();
    });

    it("fetches the boundary of a place on its own, simplified, only when it is asked for", async () => {
        const fetchMock = respondWith([ place() ]);
        const [ berlin ] = await search("berlin");
        expect(fetchMock).toHaveBeenCalledOnce();

        const boundary: GeoJSON.Geometry = { type: "MultiPolygon", coordinates: [] };
        respondWith([ { geojson: boundary } ]);
        const outlineFetch = berlin.outline?.();
        await vi.runAllTimersAsync();

        expect(await outlineFetch).toEqual(boundary);
    });

    it("draws no boundary for a shape that is not one", async () => {
        respondWith([ place() ]);
        const [ berlin ] = await search("berlin");

        // A point is what the pin already says; there is nothing to ring.
        respondWith([ { geojson: { type: "Point", coordinates: [ 13.4, 52.5 ] } } ]);
        const outlineFetch = berlin.outline?.();
        await vi.runAllTimersAsync();

        expect(await outlineFetch).toBeNull();
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
