/**
 * The GPX track: the line between the flags.
 *
 * Two things kept it from being drawn. It was added only if `map.isStyleLoaded()` said so, or else on
 * the next `style.load` — but `style.load` fires once per style and this component mounts late (it
 * waits on the note's content to be fetched and on three icons to be drawn), so the event was
 * routinely long gone by the time it listened; and `isStyleLoaded()` answers for the tiles as much as
 * for the style, so it is false while they are still arriving. Missing both, the line was never added
 * at all, while the markers — elements of the page, added unconditionally — went up as usual. What
 * the user saw was a start and an end with nothing in between.
 *
 * The second was that every point in the file was strung into one line, so a track recorded in
 * segments was drawn with a straight line across each gap between them.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The markers MapLibre was asked to put on the page, in the order they were added. */
const addedMarkers: { lngLat: [number, number]; html: string }[] = [];

vi.mock("maplibre-gl", () => ({
    Marker: class {
        private lngLat: [number, number] = [ 0, 0 ];

        constructor(private options: { element: HTMLElement }) {}

        setLngLat(lngLat: [number, number]) {
            this.lngLat = lngLat;
            return this;
        }

        addTo() {
            addedMarkers.push({ lngLat: this.lngLat, html: this.options.element.innerHTML });
            return this;
        }

        remove() {}
    }
}));

/**
 * A map as MapLibre behaves, in the one respect that matters here: a source or a layer can only be
 * added to a style that has finished loading, and asking for one before then throws.
 */
function fakeMap() {
    const sources = new Map<string, unknown>();
    const layers = new Map<string, unknown>();
    const listeners = new Map<string, (() => void)[]>();
    let loaded = false;

    return {
        sources,
        layers,
        /** What `map.isStyleLoaded()` answers — false while the tiles are still coming in. */
        tilesLoaded: false,

        on(type: string, listener: () => void) {
            listeners.set(type, [ ...(listeners.get(type) ?? []), listener ]);
        },
        off(type: string, listener: () => void) {
            listeners.set(type, (listeners.get(type) ?? []).filter((l) => l !== listener));
        },
        isStyleLoaded() {
            return loaded && this.tilesLoaded;
        },
        getSource(id: string) {
            return sources.get(id);
        },
        getLayer(id: string) {
            return layers.get(id);
        },
        addSource(id: string, source: unknown) {
            if (!loaded) throw new Error("Style is not done loading");
            sources.set(id, source);
        },
        addLayer(layer: { id: string }) {
            if (!loaded) throw new Error("Style is not done loading");
            layers.set(layer.id, layer);
        },
        removeSource(id: string) {
            sources.delete(id);
        },
        removeLayer(id: string) {
            layers.delete(id);
        },

        /** The style finishing, which is what `style.load` announces. */
        loadStyle() {
            loaded = true;
            for (const listener of listeners.get("style.load") ?? []) {
                listener();
            }
        }
    };
}

/** A track of two segments, a good way apart, plus a waypoint between them. */
const TWO_SEGMENT_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <wpt lat="45.9" lon="24.1"><name>A rest</name></wpt>
  <trk>
    <trkseg>
      <trkpt lat="45.79" lon="24.13" />
      <trkpt lat="45.81" lon="24.14" />
    </trkseg>
    <trkseg>
      <trkpt lat="45.96" lon="24.16" />
      <trkpt lat="45.89" lon="24.08" />
    </trkseg>
  </trk>
