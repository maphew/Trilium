/**
 * The geo map search bar: what a query lists, when the geocoder is allowed to run, and what picking
 * a row does to the map. The geocoder is the dummy provider, so these cover the bar rather than any
 * one geocoder.
 */
import type { Map as MapLibreGLMap } from "maplibre-gl";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import { DEFAULT_GEOCODING_PROVIDER_NAME, GEOCODING_PROVIDERS, type GeoSearchResult } from "./geocoding";
import { ParentMap } from "./map";
import SearchBox from "./SearchBox";

// Hoisted, because map.tsx imports maplibre-gl as this file is loaded — a class declared below would
// still be in its temporal dead zone when the factory runs.
const { FakeMarker } = vi.hoisted(() => {
    /** Stands in for MapLibre's own marker, which wants a real map to attach itself to. */
    class FakeMarker {
        static standing: FakeMarker[] = [];
        lngLat?: [number, number];

        constructor(readonly options: { element: HTMLElement; anchor?: string; offset?: [number, number] }) {}

        setLngLat(lngLat: [number, number]) {
            this.lngLat = lngLat;
            return this;
        }

        addTo(_map: unknown) {
            FakeMarker.standing.push(this);
            return this;
        }

        remove() {
            FakeMarker.standing = FakeMarker.standing.filter((marker) => marker !== this);
            return this;
        }
    }

    return { FakeMarker };
});

vi.mock("maplibre-gl", () => ({ Marker: FakeMarker }));

// The pin's image is drawn from an icon the glyph service resolves against the real stylesheet.
vi.mock("../../../services/icon_glyphs", () => ({
    renderIconImage: vi.fn(async () => "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")
}));

// i18next is not initialized under test, so t() returns "". The key stands in for the text, with any
// interpolated values after it, which is enough to tell the rows apart.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key)
}));

const TOKYO: GeoSearchResult = { id: "1", label: "Tokyo, Japan", lat: 35.6762, lng: 139.6503 };

/** Stands in for the geocoder, which would otherwise reach for the network. */
function mockGeocoder(results: GeoSearchResult[]) {
    return vi.spyOn(GEOCODING_PROVIDERS[DEFAULT_GEOCODING_PROVIDER_NAME], "search")
        .mockResolvedValue(results);
}

/** A map that can be flown somewhere, which is all the bar uses. */
function fakeMap() {
    return { flyTo: vi.fn() };
}

/** Two notes on the map and one that is only in its subtree, having no location to be drawn at. */
function mapNotes(): FNote[] {
    return [
        buildNote({ title: "London hotel", "#geolocation": "51.5,-0.12" }),
        buildNote({ title: "London office", "#geolocation": "51.6,-0.1" }),
        buildNote({ title: "London packing list" }),
        buildNote({ title: "Tokyo trip", "#geolocation": "35.6,139.7" })
    ];
}

function renderSearchBox(map: ReturnType<typeof fakeMap> | null, notes: FNote[] = []) {
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <SearchBox notes={notes} />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the search bar was not rendered");
    return container;
}

function field(container: HTMLElement) {
    const input = container.querySelector<HTMLInputElement>("input.geo-search-input");
    if (!input) throw new Error("the search bar has no field");
    return input;
}

