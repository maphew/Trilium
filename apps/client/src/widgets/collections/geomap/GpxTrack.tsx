import type { FilterSpecification, Map as MapLibreGLMap } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { GPX_MIME } from "../../../services/gpx";
import { MapStyleLoaded, ParentMap } from "./map";
import { buildMarkerImage, LABEL_LAYOUT, LABEL_PAINT, MARKER_SHADOW_PADDING, markerImageId } from "./Markers";

// Re-exported from the leaf module it moved to (the file preview reads it too, and importing it
// from here would drag the whole map into that bundle), so the map-side consumers keep one home.
export { GPX_MIME };

export interface GpxTrackProps {
    /** The note the track belongs to, which is what its layers are named after and what a click on
     *  any of them resolves to. */
    noteId: string;
    /** What the line is named along its length, and what the start mark wears under its pin. */
    title: string;
    gpxXmlString: string;
    trackColor?: string;
    /** What the marks' pins are filled with — the note's own colour, as its marker would wear it. */
    pinColor: string;
    /** The note's icon, which the start mark wears; the end and the waypoints have icons of their own. */
    iconClass: string;
    /** Whether the map is a dark one, which decides how the names are drawn over it (see Markers). */
    isDarkTheme?: boolean;
    /** Whether the map's titles are hidden (`#map:hideLabels`), the track's names among them. */
    hideLabels?: boolean;
}

/**
 * What a track's hit line is named with.
 *
 * A prefix rather than a fixed name, because every track has layers of its own — see the note on ids
 * below. Anything hit-testing tracks finds the current set by asking the style for its layers and
 * keeping the ones under the pointable prefixes (see {@link trackHitLayers}).
 */
const HIT_LAYER_PREFIX = "gpx-hit-";

/** What a track's marks layer is named with — the flags are as pointable as the line is. */
const MARKS_LAYER_PREFIX = "gpx-marks-";

/** How wide a track is to the pointer, as against the three pixels it is drawn with. */
const HIT_WIDTH = 20;

/** How far apart the name is repeated along the line, in pixels. */
const LABEL_SPACING = 250;

/** What the end of a track is flagged with, and what marks a waypoint along it. */
const END_ICON = "bx bxs-flag-checkered";
const WAYPOINT_ICON = "bx bx-pin";

/**
 * Each layer takes its kind out of the shared source: the line layers draw the lines and the marks
 * layer the points, and neither may pick up the other's features.
 */
const LINES_ONLY: FilterSpecification = [ "==", [ "geometry-type" ], "LineString" ];
const MARKS_ONLY: FilterSpecification = [ "==", [ "geometry-type" ], "Point" ];

/**
 * A GPX file, drawn as a line with a mark at either end and one at every waypoint.
 *
 * The line and the marks alike are layers of the map's style, drawing from one source — the marks
 * used to be DOM elements apiece, a leftover of the Leaflet map, which nothing hit-testing the
 * style could see. As features they are found by the same query that finds the line and the note
 * pins, so clicking or right-clicking a flag means what it means on the track itself; and their
 * pins come out of the shared rasterizer (see Markers), so the start of a track wears exactly the
 * pin its note would wear as a marker.
 *
 * The line says which note it belongs to in two ways. It is named along its length, the way a map
 * names a road or a river, so the answer is wherever the reader happens to be looking rather than
 * back at the start pin they may have panned away from. And it carries the note in the feature
 * itself, over a transparent line wide enough to be pointed at, so that right-clicking a track opens
 * the note's own menu (see ContextMenus) — a line three pixels wide being nearly impossible to hit
 * otherwise.
 */
