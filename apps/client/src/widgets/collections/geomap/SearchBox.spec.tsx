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

/** The pin is drawn on the map by its own component, which has a spec of its own; here it only has to
 *  stand in the right place, so it is rendered as something the DOM can be asked about. */
vi.mock("./PlaceMarker", () => ({
    default: ({ center, name, outline }: { center: [number, number]; name: string; outline?: GeoJSON.Geometry }) =>
        <div className="place-marker" data-center={center.join(",")} data-name={name} data-outline={outline?.type} />
}));

// i18next is not initialized under test, so t() returns "". The key stands in for the text, with any
// interpolated values after it, which is enough to tell the rows apart.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, vars?: Record<string, unknown>) => (vars ? `${key}(${Object.values(vars).join(",")})` : key)
}));

const TOKYO: GeoSearchResult = {
    id: "1", label: "Tokyo, Japan", name: "Tokyo", lat: 35.6762, lng: 139.6503,
    bounds: [ [ 139.5, 35.5 ], [ 139.9, 35.8 ] ]
};

/** A result the geocoder gave no extent for, which is what the fallback zoom is left for. */
const UNBOUNDED: GeoSearchResult = { id: "9", label: "Somewhere", name: "Somewhere", lat: 10, lng: 20 };

/** Stands in for the geocoder, which would otherwise reach for the network. */
function mockGeocoder(results: GeoSearchResult[]) {
    return vi.spyOn(GEOCODING_PROVIDERS[DEFAULT_GEOCODING_PROVIDER_NAME], "search")
        .mockResolvedValue(results);
}

/** Where a fake map is looking, which is what a search is told to prefer. */
const VIEWPORT = { west: 19.8, south: 39.5, east: 20.1, north: 39.8 };

