import { type Map as MapLibreGLMap, Marker as MapLibreMarker } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { MapStyleLoaded, ParentMap } from "./map";
import { LABEL_PAINT } from "./Markers";

export interface GpxTrackProps {
    /** The note the track belongs to, which is what its layers are named after and what a click on
     *  one of them resolves to. */
    noteId: string;
    /** What the line is named along its length. */
    title: string;
    gpxXmlString: string;
    trackColor?: string;
    startIconHtml?: string;
    endIconHtml?: string;
    waypointIconHtml?: string;
    /** Whether the map is a dark one, which decides how the name is drawn over it (see Markers). */
    isDarkTheme?: boolean;
    /** Whether the map's titles are hidden (`#map:hideLabels`), the track's name among them. */
    hideLabels?: boolean;
}

/** What marks a note as a GPX track: the mime its file carries. */
export const GPX_MIME = "application/gpx+xml";

/**
 * What a track's layers are named with.
 *
 * A prefix rather than a fixed name, because every track has layers of its own — see the note on ids
 * below. Anything hit-testing tracks finds the current set by asking the style for its layers and
 * keeping the ones that start with this (see {@link trackHitLayers}).
 */
const HIT_LAYER_PREFIX = "gpx-hit-";

/** How wide a track is to the pointer, as against the three pixels it is drawn with. */
const HIT_WIDTH = 20;

/** How far apart the name is repeated along the line, in pixels. */
const LABEL_SPACING = 250;

/**
 * A GPX file, drawn as a line with a marker at either end and one at every waypoint.
 *
 * The line is a layer of the map's style and the markers are elements of their own: there are a
 * handful of them per file at most, and each carries the note's own icon as HTML — unlike the note
 * markers, which are drawn in their thousands and so are rasterized into one layer (see Markers).
 *
 * The line says which note it belongs to in two ways. It is named along its length, the way a map
 * names a road or a river, so the answer is wherever the reader happens to be looking rather than
 * back at the start pin they may have panned away from. And it carries the note in the feature
 * itself, over a transparent line wide enough to be pointed at, so that right-clicking a track opens
 * the note's own menu (see ContextMenus) — a line three pixels wide being nearly impossible to hit
 * otherwise.
 */
export function GpxTrack({ noteId, title, gpxXmlString, trackColor, startIconHtml, endIconHtml, waypointIconHtml, isDarkTheme, hideLabels }: GpxTrackProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    useEffect(() => {
        if (!parentMap) return;
        // Aliased so the narrowing above carries into the nested functions below.
        const map = parentMap;

        const markers: MapLibreMarker[] = [];
        // Named after the note rather than at random. A random name is a different name on every run
        // of this effect — and it runs again for each of the three icons resolving — so every track
        // used to churn through a handful of sources and layers on its way onto the map, leaving
        // nothing an outside observer could have recognised it by.
        const sourceId = `gpx-source-${noteId}`;
        const layerId = `gpx-layer-${noteId}`;
        const labelLayerId = `gpx-label-${noteId}`;
        const hitLayerId = `${HIT_LAYER_PREFIX}${noteId}`;

        const gpxDoc = new DOMParser().parseFromString(gpxXmlString, "application/xml");
        const lines = readLines(gpxDoc);
        const firstLine = lines[0] ?? [];
        const lastLine = lines[lines.length - 1] ?? [];

        function addMarker(lngLat: [number, number], html: string) {
            const element = document.createElement("div");
            element.className = "geo-marker";
            element.innerHTML = html;

            markers.push(new MapLibreMarker({ element, anchor: "bottom" })
                .setLngLat(lngLat)
                .addTo(map));
        }

        // Markers are elements of the page rather than of the style, so they are added only once.
        // Where the track goes and where it stops, which is the first point of its first line and the
        // last of its last — not one pair per line, since a track broken into segments is still one
        // journey, and a flag at every pause would be a flag at every traffic light.
        if (firstLine.length > 0) {
            if (startIconHtml) {
                addMarker(firstLine[0], startIconHtml);
            }
            const end = lastLine[lastLine.length - 1];
            if (endIconHtml && end && end !== firstLine[0]) {
                addMarker(end, endIconHtml);
            }
        }

        if (waypointIconHtml) {
            for (const waypoint of readPoints(gpxDoc.querySelectorAll("wpt"))) {
                addMarker(waypoint, waypointIconHtml);
            }
        }

        // The track line lives in the map style, which setStyle() wipes (the async vector style
        // arriving, the layer being switched), so it has to be added again on every style load.
        //
        // Each half is put back on its own, and only if it is missing, so that a call made while the
        // map is between two styles leaves nothing half-done: adding the source can succeed and the
        // layer then fail, and a run that took "the source is there" to mean "so is the line" would
        // never draw it. Failing is expected in that window — the style load that follows calls this
        // again, against a style that will have it.
        function addTrackLayer() {
            if (lines.length === 0) return;

            try {
                if (!map.getSource(sourceId)) {
                    map.addSource(sourceId, {
                        type: "geojson",
                        data: {
                            type: "Feature",
                            // The note the line stands for, carried by the feature so that whatever
                            // the pointer lands on can be traced back to it — `id` is what the
                            // context menu opens, and `name` is what the line is labelled with.
                            properties: { id: noteId, name: title },
                            // One line per segment rather than every point strung together: a track
                            // is broken into segments exactly where it stopped being recorded, so
                            // joining them drew a straight line across each gap — through whatever
                            // happened to lie between the end of one segment and the start of the
                            // next.
                            geometry: {
                                type: "MultiLineString",
                                coordinates: lines
                            }
                        }
                    });
                }

                if (!map.getLayer(layerId)) {
                    map.addLayer({
                        id: layerId,
                        type: "line",
                        source: sourceId,
                        layout: {
                            // Otherwise a track doubling back on itself meets its own corners as
                            // spikes, and every segment ends in a flat stub.
                            "line-join": "round",
                            "line-cap": "round"
                        },
                        paint: {
                            "line-color": trackColor ?? "blue",
                            "line-width": 3
                        }
                    });
                }

                // What the pointer is actually aiming at. Transparent and far wider than the line is
                // drawn, because three pixels is not something anyone can reliably hit — and left
                // queryable by being transparent rather than hidden, since MapLibre drops a layer
                // from a query for `visibility: none` but not for being invisible.
                if (!map.getLayer(hitLayerId)) {
                    map.addLayer({
                        id: hitLayerId,
                        type: "line",
                        source: sourceId,
                        paint: {
                            "line-color": trackColor ?? "blue",
                            "line-opacity": 0,
                            "line-width": HIT_WIDTH
                        }
                    });
                }

                // The name, written along the line the way a map writes the name of a road or a
                // river: repeated as the line runs, so which track this is can be read wherever the
                // reader is looking rather than only back at the pin it started from.
                if (!hideLabels && title && !map.getLayer(labelLayerId)) {
                    map.addLayer({
                        id: labelLayerId,
                        type: "symbol",
                        source: sourceId,
                        layout: {
                            "symbol-placement": "line",
                            "text-field": [ "get", "name" ],
                            // The fontstack the styles carry glyphs for — the same one the marker
                            // titles are set in, so a map reads as one map (see Markers, and the
                            // note on `glyphs` in map.tsx).
                            "text-font": [ "Open Sans Regular" ],
                            "text-size": 12,
                            "symbol-spacing": LABEL_SPACING,
                            // Lifted just clear of the line, so the line does not strike through
                            // its own name.
                            "text-offset": [ 0, -0.8 ],
                            // A name is dropped rather than bent around a hairpin, and rather than
                            // laid over a marker's title: every symbol layer shares one collision
                            // index, so the two are placed against each other.
                            "text-max-angle": 30,
                            "text-padding": 4
                        },
                        paint: {
                            ...LABEL_PAINT[isDarkTheme ? "dark" : "light"],
                            "text-halo-width": 2,
                            "text-halo-blur": 1
                        }
                    });
                }
            } catch (e) {
                // Only worth a word if the style was ready and it still would not take the line.
                if (styleLoaded) {
                    console.warn("Geo map: could not draw a GPX track —", e);
                }
            }
        }

        if (styleLoaded) {
            addTrackLayer();
        }
        map.on("style.load", addTrackLayer);

        return () => {
            map.off("style.load", addTrackLayer);
            for (const marker of markers) {
                marker.remove();
            }
            try {
                // Every layer drawing from the source before the source itself: one still in use
                // cannot be removed.
                for (const layer of [ layerId, hitLayerId, labelLayerId ]) {
                    if (map.getLayer(layer)) {
                        map.removeLayer(layer);
                    }
                }
                if (map.getSource(sourceId)) {
                    map.removeSource(sourceId);
                }
            } catch {
                // The map may already have been removed.
            }
        };
    }, [ parentMap, styleLoaded, noteId, title, gpxXmlString, trackColor, startIconHtml, endIconHtml, waypointIconHtml, isDarkTheme, hideLabels ]);

    return <div />;
}