/** Lets the debounced lookup and anything it started run to completion. */
async function settle() {
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

/** Types into the field and runs out the debounced lookup. */
async function type(container: HTMLElement, text: string) {
    const input = field(container);
    // Two acts: the field has to re-render as open before the effect that schedules the lookup runs,
    // so advancing the timers in the same act would find nothing scheduled.
    await act(async () => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await settle();
}

/** The dropdown is portalled to the body, so look for it there rather than in the container. */
function entries() {
    return [ ...document.querySelectorAll<HTMLElement>(".form-autocomplete-dropdown .form-autocomplete-item") ];
}

function labels() {
    return entries().map((entry) => entry.textContent);
}

/** Picks a row and lets whatever it started settle. */
async function pick(index: number) {
    await act(async () => { entries()[index].click(); });
    await settle();
}

beforeEach(() => {
    vi.useFakeTimers();
    FakeMarker.standing = [];
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("geo map SearchBox", () => {
    it("lists the map's own markers by title, skipping notes with nowhere to fly to", async () => {
        mockGeocoder([]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "london");

        // "London packing list" has no location, so it has no marker to offer.
        expect(labels()).toEqual([
            "London hotel",
            "London office",
            "geo-map.search-online(london)"
        ]);
    });

    it("offers nothing for a query below the minimum length", async () => {
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "l");

        expect(entries()).toHaveLength(0);
    });

    it("does not reach the geocoder until its row is picked", async () => {
        const search = mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "tokyo");
        expect(search).not.toHaveBeenCalled();
        expect(labels()).toEqual([ "Tokyo trip", "geo-map.search-online(tokyo)" ]);

        await pick(1);

        expect(search).toHaveBeenCalledWith("tokyo");
        // The row is replaced by what it found, the markers still standing above it.
        expect(labels()).toEqual([ "Tokyo trip", "Tokyo, Japan" ]);
    });

    it("flies to a marker, and closes the list rather than leaving it open over the map", async () => {
        mockGeocoder([]);
        const map = fakeMap();
        const container = renderSearchBox(map, mapNotes());

        await type(container, "tokyo trip");
        await pick(0);

        expect(map.flyTo).toHaveBeenCalledWith({ center: [ 139.7, 35.6 ], zoom: expect.any(Number) });
        expect(field(container).value).toBe("Tokyo trip");
        expect(entries()).toHaveLength(0);
    });

    it("flies to a geocoded place, further out than to a marker", async () => {
        mockGeocoder([ TOKYO ]);
        const map = fakeMap();
        const container = renderSearchBox(map, mapNotes());

        await type(container, "tokyo");
        await pick(1);
        await pick(1);

        expect(map.flyTo).toHaveBeenCalledWith({ center: [ 139.6503, 35.6762 ], zoom: expect.any(Number) });
        expect(field(container).value).toBe("Tokyo, Japan");

        const [ { zoom: placeZoom } ] = map.flyTo.mock.calls[0];
        await type(container, "tokyo trip");
        await pick(0);
        const [ { zoom: markerZoom } ] = map.flyTo.mock.calls[1];
        expect(markerZoom).toBeGreaterThan(placeZoom);
    });

    it("says so when the geocoder finds nothing, and when it cannot be reached", async () => {
        mockGeocoder([]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "atlantis");
        await pick(0);
        expect(labels()).toEqual([ "geo-map.no-places-found" ]);

        mockGeocoder([]).mockRejectedValue(new Error("rate limited"));
        await type(container, "berlin");
        await pick(0);
        expect(labels()).toEqual([ "geo-map.search-failed" ]);
    });

    it("offers the geocoder again once the query moves on from what it answered", async () => {
        mockGeocoder([ { id: "2", label: "Berlin, Germany", lat: 52.52, lng: 13.405 } ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "berlin");
        await pick(0);
        expect(labels()).toEqual([ "Berlin, Germany" ]);

        await type(container, "berlin de");
        expect(labels()).toEqual([ "geo-map.search-online(berlin de)" ]);
    });

    it("pins a searched place where it stands, since the map has nothing there of its own", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "tokyo");
        await pick(1);
        await pick(1);

        expect(FakeMarker.standing).toHaveLength(1);
        expect(FakeMarker.standing[0].lngLat).toEqual([ TOKYO.lng, TOKYO.lat ]);
        // The tip of the pin stands on the place rather than the bottom edge of its image.
        expect(FakeMarker.standing[0].options.anchor).toBe("bottom");

        // A note of the map's own is already pinned, so taking one takes the searched pin away.
        await type(container, "tokyo trip");
        await pick(0);
        expect(FakeMarker.standing).toHaveLength(0);
    });

    it("takes the pin off the map once the field is emptied", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "tokyo");
        await pick(0);
        await pick(0);
        expect(FakeMarker.standing).toHaveLength(1);

        await type(container, "");

        expect(FakeMarker.standing).toHaveLength(0);
    });

    it("renders nothing when the map failed to initialize", () => {
        expect(renderSearchBox(null).querySelector(".geo-search-toolbar")).toBeNull();
    });
});
