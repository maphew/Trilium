import { getCurrentLanguage } from "../../../services/i18n";
import type { GeoBounds, GeocodingProvider, GeoSearchOptions, GeoSearchResult } from "./geocoding";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_LOOKUP_URL = "https://nominatim.openstreetmap.org/lookup";

/**
 * How coarsely a boundary is simplified, in degrees — roughly 100 m. At full detail a country runs to
 * megabytes, and a border drawn over a map is not read to the metre.
 */
const POLYGON_THRESHOLD = 0.001;

/** How a lookup names an OSM object, from how a search result names one. */
const OSM_TYPE_PREFIX: Record<string, string> = { node: "N", way: "W", relation: "R" };

/** The kinds of OSM object that can enclose ground. A node is a single point and has no boundary. */
const OSM_TYPES_WITH_A_BOUNDARY = new Set([ "way", "relation" ]);

/**
 * The least ground a search treats as here, as a half-span in metres.
 *
 * A map zoomed into a neighbourhood shows a few hundred metres across, and a search restricted to
 * exactly that answers nothing for a shop three streets away. What the reader means by searching from
 * where they are standing is the town they are looking at, not the block.
 */
const MIN_SEARCH_RADIUS_M = 25_000;

/** Metres to a degree of latitude, the same the world over. A degree of longitude is this shortened
 *  by the cosine of the latitude. */
const METRES_PER_DEGREE = 111_320;

/** Caps how many results one search returns. */
const MAX_RESULTS = 8;

/**
 * Nominatim's usage policy allows at most one request per second, and blocks clients that exceed it.
 * See https://operations.osmfoundation.org/policies/nominatim/.
 */
const MIN_REQUEST_INTERVAL = 1000;

/** When the next request is allowed to go out, moved forward by every request that is queued. */
let nextRequestAt = 0;

/**
 * Nominatim, the geocoder run by the OpenStreetMap Foundation.
 *
 * No API key, and it answers with `Access-Control-Allow-Origin: *`, so the browser can ask it
 * directly — which matters on desktop, where the page is served from `trilium-app://`. Its policy
 * also asks that clients identify themselves, which a browser can only do through the `Referer` it
 * sends of its own accord.
 *
 * The same policy rules out searching as the user types, which is why a search runs only when the
 * user asks for one (see SearchBox).
 *
 * A search is answered in two passes where the map says what it is showing, so that what is at hand
 * comes first and what is far off still comes at all (see searchNominatim).
 */
export const nominatim: GeocodingProvider = {
    name: "Nominatim (OpenStreetMap)",
    search: searchNominatim
};

async function searchNominatim(query: string, { viewport }: GeoSearchOptions = {}): Promise<GeoSearchResult[]> {
    const viewbox = toViewbox(viewport);

    // What the map is showing, and nothing else. A viewbox on its own is only a nudge next to how
    // well known a place is, so a supermarket in the town on screen stays buried under the towns of
    // that name across the world — restricting the search to the view is what brings it up.
    const nearby = viewbox ? await searchPlaces(query, { viewbox, bounded: "1" }) : [];
    if (nearby.length >= MAX_RESULTS) {
        return nearby;
    }

    // Then the wider world, so that a place nowhere near the map is still found, and a view holding
    // one match is not the whole answer. What is at hand stands above it either way.
    const elsewhere = await searchPlaces(query, viewbox ? { viewbox } : {});

    return dedupe([ ...nearby, ...elsewhere ]).slice(0, MAX_RESULTS);
}

/**
 * Drops a place already offered, keeping the first of them — which is the nearest, the passes running
 * that way round.
 *
 * By what it says as well as by which place it is. A shop and the building around it are two OSM
 * objects under one name and one address, and two rows a reader cannot tell apart are one answer
 * given twice.
 */
function dedupe(places: GeoSearchResult[]): GeoSearchResult[] {
    const seen = new Set<string>();

    return places.filter((place) => {
        if (seen.has(place.id) || seen.has(place.label)) {
            return false;
        }

        seen.add(place.id);
        seen.add(place.label);
        return true;
    });
}

/** One request to Nominatim's search, asked in the language the app runs in. */
async function searchPlaces(query: string, extraParams: Record<string, string>): Promise<GeoSearchResult[]> {
    const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        limit: String(MAX_RESULTS),
        ...extraParams
    });

    // Place names in the language the app runs in, where Nominatim holds one. Trilium writes some
    // locale ids with an underscore (`pt_br`), which is not what a language tag looks like.
    const language = getCurrentLanguage();
    if (language) {
        params.set("accept-language", language.replace("_", "-"));
    }

    await waitForRequestSlot();
    const response = await fetch(`${NOMINATIM_URL}?${params}`);
    if (!response.ok) {
        throw new Error(`Nominatim answered ${response.status} ${response.statusText}`);
    }

    const places: NominatimPlace[] = await response.json();
    return places.map(toSearchResult).filter((result) => result !== null);
}

/** One entry of a Nominatim `jsonv2` response, narrowed to the fields a result is built from. */
interface NominatimPlace {
    place_id?: number;
    osm_type?: string;
    osm_id?: number;
    display_name?: string;
    name?: string;
    lat?: string;
    lon?: string;
    /** `[south, north, west, east]`, as strings, which is the order Nominatim writes it in. */
    boundingbox?: string[];
}

