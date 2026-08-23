import type { Map as MapLibreGLMap } from "maplibre-gl";

import type { GeoSearchResult } from "./geocoding";

/** One of the things a search turned up: a note of the map's own, or a place from the geocoder. */
export type SearchResult =
    | { kind: "note"; noteId: string; center: [number, number] }
    | { kind: "place"; place: GeoSearchResult };

/** The zoom level a place is shown at where the geocoder does not say how much ground it covers. */
const PLACE_ZOOM = 12;

/** The zoom level a note is shown at, closer in since it marks a spot rather than an area. */
const NOTE_ZOOM = 15;

/**
 * How close a place is framed at most. A house's extent is a few metres across, which on its own
 * would fill the screen with the roof.
 */
const PLACE_MAX_ZOOM = 17;

/** The room kept around a framed place, so its pin and name do not sit against the map's edge. */
const PLACE_PADDING = 60;

/**
 * Points the map at one of a search's results.
 *
 * A place is framed on the ground it covers, where the geocoder says how much that is: one zoom
 * level suited to a city shows a street as the city around it. A note marks a spot and has no extent
 * to frame, and neither has a place the geocoder gave no bounding box for.
 */
export function frameResult(map: MapLibreGLMap, result: SearchResult) {
    if (result.kind === "place" && result.place.bounds) {
        map.fitBounds(result.place.bounds, { padding: PLACE_PADDING, maxZoom: PLACE_MAX_ZOOM });
        return;
    }

    const center: [number, number] = result.kind === "place"
        ? [ result.place.lng, result.place.lat ]
        : result.center;

    map.flyTo({ center, zoom: result.kind === "place" ? PLACE_ZOOM : NOTE_ZOOM });
}
