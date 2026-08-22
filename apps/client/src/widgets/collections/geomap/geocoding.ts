import { nominatim } from "./nominatim";

/** A rectangle of ground, as `[[west, south], [east, north]]`. */
export type GeoBounds = [[number, number], [number, number]];

export interface GeoSearchOptions {
    /**
     * What the map is showing. A place inside it is preferred to one of the same name elsewhere —
     * searching for a shop while looking at Corfu should not answer with the branch in Finland.
     *
     * A preference rather than a restriction: the only match for a query is worth offering wherever
     * it stands.
     */
    viewport?: GeoBounds;
}

/** A single place returned by a geocoder. */
export interface GeoSearchResult {
    /** Unique within one result set. */
    id: string;
    /** Display text, with enough context to tell two places of the same name apart. */
    label: string;
    /** The place's own name, for labelling it on the map where the full label would be a paragraph. */
    name: string;
    lat: number;
    lng: number;
    /**
     * What the place covers, where the geocoder says. A street and the city around it are told apart
     * by their extent rather than by one zoom level guessed for both.
     */
    bounds?: GeoBounds;
    /**
     * Fetches the boundary of the place — a country's coastline, a county's border — or `null` where
     * it has none worth drawing. Absent where the provider cannot supply one at all.
     *
     * A call rather than a value, so the boundary is asked for only once a place has been picked: a
     * search returns several places and at most one of them is ever looked at.
     */
    outline?: () => Promise<GeoJSON.Geometry | null>;
}

export interface GeocodingProvider {
    /** Display name, shown where the user picks a provider. */
    name: string;
    /**
     * Returns matches, best first, or an empty array when nothing matches. Throws when the provider
     * cannot be reached or refuses the request.
     */
    search(query: string, options?: GeoSearchOptions): Promise<GeoSearchResult[]>;
}

/**
 * The geocoders a map can search, keyed by the name a note selects one by.
 *
 * Same shape as `MAP_LAYERS` in map_layer.ts, so both are read the same way.
 */
export const GEOCODING_PROVIDERS: Record<string, GeocodingProvider> = {
    "nominatim": nominatim
};

export const DEFAULT_GEOCODING_PROVIDER_NAME: keyof typeof GEOCODING_PROVIDERS = "nominatim";
