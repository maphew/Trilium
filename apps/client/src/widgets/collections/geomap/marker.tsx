import { useContext, useEffect, useRef } from "preact/hooks";
import { ParentMap, GeoMouseEvent } from "./map";
import maplibregl from "maplibre-gl";

export interface MarkerProps {
    coordinates: [ number, number ];
    iconHtml?: string;
    iconSize?: [number, number];
    onClick?: () => void;
    onMouseDown?: (e: MouseEvent) => void;
    onDragged?: ((newCoordinates: { lat: number; lng: number }) => void);
    onContextMenu: (e: GeoMouseEvent) => void;
    draggable?: boolean;
}

export default function Marker({ coordinates, iconHtml, iconSize, draggable, onClick, onDragged, onMouseDown, onContextMenu }: MarkerProps) {
    const parentMap = useContext(ParentMap);
    const markerRef = useRef<maplibregl.Marker>(null);

    useEffect(() => {
        if (!parentMap) return;

        const el = document.createElement("div");
        el.className = "geo-marker";
        if (iconHtml) {
            el.innerHTML = iconHtml;
        }
        if (iconSize) {
            el.style.width = `${iconSize[0]}px`;
            el.style.height = `${iconSize[1]}px`;
        }

        const newMarker = new maplibregl.Marker({
            element: el,
            draggable: !!draggable,
            anchor: "bottom"
        })
        .setLngLat([coordinates[1], coordinates[0]])
        .addTo(parentMap);

        markerRef.current = newMarker;

        if (onClick) {
            el.addEventListener("click", (e) => {
                e.stopPropagation();
                onClick();
            });
        }

        if (onMouseDown) {
            el.addEventListener("mousedown", (e) => {
                if (e.button === 1) {
                    e.stopPropagation();
                    onMouseDown(e);
                }
            });
        }

        if (onDragged) {
            newMarker.on("dragend", () => {
                const lngLat = newMarker.getLngLat();
                onDragged({ lat: lngLat.lat, lng: lngLat.lng });
            });
        }

        if (onContextMenu) {
            el.addEventListener("contextmenu", (e) => {
                e.stopPropagation();
                e.preventDefault();
                const lngLat = newMarker.getLngLat();
                onContextMenu({
                    latlng: { lat: lngLat.lat, lng: lngLat.lng },
                    originalEvent: e
                });
            });
        }

        return () => {
            newMarker.remove();
            markerRef.current = null;
        };
    }, [ parentMap, coordinates, onMouseDown, onDragged, iconHtml ]);

    return (<div />);
}

export interface GpxTrackProps {
    gpxXmlString: string;
    trackColor?: string;
    startIconHtml?: string;
    endIconHtml?: string;
    waypointIconHtml?: string;
}

export function GpxTrack({ gpxXmlString, trackColor, startIconHtml, endIconHtml, waypointIconHtml }: GpxTrackProps) {
    const parentMap = useContext(ParentMap);

    useEffect(() => {
        if (!parentMap) return;

        const markers: maplibregl.Marker[] = [];
        const sourceId = `gpx-source-${Math.random().toString(36).slice(2)}`;
        const layerId = `gpx-layer-${sourceId}`;

        const parser = new DOMParser();
        const gpxDoc = parser.parseFromString(gpxXmlString, "application/xml");

        // Parse tracks and routes.
        const coordinates: [number, number][] = [];
        for (const pt of gpxDoc.querySelectorAll("trkpt, rtept")) {
            const lat = parseFloat(pt.getAttribute("lat") ?? "0");
            const lon = parseFloat(pt.getAttribute("lon") ?? "0");
            coordinates.push([lon, lat]);
        }

        function addMarker(lngLat: [number, number], html: string) {
            const el = document.createElement("div");
            el.className = "geo-marker";
            el.innerHTML = html;
            const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
                .setLngLat(lngLat)
                .addTo(parentMap!);
            markers.push(marker);
        }

        // Markers are DOM-based and independent of the map style, so they are added only once.
        if (coordinates.length > 0) {
            if (startIconHtml) {
                addMarker(coordinates[0], startIconHtml);
            }
            if (endIconHtml && coordinates.length > 1) {
                addMarker(coordinates[coordinates.length - 1], endIconHtml);
            }
        }

        if (waypointIconHtml) {
            for (const wpt of gpxDoc.querySelectorAll("wpt")) {
                const lat = parseFloat(wpt.getAttribute("lat") ?? "0");
                const lon = parseFloat(wpt.getAttribute("lon") ?? "0");
                addMarker([lon, lat], waypointIconHtml);
            }
        }

        // The track line lives in the map style, which setStyle() wipes (async vector style
        // arrival, layer switching), so it must be re-added on every style load.
        function addTrackLayer() {
            if (coordinates.length === 0 || parentMap!.getSource(sourceId)) return;

            parentMap!.addSource(sourceId, {
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

            parentMap!.addLayer({
                id: layerId,
                type: "line",
                source: sourceId,
                paint: {
                    "line-color": trackColor ?? "blue",
                    "line-width": 3
                }
            });
        }

        if (parentMap.isStyleLoaded()) {
            addTrackLayer();
        }
        parentMap.on("style.load", addTrackLayer);

        return () => {
            parentMap.off("style.load", addTrackLayer);
            for (const m of markers) {
                m.remove();
            }
            try {
                if (parentMap.getLayer(layerId)) {
                    parentMap.removeLayer(layerId);
                }
                if (parentMap.getSource(sourceId)) {
                    parentMap.removeSource(sourceId);
                }
            } catch {
                // Map may be already removed.
            }
        };
    }, [ parentMap, gpxXmlString, trackColor, startIconHtml, endIconHtml, waypointIconHtml ]);

    return <div />;
}
