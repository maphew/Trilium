/**
 * The places the base map draws answering a click: which tile features are worth standing the map on,
 * which layers are hit-tested for them, and what the map's own markers do to a click that lands on
 * both.
 */
import type { Map as MapLibreGLMap, MapGeoJSONFeature } from "maplibre-gl";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it } from "vitest";

import { CLUSTER_LAYER } from "./clusters";
import type { GeoSearchResult } from "./geocoding";
import { MapStyleLoaded, ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";
import Pois, { poiFromFeature, poiLayers } from "./Pois";

type Listener = (e?: unknown) => void;

/** A place as a tile carries one: named, classified by its OSM tags, standing at a point. */
function poiFeature(properties: Record<string, unknown>, coordinates: [number, number] = [ 13.4, 52.5 ]) {
    return {
        id: 42,
        geometry: { type: "Point", coordinates },
        properties
    } as unknown as MapGeoJSONFeature;
}

/**
 * A map whose style draws places, standing in for MapLibre. What it has to answer is the hit test:
 * what the click landed on, told apart by which layers the query names.
 */
function fakeMap({ poiLayerIds = [ "poi-amenity", "poi-shop" ], ownLayerIds = [ MARKER_LAYER ], zoom = 18 } = {}) {
    const listeners = new Map<string, Set<Listener>>();
    const canvas = { style: { cursor: "" } };
    let onPoi: unknown[] = [];
    let onOwn: unknown[] = [];

    const layers = new Map<string, { sourceLayer: string }>();
    for (const id of poiLayerIds) layers.set(id, { sourceLayer: "pois" });
    for (const id of ownLayerIds) layers.set(id, { sourceLayer: "" });

    return {
        get cursor() { return canvas.style.cursor; },
        /** How far the map is zoomed in, which is what settles whether its places can be seen at all. */
        setZoom(to: number) { zoom = to; },
        /** What the next click lands on: a place of the base map, something of the map's own, or both. */
        setUnderPointer({ poi = [] as unknown[], own = [] as unknown[] }) {
            onPoi = poi;
            onOwn = own;
        },
        click() {
            for (const fn of listeners.get("click") ?? []) fn({ point: { x: 0, y: 0 } });
        },
        /** The pointer arriving over one of the layers the cursor is bound to, and leaving it again. */
        hover(layer: string) {
            for (const fn of listeners.get(`mouseenter:${layer}`) ?? []) fn();
        },
        unhover(layer: string) {
            for (const fn of listeners.get(`mouseleave:${layer}`) ?? []) fn();
        },
        /** Which layers the cursor is currently bound to, as a style switch has to put back. */
        boundLayers() {
            return [ ...listeners.keys() ]
                .filter((key) => key.startsWith("mouseenter:") && (listeners.get(key)?.size ?? 0) > 0)
                .map((key) => key.slice("mouseenter:".length));
        },
        fireStyleLoad() {
            for (const fn of listeners.get("style.load") ?? []) fn();
        },
        on(event: string, fnOrLayer: unknown, fn?: Listener) {
            const key = fn ? `${event}:${fnOrLayer}` : event;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)?.add((fn ?? fnOrLayer) as Listener);
        },
        off(event: string, fnOrLayer: unknown, fn?: Listener) {
            listeners.get(fn ? `${event}:${fnOrLayer}` : event)?.delete((fn ?? fnOrLayer) as Listener);
        },
        queryRenderedFeatures(_point: unknown, { layers: queried }: { layers: string[] }) {
            return queried.some((id) => poiLayerIds.includes(id)) ? onPoi : onOwn;
        },
        getLayersOrder: () => [ ...layers.keys() ],
        getLayer: (id: string) => layers.get(id),
        getCanvas: () => canvas,
        getZoom: () => zoom
    };
}

const containers: HTMLElement[] = [];

/** Puts the places of a map within reach, and hands back what a click on one reported. */
async function renderPois(map: ReturnType<typeof fakeMap>, { placing = false } = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);

    const picked: GeoSearchResult[] = [];

    await act(async () => {
        render(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <MapStyleLoaded.Provider value={true}>
                    <Pois placing={placing} onPick={(place) => picked.push(place)} />
                </MapStyleLoaded.Provider>
            </ParentMap.Provider>,
            container
        );
    });

    return {
        picked,
        unmount: async () => { await act(async () => { render(null, container); }); }
    };
}

afterEach(() => {
    for (const container of containers) {
        render(null, container);
        container.remove();
    }
    containers.length = 0;
});

