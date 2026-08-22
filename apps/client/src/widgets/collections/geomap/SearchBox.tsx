import "./SearchBox.css";

import { useCallback, useContext, useRef, useState } from "preact/hooks";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { logError } from "../../../services/ws";
import FormAutocomplete from "../../react/FormAutocomplete";
import Icon from "../../react/Icon";
import OverlayToolbar from "../../react/OverlayToolbar";
import { DEFAULT_GEOCODING_PROVIDER_NAME, GEOCODING_PROVIDERS, type GeoSearchResult } from "./geocoding";
import { ParentMap } from "./map";
import { LOCATION_ATTRIBUTE, parseLocation } from "./Markers";

/** Shorter queries are not searched. */
const MIN_QUERY_LENGTH = 2;

/** The zoom level a place from the geocoder is shown at. */
const PLACE_ZOOM = 12;

/** The zoom level a marker is shown at, closer in since a note marks a spot rather than an area. */
const MARKER_ZOOM = 15;

/** Caps how many of the map's own notes the list offers. */
const MAX_MARKER_RESULTS = 8;

/** The key of the row reporting on a geocoder run, which only ever appears once. */
const STATUS_KEY = "geocode-status";

interface SearchBoxProps {
    /** The notes on the map, searched by title. */
    notes: FNote[];
}

/**
 * One row of the result list. `key` identifies it, since `FormAutocomplete` items are strings and two
 * rows can read the same.
 */
type SearchEntry = {
    key: string;
    label: string;
    /** A boxicons class, as `FNote.getIcon()` gives it. */
    icon: string;
} & (
    | { kind: "marker" | "place"; center: [number, number] }
    /** Runs the geocoder for `query`. */
    | { kind: "geocode"; query: string }
    /** Reports on a geocoder run; picking it does nothing. */
    | { kind: "info" }
);

/** A geocoder run, kept so its results can be listed under the query they answer. */
interface GeocodeRun {
    query: string;
    status: "loading" | "done" | "failed";
    results: SearchEntry[];
}

/**
 * A search bar over a geo map, which flies the map to the marker or place picked from it.
 *
 * The map's own notes are matched by title as the user types. The geocoder is not: it costs a request
 * to a third party, and providers rate-limit and discourage per-keystroke lookups, so it sits at the
 * bottom of the list as a row that runs it when picked.
 *
 * `FormAutocomplete` handles the debounce, the stale-response guard, keyboard navigation and a
 * dropdown portalled out of the map's scrolling container. `keepOpenOnPick` keeps the list up so the
 * geocoder row can replace itself with results, so closing it after a marker or place is taken is
 * this component's job — see `dismissed`.
 */
