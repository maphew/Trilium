import { Marker as MapLibreMarker } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { ParentMap } from "./map";

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

    useEffect(() => {
        if (!parentMap) return;
        // Aliased so the narrowing above carries into the nested functions below.
        const map = parentMap;

        const markers: MapLibreMarker[] = [];
        const sourceId = `gpx-source-${Math.random().toString(36).slice(2)}`;
        const layerId = `gpx-layer-${sourceId}`;

        const gpxDoc = new DOMParser().parseFromString(gpxXmlString, "application/xml");

        // Parse tracks and routes.
        const coordinates: [number, number][] = [];
        for (const point of gpxDoc.querySelectorAll("trkpt, rtept")) {
            const lat = parseFloat(point.getAttribute("lat") ?? "0");
            const lon = parseFloat(point.getAttribute("lon") ?? "0");
            coordinates.push([ lon, lat ]);
        }

        function addMarker(lngLat: [number, number], html: string) {
            const element = document.createElement("div");
            element.className = "geo-marker";
            element.innerHTML = html;

            markers.push(new MapLibreMarker({ element, anchor: "bottom" })
                .setLngLat(lngLat)
                .addTo(map));
        }

        // Markers are elements of the page rather than of the style, so they are added only once.
        if (coordinates.length > 0) {
            if (startIconHtml) {
                addMarker(coordinates[0], startIconHtml);
            }
            if (endIconHtml && coordinates.length > 1) {
                addMarker(coordinates[coordinates.length - 1], endIconHtml);
            }
        }

        if (waypointIconHtml) {
            for (const waypoint of gpxDoc.querySelectorAll("wpt")) {
                const lat = parseFloat(waypoint.getAttribute("lat") ?? "0");
                const lon = parseFloat(waypoint.getAttribute("lon") ?? "0");
                addMarker([ lon, lat ], waypointIconHtml);
            }
        }

        // The track line lives in the map style, which setStyle() wipes (the async vector style
        // arriving, the layer being switched), so it has to be added again on every style load.
        function addTrackLayer() {
            if (coordinates.length === 0 || map.getSource(sourceId)) return;

            map.addSource(sourceId, {
                type: "geojson",
                data: {
                    type: "Feature",
                    properties: {},
                    geometry: {
                        type: "LineString",
                        coordinates
                    }
                }
            });

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

        if (map.isStyleLoaded()) {
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
    }, [ parentMap, gpxXmlString, trackColor, startIconHtml, endIconHtml, waypointIconHtml ]);

    return <div />;
}
