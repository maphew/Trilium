import "maplibre-gl/dist/maplibre-gl.css";

import { type ErrorEvent as MapErrorEvent, Map as MapLibreGLMap, MapMouseEvent, NavigationControl, type Point, ScaleControl, type StyleSpecification, type TransformStyleFunction } from "maplibre-gl";
import { ComponentChildren, createContext, RefObject } from "preact";
import { useEffect, useImperativeHandle, useRef, useState } from "preact/hooks";

import { getMeasurementSystem } from "../../../utils/formatters";
import { useElementSize, useSyncedRef, useTriliumOption } from "../../react/hooks";
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
    // What the style this map was last given was made of, which is how the sources and layers on it
    // that are its own are told from the ones a child added. See `keepAdditions`.
    const appliedStyle = useRef<StyleContents>();

    // Initialize the map.
    useEffect(() => {
        if (!containerRef.current) return;

        const initialStyle = buildSyncStyle(layerData);
        appliedStyle.current = typeof initialStyle === "string" ? undefined : styleContents(initialStyle);

        const mapInstance = new MapLibreGLMap({
            container: containerRef.current,
            style: initialStyle,
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

        // An error MapLibre finds no listener for goes to `console.error` with the stack of the
        // fetch that failed, and a tile server answering 403 fails once per tile: a screenful of
        // identical stacks, none of which says anything the first one did not. Listening takes that
        // over, and what is left is one warning per distinct failure, with no stack on it.
        const reported = new Set<string>();
        mapInstance.on("error", ({ error }: MapErrorEvent) => {
            const { key, message } = summarizeMapError(error);
            if (reported.has(key)) return;
            reported.add(key);
            console.warn(`Geo map: ${message}`);
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

        /** Puts a style on the map, carrying what the children added to the last one across. */
        function apply(style: StyleSpecification | string) {
            map?.setStyle(style, { transformStyle: keepAdditions(appliedStyle.current) });
            appliedStyle.current = typeof style === "string" ? undefined : styleContents(style);
        }

        if (layerData.type === "vector" && typeof layerData.style !== "string") {
            layerData.style().then(asyncStyle => {
                // Guard against the layer changing again or the map being torn down while the
                // style was still loading.
                if (cancelled) return;
                apply(asyncStyle);
            });
        } else {
            apply(buildSyncStyle(layerData));
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

    // Scale. Miles or kilometres follow the formatting locale, which the option is read for: the
    // unit is resolved inside the effect, so the control has to be rebuilt when that option changes.
    const [ formattingLocale ] = useTriliumOption("formattingLocale");
    useEffect(() => {
        if (!scale || !map) return;
        const scaleControl = new ScaleControl({ unit: getMeasurementSystem() });
        map.addControl(scaleControl);
        return () => { map.removeControl(scaleControl); };
    }, [ map, scale, formattingLocale ]);

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

/** An HTTP failure as MapLibre reports one: what {@link summarizeMapError} reads off an `AJAXError`. */
interface HttpFailure {
    status: number;
    statusText?: string;
    url: string;
}

function isHttpFailure(error: unknown): error is HttpFailure {
    return (
        typeof error === "object" && error !== null &&
        typeof (error as HttpFailure).status === "number" &&
        typeof (error as HttpFailure).url === "string"
    );
}

/**
 * Says in one line what went wrong, and under what to count it as already said.
 *
 * A tile that cannot be fetched is not an error about that tile: the tile server is unreachable, or
 * refuses us, and every other tile it is asked for will fail the same way. The key therefore names
 * the server and the status rather than the URL, so the hundred tiles behind the first one are
 * recognised as the same failure and stay quiet — the URL is still in the message, as an example of
 * what was asked for.
 */
export function summarizeMapError(error: unknown): { key: string; message: string } {
    if (isHttpFailure(error)) {
        const host = hostOf(error.url);
        const status = [ String(error.status), error.statusText ].filter(Boolean).join(" ");
        return {
            key: `${error.status} ${host}`,
            message: `${host} answered ${status} — could not load ${error.url}`
        };
    }

    const message = error instanceof Error ? error.message : String(error);
    return { key: message, message };
}

/** The server a URL names, or the URL itself where it names none. */
function hostOf(url: string): string {
    try {
        return new URL(url).host;
    } catch {
        return url;
    }
}

/** What a style is made of, by name — all {@link keepAdditions} needs of the one it is given. */
export interface StyleContents {
    sources: Set<string>;
    layers: Set<string>;
}

/**
 * The names of everything in a style, taken now rather than held onto.
 *
 * MapLibre shallow-copies the style it is handed and goes on to change what it made of it, so a
 * style kept as an object is not necessarily the style that was applied by the time it is read back.
 * The names are all that is wanted anyway.
 */
export function styleContents(style: StyleSpecification): StyleContents {
    return {
        sources: new Set(Object.keys(style.sources)),
        layers: new Set(style.layers.map((layer) => layer.id))
    };
}

/**
 * Carries whatever was put on the outgoing style over to the incoming one.
 *
 * A style is a world of its own, and switching one takes every source and layer on the map with it —
 * including those that were never the style's to begin with. The markers and the GPX tracks live on
 * the style because a map has nowhere else to put them, so switching between a light and a dark map
 * took every marker off it and put them back only once the new style had loaded, which is a network
 * away. Handed over here instead, they are part of the incoming style before it is ever applied, and
 * so are never off the map at all.
 *
 * What was added is what the outgoing style has and the style we applied did not, which is why the
 * latter has to be known: everything else in the outgoing style is the old map itself, and carrying
 * that over would leave it drawn on top of the new one. The additions go last, so they stay above
 * the map rather than under it.
 *
 * Note that the images a layer draws with are not part of a style and do not come across (see
 * `Markers`, which puts them back on `style.load`) — and that MapLibre applies this whether it can
 * turn one style into the other or has to build the new one from scratch, so nothing here depends on
 * which of the two it chooses.
 *
 * @param applied the style this map was last given, or `undefined` where it is not known — a style
 *                named by URL, whose contents we never see. Nothing is carried over then, and the
 *                additions are put back on `style.load` as they were before.
 */
export function keepAdditions(applied: StyleContents | undefined): TransformStyleFunction {
    return (previous, next) => {
        if (!applied || !previous) return next;

        const sources = { ...next.sources };
        for (const [ id, source ] of Object.entries(previous.sources)) {
            if (!applied.sources.has(id) && !(id in sources)) {
                sources[id] = source;
            }
        }

        const nextLayers = new Set(next.layers.map((layer) => layer.id));
        const layers = [ ...next.layers ];
        for (const layer of previous.layers) {
            if (!applied.layers.has(layer.id) && !nextLayers.has(layer.id)) {
                layers.push(layer);
            }
        }

        return { ...next, sources, layers };
    };
}