</gpx>`;

describe("GpxTrack", () => {
    let container: HTMLElement;
    let map: ReturnType<typeof fakeMap>;
    let GpxTrack: typeof import("./GpxTrack").GpxTrack;
    let ParentMap: typeof import("./map").ParentMap;
    let MapStyleLoaded: typeof import("./map").MapStyleLoaded;

    beforeEach(async () => {
        ({ GpxTrack } = await import("./GpxTrack"));
        ({ ParentMap, MapStyleLoaded } = await import("./map"));
        addedMarkers.length = 0;
        map = fakeMap();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    /** Mounts the track under a map whose style has loaded (or not), as the context reports it. */
    function renderTrack({ styleLoaded, gpx = TWO_SEGMENT_GPX }: { styleLoaded: boolean; gpx?: string }) {
        act(() => {
            render(
                <ParentMap.Provider value={map as never}>
                    <MapStyleLoaded.Provider value={styleLoaded}>
                        <GpxTrack
                            gpxXmlString={gpx}
                            trackColor="red"
                            startIconHtml="<i>start</i>"
                            endIconHtml="<i>end</i>"
                            waypointIconHtml="<i>waypoint</i>"
                        />
                    </MapStyleLoaded.Provider>
                </ParentMap.Provider>,
                container
            );
        });
    }

    /** The one line layer the track added, whatever its generated id. */
    function trackLayer() {
        return [ ...map.layers.values() ][0] as { paint: Record<string, unknown> } | undefined;
    }

    /** The coordinates of the one source the track added. */
    function trackCoordinates() {
        const source = [ ...map.sources.values() ][0] as
            { data: { geometry: { type: string; coordinates: [number, number][][] } } } | undefined;
        return source?.data.geometry;
    }

    it("draws the line when it mounts after the style loaded, with the tiles still coming in", () => {
        // The style is long since loaded and `style.load` is spent — the case that used to lose.
        map.loadStyle();
        expect(map.isStyleLoaded()).toBe(false);

        renderTrack({ styleLoaded: true });

        expect(trackLayer()?.paint["line-color"]).toBe("red");
        expect(trackCoordinates()?.type).toBe("MultiLineString");
    });

    it("draws the line once the style loads, when it mounts before that", () => {
        renderTrack({ styleLoaded: false });

        // Nothing yet: there is no style to add to.
        expect(map.layers.size).toBe(0);

        act(() => map.loadStyle());

        expect(map.layers.size).toBe(1);
        expect(trackCoordinates()?.coordinates).toHaveLength(2);
    });

    it("keeps the segments apart, rather than joining them across the gap", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });

        expect(trackCoordinates()).toEqual({
            type: "MultiLineString",
            coordinates: [
                [ [ 24.13, 45.79 ], [ 24.14, 45.81 ] ],
                [ [ 24.16, 45.96 ], [ 24.08, 45.89 ] ]
            ]
        });
    });

    it("flags where the whole track begins and ends, not every segment", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });

        const flags = addedMarkers.filter((marker) => marker.html !== "<i>waypoint</i>");
        expect(flags).toEqual([
            { lngLat: [ 24.13, 45.79 ], html: "<i>start</i>" },
            { lngLat: [ 24.08, 45.89 ], html: "<i>end</i>" }
        ]);
    });

    it("marks the waypoints", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });

        expect(addedMarkers.filter((marker) => marker.html === "<i>waypoint</i>"))
            .toEqual([ { lngLat: [ 24.1, 45.9 ], html: "<i>waypoint</i>" } ]);
    });

    it("draws a route as it draws a track", () => {
        map.loadStyle();
        renderTrack({
            styleLoaded: true,
            gpx: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte><rtept lat="1" lon="2" /><rtept lat="3" lon="4" /></rte>
</gpx>`
        });

        expect(trackCoordinates()?.coordinates).toEqual([ [ [ 2, 1 ], [ 4, 3 ] ] ]);
    });

    it("skips a point that does not say where it is, rather than placing it at zero", () => {
        map.loadStyle();
        renderTrack({
            styleLoaded: true,
            gpx: `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><trkseg>
    <trkpt lat="45.79" lon="24.13" />
    <trkpt lon="24.14" />
    <trkpt lat="45.81" lon="24.15" />
  </trkseg></trk>
</gpx>`
        });

        expect(trackCoordinates()?.coordinates).toEqual([ [ [ 24.13, 45.79 ], [ 24.15, 45.81 ] ] ]);
    });

    it("puts the line back when the style is switched under it", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });
        expect(map.layers.size).toBe(1);

        // A style is a world of its own: switching one takes everything on it away.
        map.layers.clear();
        map.sources.clear();
        act(() => map.loadStyle());

        expect(map.layers.size).toBe(1);
        expect(trackCoordinates()?.type).toBe("MultiLineString");
    });

    it("draws nothing for a file with no points, and does not throw over it", () => {
        map.loadStyle();
        renderTrack({
            styleLoaded: true,
            gpx: `<?xml version="1.0" encoding="UTF-8"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1" />`
        });

        expect(map.layers.size).toBe(0);
        expect(map.sources.size).toBe(0);
        expect(addedMarkers).toHaveLength(0);
    });

    it("takes the line off the map when it goes", () => {
        map.loadStyle();
        renderTrack({ styleLoaded: true });
        expect(map.layers.size).toBe(1);

        act(() => render(null, container));

        expect(map.layers.size).toBe(0);
        expect(map.sources.size).toBe(0);
    });
});