export default function SearchBox({ notes }: SearchBoxProps) {
    const map = useContext(ParentMap);
    const [ query, setQuery ] = useState("");
    const [ geocodeRun, setGeocodeRun ] = useState<GeocodeRun>();
    // Empties the list once a marker or place has been taken, which is what closes the dropdown under
    // `keepOpenOnPick`. Typing again clears it.
    const [ dismissed, setDismissed ] = useState(false);
    const entriesByKey = useRef(new Map<string, SearchEntry>());
    // Discards a run superseded by a later one, since each reports through the same state.
    const latestRun = useRef(0);
    const provider = GEOCODING_PROVIDERS[DEFAULT_GEOCODING_PROVIDER_NAME];

    const source = useCallback(async (currentQuery: string) => {
        const trimmed = currentQuery.trim();
        if (dismissed || trimmed.length < MIN_QUERY_LENGTH) {
            entriesByKey.current = new Map();
            return [];
        }

        const entries = [ ...matchMarkers(notes, trimmed), ...geocodeEntries(geocodeRun, trimmed) ];
        entriesByKey.current = new Map(entries.map((entry) => [ entry.key, entry ]));
        return entries.map((entry) => entry.key);
    }, [ notes, geocodeRun, dismissed ]);

    const changeQuery = useCallback((newQuery: string) => {
        setDismissed(false);
        setQuery(newQuery);
    }, []);

    const runGeocoder = useCallback(async (searchQuery: string) => {
        const runId = ++latestRun.current;
        setGeocodeRun({ query: searchQuery, status: "loading", results: [] });

        try {
            const results = await provider.search(searchQuery);
            if (latestRun.current !== runId) return;
            setGeocodeRun({ query: searchQuery, status: "done", results: results.map(placeEntry) });
        } catch (e) {
            logError(`Geocoding with "${provider.name}" failed: ${e}`);
            if (latestRun.current !== runId) return;
            setGeocodeRun({ query: searchQuery, status: "failed", results: [] });
        }
    }, [ provider ]);

    const pickEntry = useCallback((key: string) => {
        const entry = entriesByKey.current.get(key);
        if (!entry || !map) return;

        if (entry.kind === "geocode") {
            runGeocoder(entry.query);
        } else if (entry.kind === "marker" || entry.kind === "place") {
            setQuery(entry.label);
            setDismissed(true);
            map.flyTo({ center: entry.center, zoom: entry.kind === "marker" ? MARKER_ZOOM : PLACE_ZOOM });
        }
    }, [ map, runGeocoder ]);

    const renderEntry = useCallback((key: string) => {
        const entry = entriesByKey.current.get(key);
        if (!entry) return key;

        return (
            <span className={`geo-search-entry geo-search-entry-${entry.kind}`}>
                <Icon icon={entry.icon} />
                {entry.label}
            </span>
        );
    }, []);

    // The map failed to initialize, e.g. WebGL is unavailable (see map.tsx).
    if (!map) return null;

    return (
        <OverlayToolbar className="geo-search-toolbar" titlePosition="bottom">
            <Icon icon="bx bx-search" className="geo-search-icon" />
            <FormAutocomplete
                className="geo-search-input"
                currentValue={query}
                onChange={changeQuery}
                onPick={pickEntry}
                source={source}
                renderItem={renderEntry}
                keepOpenOnPick
                placeholder={t("geo-map.search-placeholder")}
                aria-label={t("geo-map.search")}
            />
        </OverlayToolbar>
    );
}

/** The notes on the map whose title contains the query and that are drawn somewhere. */
function matchMarkers(notes: FNote[], query: string): SearchEntry[] {
    const needle = query.toLowerCase();
    const matches: SearchEntry[] = [];

    for (const note of notes) {
        if (matches.length >= MAX_MARKER_RESULTS) break;
        if (!note.title.toLowerCase().includes(needle)) continue;

        // A note without a readable location has no marker to fly to. GPX tracks are skipped for the
        // same reason: their route is in the file rather than on a label.
        const center = parseLocation(note.getLabelValue(LOCATION_ATTRIBUTE));
        if (!center) continue;

        matches.push({
            kind: "marker",
            key: `marker:${note.noteId}`,
            label: note.title,
            icon: note.getIcon(),
            center
        });
    }

    return matches;
}

/**
 * What the list offers below the markers: the results of a run answering this query, or the row that
 * starts one. Typing never reaches the provider — picking that row is the only thing that does.
 */
function geocodeEntries(run: GeocodeRun | undefined, query: string): SearchEntry[] {
    if (run?.query !== query) {
        return [ {
            kind: "geocode",
            key: "geocode",
            label: t("geo-map.search-online", { query }),
            icon: "bx bx-search-alt",
            query
        } ];
    }

    if (run.status === "loading") {
        return [ infoEntry(t("geo-map.searching-online"), "bx bx-loader-alt") ];
    }
    if (run.status === "failed") {
        return [ infoEntry(t("geo-map.search-failed"), "bx bx-error-circle") ];
    }
    if (!run.results.length) {
        return [ infoEntry(t("geo-map.no-places-found"), "bx bx-info-circle") ];
    }

    return run.results;
}

function placeEntry(result: GeoSearchResult): SearchEntry {
    return {
        kind: "place",
        key: `place:${result.id}`,
        label: result.label,
        icon: "bx bx-map-pin",
        center: [ result.lng, result.lat ]
    };
}

/** A row that reports on the geocoder rather than offering a place. */
function infoEntry(label: string, icon: string): SearchEntry {
    return { kind: "info", key: STATUS_KEY, label, icon };
}
