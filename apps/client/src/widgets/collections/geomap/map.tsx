import { useEffect, useImperativeHandle, useRef } from "preact/hooks";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { type MapLayer } from "./map_layer";
import { ComponentChildren, createContext, RefObject } from "preact";
import { useElementSize, useSyncedRef } from "../../react/hooks";

export interface GeoMouseEvent {
    latlng: { lat: number; lng: number };
    originalEvent: MouseEvent;
}

export const ParentMap = createContext<maplibregl.Map | null>(null);

interface MapProps {
    apiRef?: RefObject<maplibregl.Map | null>;
    containerRef?: RefObject<HTMLDivElement>;
    coordinates: { lat: number; lng: number } | [number, number];
    zoom: number;
    layerData: MapLayer;
    viewportChanged: (coordinates: { lat: number; lng: number }, zoom: number) => void;
    children: ComponentChildren;
    onClick?: (e: GeoMouseEvent) => void;
    onContextMenu?: (e: GeoMouseEvent) => void;
    onZoom?: () => void;
    scale: boolean;
}

function toGeoMouseEvent(e: maplibregl.MapMouseEvent): GeoMouseEvent {
    return {
        latlng: { lat: e.lngLat.lat, lng: e.lngLat.lng },
        originalEvent: e.originalEvent
    };
}

/** Builds the style that can be applied synchronously: the raster style spec, a vector style URL
 * or the vector fallback style used as a placeholder until the real style loads asynchronously. */
function buildSyncStyle(layerData: MapLayer): maplibregl.StyleSpecification | string {
    if (layerData.type === "vector") {
        return typeof layerData.style === "string"
            ? layerData.style
            : layerData.styleFallback as maplibregl.StyleSpecification;
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

export default function Map({ coordinates, zoom, layerData, viewportChanged, children, onClick, onContextMenu, scale, apiRef, containerRef: _containerRef, onZoom }: MapProps) {
    const mapRef = useRef<maplibregl.Map>(null);
    const containerRef = useSyncedRef<HTMLDivElement>(_containerRef);

    useImperativeHandle(apiRef ?? null, () => mapRef.current);

    // Initialize the map.
    useEffect(() => {
        if (!containerRef.current) return;

        const mapInstance = new maplibregl.Map({
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

        mapRef.current = mapInstance;

        return () => {
            mapInstance.remove();
            mapRef.current = null;
        };
    }, []);

    // React to layer changes. Also runs after the initial map creation, which is a no-op for the
    // synchronous styles (setStyle diffs against the current style) but loads the asynchronous
    // vector styles for the first time.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        let cancelled = false;

        if (layerData.type === "vector" && typeof layerData.style !== "string") {
            layerData.style().then(asyncStyle => {
                // Guard against the layer changing again or the map being torn down while the
                // style was still loading.
                if (cancelled || mapRef.current !== map) return;
                map.setStyle(asyncStyle as maplibregl.StyleSpecification);
            });
        } else {
            map.setStyle(buildSyncStyle(layerData));
        }

        return () => {
            cancelled = true;
        };
    }, [ layerData ]);

    // React to coordinate changes.
    useEffect(() => {
        if (!mapRef.current) return;
        mapRef.current.setCenter(toCenter(coordinates));
        mapRef.current.setZoom(zoom);
    }, [ coordinates, zoom ]);

    // Viewport callback. MapLibre fires "moveend" for every camera change, including zooming.
    useEffect(() => {
        const map = mapRef.current;
        if (!map) return;

        const updateFn = () => {
            const center = map.getCenter();
            viewportChanged({ lat: center.lat, lng: center.lng }, map.getZoom());
        };
        map.on("moveend", updateFn);

        return () => {
            map.off("moveend", updateFn);
        };
    }, [ viewportChanged ]);

    useEffect(() => {
        const map = mapRef.current;
        if (!onClick || !map) return;

        const handler = (e: maplibregl.MapMouseEvent) => onClick(toGeoMouseEvent(e));
        map.on("click", handler);
        return () => { map.off("click", handler); };
    }, [ onClick ]);

    useEffect(() => {
        const map = mapRef.current;
        if (!onContextMenu || !map) return;

        const handler = (e: maplibregl.MapMouseEvent) => {
            e.preventDefault();
            onContextMenu(toGeoMouseEvent(e));
        };
        map.on("contextmenu", handler);
        return () => { map.off("contextmenu", handler); };
    }, [ onContextMenu ]);

    useEffect(() => {
        const map = mapRef.current;
        if (!onZoom || !map) return;

        map.on("zoom", onZoom);
        return () => { map.off("zoom", onZoom); };
    }, [ onZoom ]);

    // Scale
    useEffect(() => {
        const map = mapRef.current;
        if (!scale || !map) return;
        const scaleControl = new maplibregl.ScaleControl();
        map.addControl(scaleControl);
        return () => { map.removeControl(scaleControl); };
    }, [ scale ]);

    // Adapt to container size changes.
    const size = useElementSize(containerRef);
    useEffect(() => {
        mapRef.current?.resize();
    }, [ size?.width, size?.height ]);

    return (
        <div
            ref={containerRef}
            className={`geo-map-container ${layerData.isDarkTheme ? "dark" : ""}`}
        >
            <ParentMap.Provider value={mapRef.current}>
                {children}
            </ParentMap.Provider>
        </div>
    );
}