describe("geo map POI features", () => {
    it("reads a named place off a tile feature, classified by its OSM tags", () => {
        const place = poiFromFeature(poiFeature({ name: "Café Kranzler", amenity: "cafe" }));

        expect(place).toMatchObject({
            name: "Café Kranzler",
            // Nothing beyond the name, a tile carrying no address (see PlacePanel).
            label: "Café Kranzler",
            lng: 13.4,
            lat: 52.5,
            icon: "bx bx-coffee"
        });
        // Named by what OSM calls the place, so the same one clicked twice is the same place.
        expect(place?.id).toBe("poi:42");
    });

    it("names a place the way the rest of the map is named", () => {
        // The styles load their English variant, so a place says what its label would have said.
        const place = poiFromFeature(poiFeature({ name: "東京タワー", name_en: "Tokyo Tower", tourism: "attraction" }));

        expect(place?.name).toBe("Tokyo Tower");
    });

    it("falls through the tags to whichever kind the place is filed under", () => {
        expect(poiFromFeature(poiFeature({ name: "Edeka", shop: "supermarket" }))?.icon).toBe("bx bx-cart");
        // A kind the tables do not name is still drawn by its category, a shop as a shop.
        expect(poiFromFeature(poiFeature({ name: "Rossmann", shop: "chemist" }))?.icon).toBe("bx bx-store");
        // Every key a place can be filed under has an icon, so only a feature carrying no kind at
        // all is left for the panel to fall back on.
        expect(poiFromFeature(poiFeature({ name: "Something" }))?.icon).toBeUndefined();
    });

    it("passes over what is not a place worth keeping", () => {
        // A bench has no name, and the bare OSM tag is not what anyone means to keep.
        expect(poiFromFeature(poiFeature({ amenity: "bench" }))).toBeNull();
        expect(poiFromFeature(poiFeature({ name: "   ", amenity: "cafe" }))).toBeNull();
        expect(poiFromFeature(undefined)).toBeNull();
        expect(poiFromFeature({
            geometry: { type: "LineString", coordinates: [] },
            properties: { name: "A street" }
        } as unknown as MapGeoJSONFeature)).toBeNull();
    });

    it("hit-tests the layers of the style that draw places, and no others", () => {
        const map = fakeMap({ poiLayerIds: [ "poi-amenity" ], ownLayerIds: [ MARKER_LAYER, CLUSTER_LAYER ] });

        expect(poiLayers(map as unknown as MapLibreGLMap)).toEqual([ "poi-amenity" ]);
    });
});

describe("geo map Pois", () => {
    it("stands the map on the place a click landed on", async () => {
        const map = fakeMap();
        const { picked } = await renderPois(map);

        map.setUnderPointer({ poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ] });
        await act(async () => { map.click(); });

        expect(picked).toHaveLength(1);
        expect(picked[0]).toMatchObject({ name: "Café Kranzler", icon: "bx bx-coffee" });
    });

    it("leaves a click that landed on the map's own to the map's own", async () => {
        const map = fakeMap();
        const { picked } = await renderPois(map);

        // A marker standing over a place: the pin is the smaller target and the one aimed at.
        map.setUnderPointer({
            poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ],
            own: [ { properties: { id: "note1" } } ]
        });
        await act(async () => { map.click(); });

        expect(picked).toEqual([]);
    });

    it("leaves the click alone while one is armed to place a marker", async () => {
        const map = fakeMap();
        const { picked } = await renderPois(map, { placing: true });

        map.setUnderPointer({ poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ] });
        await act(async () => { map.click(); });

        expect(picked).toEqual([]);
        // Nor does the pointer offer a place while the click means somewhere to put a marker.
        expect(map.boundLayers()).toEqual([]);
    });

    it("leaves the places alone until the map has drawn them", async () => {
        const map = fakeMap();
        const { picked } = await renderPois(map);

        // The styles fade their places in over the zoom above 16, and what cannot be seen is not
        // what a click was aimed at.
        map.setZoom(16);
        map.setUnderPointer({ poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ] });
        await act(async () => { map.click(); });
        map.hover("poi-amenity");

        expect(picked).toEqual([]);
        expect(map.cursor).toBe("");

        map.setZoom(17);
        await act(async () => { map.click(); });
        map.hover("poi-amenity");

        expect(picked).toHaveLength(1);
        expect(map.cursor).toBe("pointer");
    });

    it("does nothing on a style that draws no places", async () => {
        // The raster layer has its places baked into the image, and Neutrino carries none.
        const map = fakeMap({ poiLayerIds: [] });
        const { picked } = await renderPois(map);

        map.setUnderPointer({ poi: [ poiFeature({ name: "Café Kranzler", amenity: "cafe" }) ] });
        await act(async () => { map.click(); });

        expect(picked).toEqual([]);
    });

    it("says a place can be clicked, and puts the pointer back when it goes", async () => {
        const map = fakeMap();
        const { unmount } = await renderPois(map);

        map.hover("poi-amenity");
        expect(map.cursor).toBe("pointer");

        map.unhover("poi-amenity");
        expect(map.cursor).toBe("");

        map.hover("poi-shop");
        await unmount();
        // Torn down with the pointer sitting on a place, the `mouseleave` no longer being listened for.
        expect(map.cursor).toBe("");
        expect(map.boundLayers()).toEqual([]);
    });

    it("puts the pointer back on the layers a style switch brought in", async () => {
        const map = fakeMap();
        await renderPois(map);

        expect(map.boundLayers()).toEqual([ "poi-amenity", "poi-shop" ]);

        // The layers are replaced wholesale, so the handlers are bound once each rather than twice.
        await act(async () => { map.fireStyleLoad(); });

        expect(map.boundLayers()).toEqual([ "poi-amenity", "poi-shop" ]);
        map.hover("poi-amenity");
        expect(map.cursor).toBe("pointer");
    });
});