/**
 * The layers standing in for the tracks currently on the map, for whatever wants to hit-test them.
 *
 * Asked of the style each time rather than remembered, because a track is a component of its own and
 * comes and goes with the note it belongs to: a list built once would name layers that have since
 * been taken off, and `queryRenderedFeatures` refuses the whole query — returning nothing at all,
 * rather than skipping the one it cannot find — if a single named layer is missing.
 */
export function trackHitLayers(map: MapLibreGLMap) {
    return map.getLayersOrder().filter((id) => id.startsWith(HIT_LAYER_PREFIX));
}

/**
 * The lines a GPX file draws, one per track segment and one per route.
 *
 * A track is split into segments precisely where the recording stopped and picked up again — a lost
 * signal, a paused watch, a drive home nobody logged — so the segments are kept apart rather than
 * strung together. Routes are lines of the same kind and are read alongside them.
 *
 * Points that name no readable position are dropped. A line of one point is kept: it draws nothing,
 * but it is still where the track began or ended, which is what the markers are placed from.
 */
function readLines(gpxDoc: Document): [number, number][][] {
    const lines: [number, number][][] = [];

    for (const container of gpxDoc.querySelectorAll("trkseg, rte")) {
        const points = readPoints(container.querySelectorAll("trkpt, rtept"));
        if (points.length > 0) {
            lines.push(points);
        }
    }

    // A file whose points sit outside any segment or route is not one the GPX schema allows, but it
    // used to draw as a single line here and there is no reason to stop drawing it. Only reached when
    // the reading above found nothing, so a well-formed file never takes this path.
    if (lines.length === 0) {
        const points = readPoints(gpxDoc.querySelectorAll("trkpt, rtept"));
        if (points.length > 0) {
            lines.push(points);
        }
    }

    return lines;
}

/** The `[lng, lat]` GeoJSON wants, for each point that carries a readable pair. */
function readPoints(points: Iterable<Element>): [number, number][] {
    const coordinates: [number, number][] = [];

    for (const point of points) {
        const lat = parseFloat(point.getAttribute("lat") ?? "");
        const lon = parseFloat(point.getAttribute("lon") ?? "");
        // A point that cannot say where it is is skipped rather than defaulted: falling back to zero
        // put it in the Gulf of Guinea and ran the line out to it and back.
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
        coordinates.push([ lon, lat ]);
    }

    return coordinates;
}
