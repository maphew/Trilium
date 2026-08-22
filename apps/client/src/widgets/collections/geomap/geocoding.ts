/** A single place returned by a geocoder. */
export interface GeoSearchResult {
    /** Unique within one result set. */
    id: string;
    /** Display text, with enough context to tell two places of the same name apart. */
    label: string;
    lat: number;
    lng: number;
}

export interface GeocodingProvider {
    /** Display name, shown where the user picks a provider. */
    name: string;
    /** Returns matches, best first, or an empty array when nothing matches. */
    search(query: string): Promise<GeoSearchResult[]>;
}

/**
 * The geocoders a map can search, keyed by the name a note selects one by.
 *
 * Same shape as `MAP_LAYERS` in map_layer.ts, so both are read the same way. Only the dummy provider
 * exists so far; a real one is a new entry here.
 */
export const GEOCODING_PROVIDERS: Record<string, GeocodingProvider> = {
    "dummy": {
        name: "Dummy",
        search: searchDummyPlaces
    }
};

export const DEFAULT_GEOCODING_PROVIDER_NAME: keyof typeof GEOCODING_PROVIDERS = "dummy";

/** The places `searchDummyPlaces()` matches against. */
const DUMMY_PLACES: GeoSearchResult[] = [
    { id: "dummy-amsterdam", label: "Amsterdam, Netherlands", lat: 52.3676, lng: 4.9041 },
    { id: "dummy-berlin", label: "Berlin, Germany", lat: 52.52, lng: 13.405 },
    { id: "dummy-bucharest", label: "Bucharest, Romania", lat: 44.4268, lng: 26.1025 },
    { id: "dummy-cluj", label: "Cluj-Napoca, Cluj, Romania", lat: 46.7712, lng: 23.6236 },
    { id: "dummy-lisbon", label: "Lisbon, Portugal", lat: 38.7223, lng: -9.1393 },
    { id: "dummy-london", label: "London, England, United Kingdom", lat: 51.5072, lng: -0.1276 },
    { id: "dummy-london-on", label: "London, Ontario, Canada", lat: 42.9849, lng: -81.2453 },
    { id: "dummy-new-york", label: "New York, New York, United States", lat: 40.7128, lng: -74.006 },
    { id: "dummy-paris", label: "Paris, Île-de-France, France", lat: 48.8566, lng: 2.3522 },
    { id: "dummy-reykjavik", label: "Reykjavík, Iceland", lat: 64.1466, lng: -21.9426 },
    { id: "dummy-sydney", label: "Sydney, New South Wales, Australia", lat: -33.8688, lng: 151.2093 },
    { id: "dummy-tokyo", label: "Tokyo, Japan", lat: 35.6762, lng: 139.6503 }
];

/** Caps how many results one search returns. */
const MAX_RESULTS = 8;

/**
 * Matches `DUMMY_PLACES` by substring, so the search bar works before a real geocoder is wired up.
 * Async like a real provider, so callers cannot depend on results arriving in the same tick.
 */
async function searchDummyPlaces(query: string): Promise<GeoSearchResult[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) {
        return [];
    }

    return DUMMY_PLACES
        .filter((place) => place.label.toLowerCase().includes(needle))
        .slice(0, MAX_RESULTS);
}