/** A place as the app holds one, or `null` where the entry carries no readable position. */
function toSearchResult(place: NominatimPlace): GeoSearchResult | null {
    const lat = Number(place.lat);
    const lng = Number(place.lon);
    if (!place.display_name || !Number.isFinite(lat) || !Number.isFinite(lng)) {
        return null;
    }

    const prefix = OSM_TYPE_PREFIX[place.osm_type ?? ""];
    const osmId = prefix && place.osm_id ? `${prefix}${place.osm_id}` : null;
    const hasBoundary = OSM_TYPES_WITH_A_BOUNDARY.has(place.osm_type ?? "");

    return {
        // What OSM calls the place, where it says: `place_id` is Nominatim's own numbering, and the
        // public service runs several instances that number independently, so the same place comes
        // back under two of them and is offered twice.
        id: osmId ?? String(place.place_id ?? `${lat},${lng}`),
        label: place.display_name,
        // Nominatim leaves `name` empty for a result that is an address rather than a named place,
        // where the leading part of the label is what names it.
        name: place.name || place.display_name.split(",")[0].trim(),
        lat,
        lng,
        bounds: toBounds(place.boundingbox),
        outline: osmId && hasBoundary ? () => fetchOutline(osmId) : undefined
    };
}

/** The extent Nominatim reports, as MapLibre reads one, or nothing where it cannot be read. */
function toBounds(boundingbox: string[] | undefined): GeoSearchResult["bounds"] {
    if (boundingbox?.length !== 4) {
        return undefined;
    }

    const [ south, north, west, east ] = boundingbox.map(Number);
    if (![ south, north, west, east ].every(Number.isFinite)) {
        return undefined;
    }

    // A place spanning the antimeridian is reported west of east, which frames the whole world the
    // long way round. Rare enough to be left to the fallback zoom rather than split in two.
    if (west > east) {
        return undefined;
    }

    return [ [ west, south ], [ east, north ] ];
}

/**
 * What the map is showing, as Nominatim reads a preferred area: two opposite corners, longitude
 * first. Sent without `bounded` on the wider pass, so a place is ranked up for being in view rather
 * than a place out of view being refused.
 *
 * Grown to at least {@link MIN_SEARCH_RADIUS_M} about its middle, since a view of one neighbourhood
 * restricts a search to that neighbourhood and answers nothing for the next street over.
 *
 * A view running the other way round has been panned across the antimeridian, which no pair of
 * corners describes; nothing is sent for one, and the search is answered as if from nowhere.
 */
function toViewbox(viewport: GeoBounds | undefined) {
    if (!viewport) {
        return null;
    }

    const [ [ west, south ], [ east, north ] ] = viewport;
    if (!(west < east)) {
        return null;
    }

    const middleLat = (south + north) / 2;
    const middleLng = (west + east) / 2;
    const latitudePad = MIN_SEARCH_RADIUS_M / METRES_PER_DEGREE;
    // A degree of longitude shortens towards the poles, where it is short enough that padding by one
    // would reach around the world; the cosine is floored to keep the padding finite.
    const longitudePad = latitudePad / Math.max(Math.cos(middleLat * Math.PI / 180), 0.01);

    return [
        clamp(Math.min(west, middleLng - longitudePad), -180, 180),
        clamp(Math.min(south, middleLat - latitudePad), -90, 90),
        clamp(Math.max(east, middleLng + longitudePad), -180, 180),
        clamp(Math.max(north, middleLat + latitudePad), -90, 90)
    ].map((degrees) => Number(degrees.toFixed(5))).join(",");
}

function clamp(value: number, least: number, most: number) {
    return Math.min(Math.max(value, least), most);
}

/**
 * The boundary of one OSM object, simplified, or `null` where it has none to draw.
 *
 * A lookup of its own rather than `polygon_geojson` on the search: a search answers with eight places
 * and the boundaries of the seven that go unlooked-at are the bulk of what would be carried.
 */
async function fetchOutline(osmId: string): Promise<GeoJSON.Geometry | null> {
    const params = new URLSearchParams({
        osm_ids: osmId,
        format: "jsonv2",
        polygon_geojson: "1",
        polygon_threshold: String(POLYGON_THRESHOLD)
    });

    await waitForRequestSlot();
    const response = await fetch(`${NOMINATIM_LOOKUP_URL}?${params}`);
    if (!response.ok) {
        throw new Error(`Nominatim answered ${response.status} ${response.statusText}`);
    }

    const [ place ]: { geojson?: GeoJSON.Geometry }[] = await response.json();
    const geometry = place?.geojson;
    // A shape that is a point or a line is what the pin already says, drawn again.
    return geometry?.type === "Polygon" || geometry?.type === "MultiPolygon" ? geometry : null;
}

/**
 * Holds a request back until the interval the policy asks for has passed since the last one.
 *
 * The slot is claimed before the wait rather than after it, so two searches started at once queue
 * behind each other instead of both finding the same slot free.
 */
async function waitForRequestSlot() {
    const now = Date.now();
    const slot = Math.max(now, nextRequestAt);
    nextRequestAt = slot + MIN_REQUEST_INTERVAL;

    if (slot > now) {
        await new Promise((resolve) => setTimeout(resolve, slot - now));
    }
}
