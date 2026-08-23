import "./Pois.css";

import { type Map as MapLibreGLMap, type MapGeoJSONFeature, type MapMouseEvent, Popup } from "maplibre-gl";
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
 * How long the pointer has to rest on a place before its name is shown.
 *
 * Shorter than the wait a marker's preview sits out, that one reading a note from the server while
 * this is already in hand — but long enough that sweeping the pointer down a high street does not
 * name every shop on the way past.
 */
const TOOLTIP_DELAY = 200;

/** How far the name stands above the place's icon, which is drawn at half size by the styles. */
const TOOLTIP_OFFSET = 10;

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
            if (map.getZoom() < MIN_POI_ZOOM || isOwnUnderPointer(map, e.point)) return;

            const layers = poiLayers(map);
            if (!layers.length) return;

            const place = poiFromFeature(map.queryRenderedFeatures(e.point, { layers })[0]);
            if (place) {
                onPick(place);
            }
        };

        map.on("click", onClick);
        return () => { map.off("click", onClick); };
    }, [ parentMap, placing, onPick ]);

    /**
     * The name of the place under the pointer, and the pointer itself saying it can be clicked.
     *
     * The styles draw a place as a bare icon: they carry its name but put no label on the map for it,
     * and turning those labels on would set them against the titles of the map's own markers, which
     * give way to whatever is placed before them (see `text-optional` in Markers). Shown on hover
     * instead, the name costs the map nothing until it is asked for.
     */
    useEffect(() => {
        if (!parentMap || placing) return;
        // Aliased so the narrowing above carries into the functions below.
        const map = parentMap;

        const tooltip = new Popup({
            closeButton: false,
            closeOnClick: false,
            // Otherwise MapLibre puts the caret in the popup as it opens, taking the focus out of
            // whatever the user was typing in (see Tooltips).
            focusAfterOpen: false,
            offset: TOOLTIP_OFFSET,
            className: "place-tooltip"
        });

        let bound: string[] = [];
        // The place under the pointer, which is what keeps a name from being shown twice over and
        // from coming back after a click until the pointer has left and returned.
        let hovered: string | null = null;
        let showTimer: ReturnType<typeof setTimeout> | undefined;

        const setCursor = (cursor: string) => { map.getCanvas().style.cursor = cursor; };

        function hide() {
            clearTimeout(showTimer);
            tooltip.remove();
        }

        function onMouseMove(e: MapMouseEvent & { features?: MapGeoJSONFeature[] }) {
            // A marker, a cluster or a track stands above the base map, and owns the pointer along
            // with the click while it does.
            if (map.getZoom() < MIN_POI_ZOOM || isOwnUnderPointer(map, e.point)) {
                hovered = null;
                hide();
                return;
            }

            const place = poiFromFeature(e.features?.[0]);
            if (!place) {
                // A place with no name answers no click either, so the pointer offers none.
                hovered = null;
                setCursor("");
                hide();
                return;
            }

            setCursor("pointer");
            // Watched by the move rather than by `mouseenter`, which fires on entering the layer
            // rather than the place: the pointer crossing from one place to the next never leaves
            // the layer, and the first name would stay up over the second.
            if (place.id === hovered) return;

            hovered = place.id;
            hide();
            showTimer = setTimeout(() => {
                tooltip
                    .setLngLat([ place.lng, place.lat ])
                    .setDOMContent(placeLabel(place))
                    .addTo(map);
            }, TOOLTIP_DELAY);
        }

        function onMouseLeave() {
            hovered = null;
            setCursor("");
            hide();
        }

        /**
         * Puts the name away because the map was clicked, whatever the click was for. `hovered` is
         * kept rather than cleared, which is what stops the name coming back over the panel the
         * click has just opened: the place stays the one under the pointer until the pointer leaves.
         */
        function dismiss() {
            hide();
        }

        function unbind() {
            if (bound.length) {
                map.off("mousemove", bound, onMouseMove);
                map.off("mouseleave", bound, onMouseLeave);
            }
            bound = [];
        }

        function bind() {
            unbind();
            bound = poiLayers(map);
            if (bound.length) {
                map.on("mousemove", bound, onMouseMove);
                map.on("mouseleave", bound, onMouseLeave);
            }
        }

        bind();
        // Switching the style replaces every layer the handlers were bound to.
        map.on("style.load", bind);
        map.on("click", dismiss);

        return () => {
            map.off("style.load", bind);
            map.off("click", dismiss);
            unbind();
            hide();
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

/**
 * Whether the map has something of its own under the pointer — a marker, a cluster, a track or the
 * pin of a place already in hand. Those stand above the base map and answer for it.
 */
function isOwnUnderPointer(map: MapLibreGLMap, point: MapMouseEvent["point"]) {
    const own = [ MARKER_LAYER, PLACE_LAYER, ...CLUSTER_LAYERS, ...trackHitLayers(map) ]
        .filter((id) => map.getLayer(id));

    return own.length > 0 && map.queryRenderedFeatures(point, { layers: own }).length > 0;
}

/** The name of a place and the icon it would wear as a marker, as the tooltip shows them. */
function placeLabel(place: GeoSearchResult) {
    const label = document.createElement("span");
    label.className = "place-tooltip-label";

    if (place.icon) {
        const icon = document.createElement("i");
        icon.className = place.icon;
        label.appendChild(icon);
    }

    const name = document.createElement("span");
    // A place is named by whatever OpenStreetMap holds, which is not ours to read as markup.
    name.textContent = place.name;
    label.appendChild(name);

    return label;
}
