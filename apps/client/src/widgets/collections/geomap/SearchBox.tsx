import "./SearchBox.css";

import { useCallback, useContext, useRef, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import FormAutocomplete from "../../react/FormAutocomplete";
import Icon from "../../react/Icon";
import OverlayToolbar from "../../react/OverlayToolbar";
import { DEFAULT_GEOCODING_PROVIDER_NAME, GEOCODING_PROVIDERS, type GeoSearchResult } from "./geocoding";
import { ParentMap } from "./map";

/** Shorter queries are not looked up. */
const MIN_QUERY_LENGTH = 2;

/** The zoom level a picked result is shown at. */
const RESULT_ZOOM = 12;

/**
 * A search bar over a geo map that flies the map to the place picked from it.
 *
 * Results come from a `GeocodingProvider`, currently the dummy one.
 *
 * `FormAutocomplete` handles the debounce, the stale-response guard, keyboard navigation and a
 * dropdown portalled out of the map's scrolling container. Its items are strings, so `resultsByLabel`
 * holds the matching `GeoSearchResult` to look up on pick. Results with the same label collapse to
 * one, since they read identically in the list.
 */
export default function SearchBox() {
    const map = useContext(ParentMap);
    const [ query, setQuery ] = useState("");
    const resultsByLabel = useRef(new Map<string, GeoSearchResult>());
    const provider = GEOCODING_PROVIDERS[DEFAULT_GEOCODING_PROVIDER_NAME];

    const source = useCallback(async (currentQuery: string) => {
        const trimmed = currentQuery.trim();
        if (trimmed.length < MIN_QUERY_LENGTH) {
            resultsByLabel.current = new Map();
            return [];
        }

        const results = await provider.search(trimmed);
        resultsByLabel.current = new Map(results.map((result) => [ result.label, result ]));
        return [ ...resultsByLabel.current.keys() ];
    }, [ provider ]);

    const flyToResult = useCallback((label: string) => {
        const result = resultsByLabel.current.get(label);
        if (!result || !map) return;

        setQuery(label);
        map.flyTo({ center: [ result.lng, result.lat ], zoom: RESULT_ZOOM });
    }, [ map ]);

    // The map failed to initialize, e.g. WebGL is unavailable (see map.tsx).
    if (!map) return null;

    return (
        <OverlayToolbar className="geo-search-toolbar" titlePosition="bottom">
            <Icon icon="bx bx-search" className="geo-search-icon" />
            <FormAutocomplete
                className="geo-search-input"
                currentValue={query}
                onChange={setQuery}
                onPick={flyToResult}
                source={source}
                placeholder={t("geo-map.search-placeholder")}
                aria-label={t("geo-map.search")}
            />
        </OverlayToolbar>
    );
}