export function GpxTrack({ noteId, title, gpxXmlString, trackColor, pinColor, iconClass, isDarkTheme, hideLabels }: GpxTrackProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    useEffect(() => {
        if (!parentMap) return;
        // Aliased so the narrowing above carries into the nested functions below.
        const map = parentMap;

        // Named after the note rather than at random. A random name is a different name on every run
        // of this effect, so every track used to churn through a handful of sources and layers on
        // its way onto the map, leaving nothing an outside observer could have recognised it by.
        const sourceId = trackSourceId(noteId);
        const layerId = `gpx-layer-${noteId}`;
        const labelLayerId = `gpx-label-${noteId}`;
        const hitLayerId = `${HIT_LAYER_PREFIX}${noteId}`;
        const marksLayerId = `${MARKS_LAYER_PREFIX}${noteId}`;

        const gpxDoc = new DOMParser().parseFromString(gpxXmlString, "application/xml");
        const lines = readLines(gpxDoc);
        const marks = readMarks(gpxDoc, lines, { noteId, title, pinColor, iconClass });

        // The pins the marks stamp, rasterized off this path: the line must not wait on them, so
        // the layers go up in two halves — the line at once, the marks when their images arrive.
        let images: Map<string, HTMLImageElement> | undefined;
        let cancelled = false;

        // The track lives in the map style, which setStyle() wipes (the async vector style
        // arriving, the layer being switched), so it has to be added again on every style load.
        //
        // Each piece is put back on its own, and only if it is missing, so that a call made while
        // the map is between two styles leaves nothing half-done: adding the source can succeed and
        // a layer then fail, and a run that took "the source is there" to mean "so is the line"
        // would never draw it. Failing is expected in that window — the style load that follows
        // calls this again, against a style that will have it.
        function addTrackLayers() {
            if (lines.length === 0 && marks.length === 0) return;

            try {
                if (!map.getSource(sourceId)) {
                    map.addSource(sourceId, {
                        type: "geojson",
                        data: {
                            type: "FeatureCollection",
                            features: [
                                // One line per segment rather than every point strung together: a
                                // track is broken into segments exactly where it stopped being
                                // recorded, so joining them drew a straight line across each gap.
                                //
                                // The note the line stands for is carried by the feature, so that
                                // whatever the pointer lands on can be traced back to it — `id` is
                                // what a click or the context menu opens, and `name` is what the
                                // line is labelled with. The marks carry the same (see readMarks).
                                ...(lines.length > 0 ? [ {
                                    type: "Feature",
                                    properties: { id: noteId, name: title },
                                    geometry: {
                                        type: "MultiLineString",
                                        coordinates: lines
                                    }
                                } satisfies GeoJSON.Feature ] : []),
                                ...marks
                            ]
                        }
                    });
                }

                if (lines.length > 0) {
                    if (!map.getLayer(layerId)) {
                        map.addLayer({
                            id: layerId,
                            type: "line",
                            source: sourceId,
                            filter: LINES_ONLY,
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

                    // What the pointer is actually aiming at. Transparent and far wider than the
                    // line is drawn, because three pixels is not something anyone can reliably hit —
                    // and left queryable by being transparent rather than hidden, since MapLibre
                    // drops a layer from a query for `visibility: none` but not for being invisible.
                    if (!map.getLayer(hitLayerId)) {
                        map.addLayer({
                            id: hitLayerId,
                            type: "line",
                            source: sourceId,
                            filter: LINES_ONLY,
                            paint: {
                                "line-color": trackColor ?? "blue",
                                "line-opacity": 0,
                                "line-width": HIT_WIDTH
                            }
                        });
                    }

                    // The name, written along the line the way a map writes the name of a road or a
                    // river: repeated as the line runs, so which track this is can be read wherever
                    // the reader is looking rather than only back at the pin it started from.
                    if (!hideLabels && title && !map.getLayer(labelLayerId)) {
                        map.addLayer({
                            id: labelLayerId,
                            type: "symbol",
                            source: sourceId,
                            filter: LINES_ONLY,
                            layout: {
                                "symbol-placement": "line",
                                "text-field": [ "get", "name" ],
                                // The fontstack the styles carry glyphs for — the same one the
                                // marker titles are set in, so a map reads as one map (see Markers,
                                // and the note on `glyphs` in map.tsx).
                                "text-font": [ "Open Sans Regular" ],
                                "text-size": 12,
                                "symbol-spacing": LABEL_SPACING,
                                // Lifted just clear of the line, so the line does not strike through
                                // its own name.
                                "text-offset": [ 0, -0.8 ],
                                // A name is dropped rather than bent around a hairpin, and rather
                                // than laid over a marker's title: every symbol layer shares one
                                // collision index, so the two are placed against each other.
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
                }

                // The marks, held back until their pins have been drawn: a symbol layer added
                // before its images would stamp nothing and warn over each one it cannot find.
                if (images) {
                    for (const [ id, image ] of images) {
                        if (!map.hasImage(id)) {
                            map.addImage(id, image, { pixelRatio: window.devicePixelRatio || 1 });
                        }
                    }

                    if (marks.length > 0 && !map.getLayer(marksLayerId)) {
                        map.addLayer({
                            id: marksLayerId,
                            type: "symbol",
                            source: sourceId,
                            filter: MARKS_ONLY,
                            layout: {
                                "icon-image": [ "get", "icon" ],
                                "icon-size": 1,
                                "icon-anchor": "bottom",
                                // The image carries padding for its shadow, pushed back down by
                                // exactly that much so a mark stands on its coordinate — as the
                                // note pins are (see Markers).
                                "icon-offset": [ 0, MARKER_SHADOW_PADDING ],
                                // A track keeps its flags however crowded the map: a flag dropped
                                // for colliding is a start or an end that has silently left it.
                                "icon-allow-overlap": true,
                                ...LABEL_LAYOUT,
                                ...(hideLabels ? { "text-field": "" } : {})
                            },
                            paint: {
                                ...LABEL_PAINT[isDarkTheme ? "dark" : "light"],
                                "text-halo-width": 2,
                                "text-halo-blur": 1
                            }
                        });
                    }
                }
            } catch (e) {
                // Only worth a word if the style was ready and it still would not take the track.
                if (styleLoaded) {
                    console.warn("Geo map: could not draw a GPX track —", e);
                }
            }
        }

        buildMarkImages(pinColor, iconClass).then((built) => {
            if (cancelled) return;
            images = built;
            if (styleLoaded) {
                addTrackLayers();
            }
        });

        if (styleLoaded) {
            addTrackLayers();
        }
        map.on("style.load", addTrackLayers);

        return () => {
            cancelled = true;
            map.off("style.load", addTrackLayers);
            try {
                // Every layer drawing from the source before the source itself: one still in use
                // cannot be removed.
                for (const layer of [ layerId, hitLayerId, labelLayerId, marksLayerId ]) {
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
    }, [ parentMap, styleLoaded, noteId, title, gpxXmlString, trackColor, pinColor, iconClass, isDarkTheme, hideLabels ]);

    return <div />;
}

/**
 * The one source a track's layers draw from, named here for whoever needs to read the track back
 * off the map — the pane fits the viewport around it when the track is opened (see DetailPane).
 */
export function trackSourceId(noteId: string) {
    return `gpx-source-${noteId}`;
}

/**
 * The layers standing in for the tracks currently on the map, for whatever wants to hit-test them:
 * each track's widened hit line, and the marks that flag it — a flag is as much the track as the
 * line is, and answers with the same note.
 *
 * Asked of the style each time rather than remembered, because a track is a component of its own and
 * comes and goes with the note it belongs to: a list built once would name layers that have since
 * been taken off, and `queryRenderedFeatures` refuses the whole query — returning nothing at all,
 * rather than skipping the one it cannot find — if a single named layer is missing.
 */
export function trackHitLayers(map: MapLibreGLMap) {
    return map.getLayersOrder().filter((id) => id.startsWith(HIT_LAYER_PREFIX) || id.startsWith(MARKS_LAYER_PREFIX));
}

/**
 * The marks a track is flagged with, as features of the same source its line is drawn from: where
 * the whole track begins and where it ends — not one pair per segment, since a track broken into
 * segments is still one journey, and a flag at every pause would be a flag at every traffic light —
 * and one at every waypoint. Only the start says the note's name; the pin says the rest.
 */
function readMarks(gpxDoc: Document, lines: [number, number][][], { noteId, title, pinColor, iconClass }: {
    noteId: string; title: string; pinColor: string; iconClass: string;
}) {
    const marks: GeoJSON.Feature[] = [];

    function addMark(coordinates: [number, number], icon: string, name = "") {
        marks.push({
            type: "Feature",
            geometry: { type: "Point", coordinates },
            properties: { id: noteId, icon: markerImageId(pinColor, icon), name }
        });
    }

    const firstLine = lines[0] ?? [];
    const lastLine = lines[lines.length - 1] ?? [];

    if (firstLine.length > 0) {
        addMark(firstLine[0], iconClass, title);
        const end = lastLine[lastLine.length - 1];
        if (end && end !== firstLine[0]) {
            addMark(end, END_ICON);
        }
    }

    for (const waypoint of readPoints(gpxDoc.querySelectorAll("wpt"))) {
        addMark(waypoint, WAYPOINT_ICON);
    }

    return marks;
}

/**
 * The pins the marks stamp, drawn through the shared rasterizer (see Markers) so the start of a
 * track wears exactly the pin its note would wear as a marker, and the end and the waypoints wear
 * flags of their own in the note's colour. A pin that cannot be drawn is left out, and its mark
 * stamps nothing rather than keeping the rest from going up.
 */
async function buildMarkImages(pinColor: string, iconClass: string) {
    const images = new Map<string, HTMLImageElement>();

    await Promise.all([ iconClass, END_ICON, WAYPOINT_ICON ].map(async (icon) => {
        const image = await buildMarkerImage(pinColor, icon);
        if (image) {
            images.set(markerImageId(pinColor, icon), image);
        }
    }));

    return images;
}

/**
 * The lines a GPX file draws, one per track segment and one per route.
 *
 * A track is split into segments precisely where the recording stopped and picked up again — a lost
 * signal, a paused watch, a drive home nobody logged — so the segments are kept apart rather than
 * strung together. Routes are lines of the same kind and are read alongside them.
 *
 * Points that name no readable position are dropped. A line of one point is kept: it draws nothing,
 * but it is still where the track began or ended, which is what the marks are placed from.
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
