/**
 * The pin standing on a place taken from the search: that it is drawn as a marker of the map rather
 * than as something laid over it, labelled with the place's name and following the style from light
 * to dark, and that it leaves nothing behind when it goes.
 */
import type { Map as MapLibreGLMap } from "maplibre-gl";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MapStyleLoaded, ParentMap } from "./map";
import { LABEL_PAINT, MARKER_SHADOW_PADDING, markerImageId } from "./Markers";
import PlaceMarker, { PLACE_LAYER, PLACE_MARKER_COLOR, PLACE_MARKER_ICON, PLACE_SOURCE } from "./PlaceMarker";

// The pin is rasterized by loading an SVG into an Image, and happy-dom never fires that load — so
// the layer, which waits for the pin, would never be added. Only the rasterizing is stood in for;
// the layout and paint the assertions read are the real ones.
vi.mock("./Markers", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./Markers")>()),
    buildMarkerImage: vi.fn(async () => new Image())
}));

const TOKYO: [number, number] = [ 139.6503, 35.6762 ];

interface FakeLayer {
    id: string;
    source?: string;
    layout?: Record<string, unknown>;
    paint?: Record<string, unknown>;
}

/** A map that records what the component adds to it and takes away again. */
function fakeMap() {
    const layers = new Map<string, FakeLayer>();
    const sources = new Map<string, unknown>();
    const images = new Set<string>();
    const removals: string[] = [];

    return {
        removals,
        layer: (id: string) => layers.get(id),
        source: (id: string) => sources.get(id),
        hasImage: (id: string) => images.has(id),
        addImage: (id: string) => { images.add(id); },
        addSource: (id: string, source: unknown) => { sources.set(id, source); },
        addLayer: (layer: FakeLayer) => { layers.set(layer.id, layer); },
        getSource: (id: string) => sources.get(id),
        getLayer: (id: string) => layers.get(id),
        removeSource: (id: string) => { removals.push(`source:${id}`); sources.delete(id); },
        removeLayer: (id: string) => { removals.push(`layer:${id}`); layers.delete(id); },
        on: () => {},
        off: () => {}
    };
}

const containers: HTMLElement[] = [];

/** Puts the pin on a map whose style is ready, and settles the pin image the layer waits for. */
async function renderMarker(map: ReturnType<typeof fakeMap>, { name = "Tokyo", isDarkTheme = false } = {}) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    containers.push(container);

    await act(async () => {
        render(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <MapStyleLoaded.Provider value={true}>
                    <PlaceMarker center={TOKYO} name={name} isDarkTheme={isDarkTheme} />
                </MapStyleLoaded.Provider>
            </ParentMap.Provider>,
            container
        );
    });
    await settle();

    return { unmount: async () => { await act(async () => { render(null, container); }); } };
}

/** Lets the awaited pin image arrive, which is what the layer is held back for. */
async function settle() {
    await act(async () => { await Promise.resolve(); });
}

afterEach(() => {
    for (const container of containers) {
        render(null, container);
        container.remove();
    }
    containers.length = 0;
});

describe("geo map PlaceMarker", () => {
    it("stands the place on its own layer, pinned and named where the geocoder put it", async () => {
        const map = fakeMap();

        await renderMarker(map);

        expect(map.source(PLACE_SOURCE)).toMatchObject({
            type: "geojson",
            data: {
                geometry: { type: "Point", coordinates: TOKYO },
                properties: { name: "Tokyo" }
            }
        });

        const layer = map.layer(PLACE_LAYER);
        expect(layer?.source).toBe(PLACE_SOURCE);
        expect(layer?.layout).toMatchObject({
            "icon-image": markerImageId(PLACE_MARKER_COLOR, PLACE_MARKER_ICON),
            // The tip stands on the coordinate rather than the bottom edge of the image, as the note
            // pins do.
            "icon-anchor": "bottom",
            "icon-offset": [ 0, MARKER_SHADOW_PADDING ],
            // The one thing on the map the user has just asked to see does not give way to a label
            // that was already there.
            "icon-allow-overlap": true,
            "text-allow-overlap": true,
            "text-field": [ "get", "name" ]
        });
    });

    it("labels the place the way the map labels its own markers, on a light style and a dark one", async () => {
        const light = fakeMap();
        await renderMarker(light);
        expect(light.layer(PLACE_LAYER)?.paint).toMatchObject(LABEL_PAINT.light);

        const dark = fakeMap();
        await renderMarker(dark, { isDarkTheme: true });
        expect(dark.layer(PLACE_LAYER)?.paint).toMatchObject(LABEL_PAINT.dark);
    });

    it("takes the layer and its source away with it, the layer first", async () => {
        const map = fakeMap();
        const { unmount } = await renderMarker(map);
        expect(map.layer(PLACE_LAYER)).toBeTruthy();

        await unmount();

        // A source still drawn from cannot be removed, so the layer goes first.
        expect(map.removals).toEqual([ `layer:${PLACE_LAYER}`, `source:${PLACE_SOURCE}` ]);
    });
});