/** A map that can be flown somewhere or framed on something, and that says what it is showing. */
function fakeMap() {
    return {
        flyTo: vi.fn(),
        fitBounds: vi.fn(),
        getBounds: () => ({
            getWest: () => VIEWPORT.west,
            getSouth: () => VIEWPORT.south,
            getEast: () => VIEWPORT.east,
            getNorth: () => VIEWPORT.north
        })
    };
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
                <SearchBox notes={notes} isDarkTheme={false} />
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

/** What each row is called: the first line of a place, and the whole of any other row. */
function labels() {
    return entries().map((entry) =>
        entry.querySelector(".geo-search-entry-name")?.textContent ?? entry.textContent);
}

/** Picks a row and lets whatever it started settle. */
async function pick(index: number) {
    await act(async () => { entries()[index].click(); });
    await settle();
}

beforeEach(() => vi.useFakeTimers());
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

        expect(search).toHaveBeenCalledWith("tokyo", {
            // The geocoder is told where the map is looking, so a name shared by two places is
            // answered with the one at hand.
            viewport: [ [ VIEWPORT.west, VIEWPORT.south ], [ VIEWPORT.east, VIEWPORT.north ] ]
        });
        // The row is replaced by what it found, the markers still standing above it.
        expect(labels()).toEqual([ "Tokyo trip", "Tokyo" ]);
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

    it("frames a place on the ground it covers, so a street is not shown as its city", async () => {
        mockGeocoder([ TOKYO ]);
        const map = fakeMap();
        const container = renderSearchBox(map, []);

        await type(container, "tokyo");
        await pick(0);
        await pick(0);

        expect(map.fitBounds).toHaveBeenCalledWith(TOKYO.bounds, {
            padding: expect.any(Number),
            // A house covers a few metres, which framed on its own would fill the screen with a roof.
            maxZoom: expect.any(Number)
        });
        expect(map.flyTo).not.toHaveBeenCalled();
        expect(field(container).value).toBe("Tokyo, Japan");
    });

    it("falls back to a zoom for a place the geocoder gave no extent for", async () => {
        mockGeocoder([ UNBOUNDED ]);
        const map = fakeMap();
        const container = renderSearchBox(map, mapNotes());

        await type(container, "somewhere");
        await pick(0);
        await pick(0);

        expect(map.fitBounds).not.toHaveBeenCalled();
        expect(map.flyTo).toHaveBeenCalledWith({ center: [ UNBOUNDED.lng, UNBOUNDED.lat ], zoom: expect.any(Number) });

        // A note marks a spot rather than an area, so it is shown closer in than a place of unknown
        // size.
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
        mockGeocoder([ { id: "2", label: "Berlin, Germany", name: "Berlin", lat: 52.52, lng: 13.405 } ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "berlin");
        await pick(0);
        expect(labels()).toEqual([ "Berlin" ]);

        await type(container, "berlin de");
        expect(labels()).toEqual([ "geo-map.search-online(berlin de)" ]);
    });

    it("pins a searched place where it stands, named as the geocoder names it", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "tokyo");
        await pick(1);
        await pick(1);

        const pin = () => container.querySelector<HTMLElement>(".place-marker");
        expect(pin()?.dataset.center).toBe(`${TOKYO.lng},${TOKYO.lat}`);
        // The place's own name rather than the full label the list reads.
        expect(pin()?.dataset.name).toBe("Tokyo");

        // A note of the map's own is already pinned, so taking one takes the searched pin away.
        await type(container, "tokyo trip");
        await pick(0);
        expect(pin()).toBeNull();
    });

    it("asks for a place's boundary only once that place has been picked", async () => {
        const outline = vi.fn(async () => ({ type: "Polygon", coordinates: [] } as GeoJSON.Geometry));
        mockGeocoder([ { ...TOKYO, outline } ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "tokyo");
        // The row that runs the geocoder, which offers the place but does not settle on it.
        await pick(0);
        expect(outline).not.toHaveBeenCalled();

        await pick(0);

        expect(outline).toHaveBeenCalledOnce();
        expect(container.querySelector<HTMLElement>(".place-marker")?.dataset.outline).toBe("Polygon");
    });

    it("drops a boundary that arrives after the place it belongs to has been replaced", async () => {
        let deliver: ((outline: GeoJSON.Geometry) => void) | undefined;
        const outline = vi.fn(() => new Promise<GeoJSON.Geometry>((resolve) => { deliver = resolve; }));
        mockGeocoder([ { ...TOKYO, outline } ]);
        const container = renderSearchBox(fakeMap(), mapNotes());

        await type(container, "tokyo");
        await pick(1);
        await pick(1);

        // A note of the map's own is settled on while the boundary is still being fetched.
        await type(container, "tokyo trip");
        await pick(0);
        await act(async () => { deliver?.({ type: "Polygon", coordinates: [] }); });

        expect(container.querySelector(".place-marker")).toBeNull();
    });

    it("gives a place two lines: what it is called, and the address that places it", async () => {
        mockGeocoder([
            { ...TOKYO, label: "Tokyo, Ōta, Japan" },
            // A label that does not begin with the name has nothing to repeat, so it is left whole.
            { id: "3", label: "Shibuya Crossing", name: "Scramble", lat: 35.6, lng: 139.7 }
        ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "tokyo");
        await pick(0);

        const lines = entries().map((entry) => [
            entry.querySelector(".geo-search-entry-name")?.textContent,
            entry.querySelector(".geo-search-entry-address")?.textContent
        ]);
        expect(lines).toEqual([
            [ "Tokyo", "Ōta, Japan" ],
            [ "Scramble", "Shibuya Crossing" ]
        ]);
    });

    it("takes the pin off the map once the field is emptied", async () => {
        mockGeocoder([ TOKYO ]);
        const container = renderSearchBox(fakeMap(), []);

        await type(container, "tokyo");
        await pick(0);
        await pick(0);
        expect(container.querySelector(".place-marker")).not.toBeNull();

        await type(container, "");

        expect(container.querySelector(".place-marker")).toBeNull();
    });

    it("renders nothing when the map failed to initialize", () => {
        expect(renderSearchBox(null).querySelector(".geo-search-toolbar")).toBeNull();
    });
});
