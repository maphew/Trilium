import "maplibre-gl/dist/maplibre-gl.css";

import { Map as MapLibreGLMap, MapMouseEvent, NavigationControl, type Point, ScaleControl, type StyleSpecification } from "maplibre-gl";
import { ComponentChildren, createContext, RefObject } from "preact";
import { useEffect, useImperativeHandle, useState } from "preact/hooks";

import { useElementSize, useSyncedRef } from "../../react/hooks";
import { type MapLayer } from "./map_layer";

export interface GeoMouseEvent {
    latlng: { lat: number; lng: number };
    originalEvent: MouseEvent;
    /** Where the event landed in the container, for hit-testing against the rendered layers. */
    point: Point;
}

export const ParentMap = createContext<MapLibreGLMap | null>(null);

interface MapProps {
    apiRef?: RefObject<MapLibreGLMap | null>;
    containerRef?: RefObject<HTMLDivElement>;
    coordinates: { lat: number; lng: number } | [number, number];
    zoom: number;
    layerData: MapLayer;
    viewportChanged: (coordinates: { lat: number; lng: number }, zoom: number) => void;
    children: ComponentChildren;
    onClick?: (e: GeoMouseEvent) => void;
    scale: boolean;
}

export function toGeoMouseEvent(e: MapMouseEvent): GeoMouseEvent {
    return {
        latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
        originalEvent: e.originalEvent,
        point: e.point
    };
}

/** Builds the style that can be applied synchronously: the raster style spec, a vector style URL
 * or the vector fallback style used as a placeholder until the real style loads asynchronously. */
function buildSyncStyle(layerData: MapLayer): StyleSpecification | string {
    if (layerData.type === "vector") {
        return typeof layerData.style === "string"
            ? layerData.style
            : layerData.styleFallback;
    }

    return {
        version: 8,
        sources: {
            "raster-tiles": {
                type: "raster",
                tiles: [ layerData.url ],
                tileSize: 256,
                attribution: layerData.attribution
            }
        },
        layers: [
            {
                id: "raster-layer",
                type: "raster",
                source: "raster-tiles"
            }
        ]
    };
}

function toCenter(coordinates: { lat: number; lng: number } | [number, number]): [number, number] {
    return Array.isArray(coordinates)
        ? [ coordinates[1], coordinates[0] ]
        : [ coordinates.lng, coordinates.lat ];
}

export default function Map({ coordinates, zoom, layerData, viewportChanged, children, onClick, scale, apiRef, containerRef: _containerRef }: MapProps) {
    // State rather than a ref: the children below read the map off the context, so its creation has
    // to produce a render or they would only ever see the null it started as.
    const [ map, setMap ] = useState<MapLibreGLMap | null>(null);
    const containerRef = useSyncedRef<HTMLDivElement>(_containerRef);

    useImperativeHandle(apiRef ?? null, () => map);

    // Initialize the map.
    useEffect(() => {
        if (!containerRef.current) return;

        const mapInstance = new MapLibreGLMap({
            container: containerRef.current,
            style: buildSyncStyle(layerData),
            center: toCenter(coordinates),
            zoom,
            minZoom: 2,
            // No explicit maxBounds: a bounds whose longitude range spans the full world
            // (-180..180) crashes MapLibre — the east edge wraps to -180, collapsing the range
            // to zero width and making the constrain zoom infinite (a singular-matrix null
            // deref). With renderWorldCopies disabled, MapLibre itself constrains panning to a
            // single world (substituting an almost-full-world longitude range that avoids the
            // collapse) and clamps latitude to the Mercator limit, which is the Leaflet-parity
            // behavior we want.
            renderWorldCopies: false
        });

        // Zoom buttons, which Leaflet added of its own accord. No compass: nothing here persists a
        // bearing, so the button would offer to undo a rotation the map never remembers.
        mapInstance.addControl(new NavigationControl({
            showCompass: false,
            showZoom: true
        }), "top-left");

        setMap(mapInstance);

        return () => {
            mapInstance.remove();
            setMap(null);
        };
    }, []);

    // React to layer changes. Also runs after the initial map creation, which is a no-op for the
    // synchronous styles (setStyle diffs against the current style) but loads the asynchronous
    // vector styles for the first time.
    useEffect(() => {
        if (!map) return;

        let cancelled = false;

        if (layerData.type === "vector" && typeof layerData.style !== "string") {
            layerData.style().then(asyncStyle => {
                // Guard against the layer changing again or the map being torn down while the
                // style was still loading.
                if (cancelled) return;
                map.setStyle(asyncStyle);
            });
        } else {
            map.setStyle(buildSyncStyle(layerData));
        }

        return () => {
            cancelled = true;
        };
    }, [ map, layerData ]);

    // React to coordinate changes.
    useEffect(() => {
        if (!map) return;
        map.setCenter(toCenter(coordinates));
        map.setZoom(zoom);
    }, [ map, coordinates, zoom ]);

    // Viewport callback. MapLibre fires "moveend" for every camera change, including zooming.
    useEffect(() => {
        if (!map) return;

        const updateFn = () => {
            const center = map.getCenter();
            viewportChanged({ lat: center.lat, lng: center.lng }, map.getZoom());
        };
        map.on("moveend", updateFn);

        return () => {
            map.off("moveend", updateFn);
        };
    }, [ map, viewportChanged ]);

    useEffect(() => {
        if (!onClick || !map) return;

        const handler = (e: MapMouseEvent) => onClick(toGeoMouseEvent(e));
        map.on("click", handler);
        return () => { map.off("click", handler); };
    }, [ map, onClick ]);

    // Scale
    useEffect(() => {
        if (!scale || !map) return;
        const scaleControl = new ScaleControl();
        map.addControl(scaleControl);
        return () => { map.removeControl(scaleControl); };
    }, [ map, scale ]);

    // Adapt to container size changes.
    const size = useElementSize(containerRef);
    useEffect(() => {
        map?.resize();
    }, [ map, size?.width, size?.height ]);

    return (
        <div
            ref={containerRef}
            className={`geo-map-container ${layerData.isDarkTheme ? "dark" : ""}`}
        >
            <ParentMap.Provider value={map}>
                {children}
            </ParentMap.Provider>
        </div>
    );
}
