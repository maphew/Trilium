import { getCurrentLanguage } from "../../../services/i18n";
import type { GeocodingProvider, GeoSearchResult } from "./geocoding";

const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";

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
 */
export const nominatim: GeocodingProvider = {
    name: "Nominatim (OpenStreetMap)",
    search: searchNominatim
};

async function searchNominatim(query: string): Promise<GeoSearchResult[]> {
    const params = new URLSearchParams({
        q: query,
        format: "jsonv2",
        limit: String(MAX_RESULTS)
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

    return {
        id: String(place.place_id ?? `${lat},${lng}`),
        label: place.display_name,
        // Nominatim leaves `name` empty for a result that is an address rather than a named place,
        // where the leading part of the label is what names it.
        name: place.name || place.display_name.split(",")[0].trim(),
        lat,
        lng,
        bounds: toBounds(place.boundingbox)
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
