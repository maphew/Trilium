import { Marker as MapLibreMarker } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { MapStyleLoaded, ParentMap } from "./map";

export interface GpxTrackProps {
    gpxXmlString: string;
    trackColor?: string;
    startIconHtml?: string;
    endIconHtml?: string;
    waypointIconHtml?: string;
}

/**
 * A GPX file, drawn as a line with a marker at either end and one at every waypoint.
 *
 * The line is a layer of the map's style and the markers are elements of their own: there are a
 * handful of them per file at most, and each carries the note's own icon as HTML — unlike the note
 * markers, which are drawn in their thousands and so are rasterized into one layer (see Markers).
 */
export function GpxTrack({ gpxXmlString, trackColor, startIconHtml, endIconHtml, waypointIconHtml }: GpxTrackProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    useEffect(() => {
        if (!parentMap) return;
        // Aliased so the narrowing above carries into the nested functions below.
        const map = parentMap;

        const markers: MapLibreMarker[] = [];
        const sourceId = `gpx-source-${Math.random().toString(36).slice(2)}`;
        const layerId = `gpx-layer-${sourceId}`;

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
                            properties: {},
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
                        paint: {
                            "line-color": trackColor ?? "blue",
                            "line-width": 3
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
                if (map.getLayer(layerId)) {
                    map.removeLayer(layerId);
                }
                if (map.getSource(sourceId)) {
                    map.removeSource(sourceId);
                }
            } catch {
                // The map may already have been removed.
            }
        };
    }, [ parentMap, styleLoaded, gpxXmlString, trackColor, startIconHtml, endIconHtml, waypointIconHtml ]);

    return <div />;
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
