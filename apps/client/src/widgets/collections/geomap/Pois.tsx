import type { Map as MapLibreGLMap, MapGeoJSONFeature, MapMouseEvent } from "maplibre-gl";
import { useContext, useEffect } from "preact/hooks";

import { CLUSTER_LAYERS } from "./clusters";
import type { GeoSearchResult } from "./geocoding";
import { trackHitLayers } from "./GpxTrack";
import { MapStyleLoaded, ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";
import { placeIcon } from "./osm_icons";
import { PLACE_LAYER } from "./PlaceMarker";

/** The source layer the vector styles draw shops, cafes and the rest of the base map's places from. */
const POI_SOURCE_LAYER = "pois";

/**
 * The zoom a place answers a click from. The styles put their places on at zoom 16 but fade them in
 * over the zoom that follows, and a place that cannot yet be seen is not one anybody means to click.
 */
const MIN_POI_ZOOM = 17;

/**
 * The OSM keys a tile classifies a place by, in the order the styles draw them. A feature carries at
 * most a few of these, and the first one present is what the place is.
 */
const POI_TAG_KEYS = [
    "amenity",
    "leisure",
    "tourism",
    "shop",
    "man_made",
    "historic",
    "emergency",
    "highway",
    "office"
];

interface PoisProps {
    /** A click is armed to place a marker, so it does not also mean "tell me about this place". */
    placing: boolean;
    /** Reports the place clicked on the base map, for the caller to stand the map on. */
    onPick(place: GeoSearchResult): void;
}

/**
 * Makes the places the base map already draws — a cafe, a pharmacy, a museum — answer a click.
 *
 * The vector styles draw them from the `pois` source layer, which carries each place's name and the
 * OSM tags that say what kind of place it is. Both are read out of the tile the map has already
 * downloaded, so a click costs no request and the place can be kept as a marker without typing its
 * name (see `keepPlaceAsMarker` in index.tsx).
 *
 * Nothing to draw of its own: a picked place is handed back and stands under the same pin and panel a
 * searched one does (see PlaceMarker and PlacePanel).
 *
 * The raster layer has its places baked into the image and Neutrino carries none, so there is nothing
 * to hit-test under either and a click falls through to what it meant before.
 */
export default function Pois({ placing, onPick }: PoisProps) {
    const parentMap = useContext(ParentMap);
    const styleLoaded = useContext(MapStyleLoaded);

    useEffect(() => {
        if (!parentMap || placing) return;
        // Aliased so the narrowing above carries into the handler below.
        const map = parentMap;

        const onClick = (e: MapMouseEvent) => {
            if (map.getZoom() < MIN_POI_ZOOM) return;

            const layers = poiLayers(map);
            if (!layers.length) return;

            // A marker, a cluster or a track stands above the base map and answers the click first.
            const own = ownLayers(map);
            if (own.length && map.queryRenderedFeatures(e.point, { layers: own }).length) return;

            const place = poiFromFeature(map.queryRenderedFeatures(e.point, { layers })[0]);
            if (place) {
                onPick(place);
            }
        };

        map.on("click", onClick);
        return () => { map.off("click", onClick); };
    }, [ parentMap, placing, onPick ]);

    // The pointer is what says a place can be clicked: the base map draws it as an icon like any
    // other, and nothing else about it invites a click.
    useEffect(() => {
        if (!parentMap || placing) return;
        // Aliased so the narrowing above carries into the functions below.
        const map = parentMap;
        let bound: string[] = [];

        const setCursor = (cursor: string) => { map.getCanvas().style.cursor = cursor; };
        const onEnter = () => {
            if (map.getZoom() >= MIN_POI_ZOOM) {
                setCursor("pointer");
            }
        };
        const onLeave = () => setCursor("");

        function unbind() {
            for (const layer of bound) {
                map.off("mouseenter", layer, onEnter);
                map.off("mouseleave", layer, onLeave);
            }
            bound = [];
        }

        function bind() {
            unbind();
            bound = poiLayers(map);
            for (const layer of bound) {
                map.on("mouseenter", layer, onEnter);
                map.on("mouseleave", layer, onLeave);
            }
        }

        bind();
        // Switching the style replaces every layer the handlers were bound to.
        map.on("style.load", bind);

        return () => {
            map.off("style.load", bind);
            unbind();
            // The pointer is put back by hand, since this can be torn down while it sits on a place
            // and the `mouseleave` that would have cleared it is no longer listened for.
            setCursor("");
        };
    }, [ parentMap, placing, styleLoaded ]);

    return null;
}

/**
 * The place a tile feature stands for, or `null` where it is not one worth standing the map on.
 *
 * A place with no name is skipped: what names a marker would be the bare OSM tag, and "Bench" is not
 * what anyone means to keep. The click then falls through to what it meant before.
 */
export function poiFromFeature(feature: MapGeoJSONFeature | undefined): GeoSearchResult | null {
    if (feature?.geometry.type !== "Point") {
        return null;
    }

    const properties = feature.properties ?? {};
    // The styles load their English variant, so a place is named the way the rest of the map is.
    const name = String(properties.name_en || properties.name || "").trim();
    if (!name) {
        return null;
    }

    const [ lng, lat ] = feature.geometry.coordinates;
    const category = POI_TAG_KEYS.find((key) => properties[key]);

    return {
        id: `poi:${feature.id ?? `${lng},${lat}`}`,
        name,
        // A tile carries no address, so the panel has nothing to say under the name (see PlacePanel).
        label: name,
        lat,
        lng,
        icon: placeIcon({ category, type: category ? String(properties[category]) : undefined })
    };
}

/**
 * The layers of the current style that draw places, for hit-testing against.
 *
 * Read off the style each time rather than remembered: the styles name these layers differently, and
 * `queryRenderedFeatures` answers nothing at all — rather than skipping the one it cannot find — if a
 * single named layer is missing.
 */
export function poiLayers(map: MapLibreGLMap) {
    return map.getLayersOrder().filter((id) => map.getLayer(id)?.sourceLayer === POI_SOURCE_LAYER);
}

/** The layers the map draws its own notes and tracks on, which stand above the base map. */
function ownLayers(map: MapLibreGLMap) {
    return [ MARKER_LAYER, PLACE_LAYER, ...CLUSTER_LAYERS, ...trackHitLayers(map) ]
        .filter((id) => map.getLayer(id));
}
