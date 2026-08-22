import { nominatim } from "./nominatim";

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
     * What the place covers, as `[[west, south], [east, north]]`, where the geocoder says. A street
     * and the city around it are told apart by their extent rather than by one zoom level guessed
     * for both.
     */
    bounds?: [[number, number], [number, number]];
}

export interface GeocodingProvider {
    /** Display name, shown where the user picks a provider. */
    name: string;
    /**
     * Returns matches, best first, or an empty array when nothing matches. Throws when the provider
     * cannot be reached or refuses the request.
     */
    search(query: string): Promise<GeoSearchResult[]>;
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
