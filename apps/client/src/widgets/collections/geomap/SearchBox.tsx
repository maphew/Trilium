import "./SearchBox.css";

import clsx from "clsx";
import { useCallback, useContext, useRef, useState } from "preact/hooks";

import type { Map as MapLibreGLMap } from "maplibre-gl";

import type FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { logError } from "../../../services/ws";
import { getMeasurementSystem } from "../../../utils/formatters";
import { formatDistance } from "../../../utils/units";
import FormAutocomplete from "../../react/FormAutocomplete";
import Icon from "../../react/Icon";
import OverlayToolbar, { OverlayToolbarButton } from "../../react/OverlayToolbar";
import { DEFAULT_GEOCODING_PROVIDER_NAME, DEFAULT_PLACE_ICON, type GeoBounds, GEOCODING_PROVIDERS, type GeoSearchResult, SEARCH_RADIUS_M } from "./geocoding";
import { ParentMap } from "./map";
import { LOCATION_ATTRIBUTE, parseLocation } from "./Markers";

/** Shorter queries are not searched. */
const MIN_QUERY_LENGTH = 2;

/** The zoom level a place is shown at where the geocoder does not say how much ground it covers. */
const PLACE_ZOOM = 12;

/**
 * How close a place is framed at most. A house's extent is a few metres across, which on its own
 * would fill the screen with the roof.
 */
const PLACE_MAX_ZOOM = 17;

/** The room kept around a framed place, so its pin and name do not sit against the map's edge. */
const PLACE_PADDING = 60;

/** The zoom level a marker is shown at, closer in since a note marks a spot rather than an area. */
const MARKER_ZOOM = 15;

/** The mean radius of the Earth, which is what a great-circle distance is measured on. */
const EARTH_RADIUS_M = 6_371_008.8;

/**
 * How wide the result list is drawn. The field is a corner of the map, while what it offers is whole
 * addresses, which at the field's own width is mostly an ellipsis.
 */
const RESULT_LIST_WIDTH = 500;

/** Caps how many of the map's own notes the list offers. */
const MAX_MARKER_RESULTS = 8;

/** The key of the row reporting on a geocoder run, which only ever appears once. */
const STATUS_KEY = "geocode-status";


interface SearchBoxProps {
    /** The notes on the map, searched by title. */
    notes: FNote[];
    /**
     * Reports the place picked from the list, or none where the reader has moved on from it — a note
     * of the map's own taken instead, or the field emptied. What is done with it is the map's (see
     * `pickPlace` in index.tsx).
     */
    onPickPlace(place: GeoSearchResult | null): void;
}

/**
 * One row of the result list. `key` identifies it, since `FormAutocomplete` items are strings and two
 * rows can read the same.
 */
type SearchEntry = {
    key: string;
    label: string;
    /** A boxicons class, as `FNote.getIcon()` gives it. Headings have none. */
    icon?: string;
    /** How far the place is from the middle of the map, in metres. */
    distance?: number;
} & (
    | { kind: "marker"; center: [number, number] }
    /** A place from the geocoder, carried whole for whoever the pick is reported to. */
    | { kind: "place"; center: [number, number]; result: GeoSearchResult }
    /** Names the run of rows below it; not a choice (see `isHeading` on FormAutocomplete). */
    | { kind: "heading" }
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
 * bottom of the list as a row that runs it when picked. It is told what the map is showing, so that
 * what is nearby is preferred to what merely shares a name.
 *
 * A place taken from the geocoder is pinned where it stands, since flying to a spot the map has
 * nothing at otherwise leaves the user to work out which patch of ground was meant. The pin stands
 * until another is taken or the field is emptied.
 *
 * The rows are the choices themselves rather than help with typing, so the first stands ready and
 * Enter takes it — `autoActivate`, as the attribute pickers use it. From a field holding nothing but
 * a name, that is: Enter, which runs the geocoder, and Enter again, which takes what it found.
 *
 * `FormAutocomplete` handles the debounce, the stale-response guard, keyboard navigation and a
 * dropdown portalled out of the map's scrolling container. `keepOpenOnPick` keeps the list up so the
 * geocoder row can replace itself with results, so closing it after a marker or place is taken is
 * this component's job — see `dismissed`.
 */
export default function SearchBox({ notes, onPickPlace }: SearchBoxProps) {
    const map = useContext(ParentMap);
    const [ query, setQuery ] = useState("");
    const [ geocodeRun, setGeocodeRun ] = useState<GeocodeRun>();
    // Empties the list once a marker or place has been taken, which is what closes the dropdown under
    // `keepOpenOnPick`. Typing again clears it.
    const [ dismissed, setDismissed ] = useState(false);
    const inputRef = useRef<HTMLInputElement>(null);
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

        // Measured from the middle of what the map is showing, at the moment the list is built: two
        // places of the same name are told apart by which of them is at hand.
        const origin = map ? map.getCenter().toArray() : null;
        const { places, notice } = geocodeEntries(geocodeRun, trimmed);
        const found = [ ...matchMarkers(notes, trimmed), ...places ]
            .map((entry) => withDistance(entry, origin));
        const entries = [ ...byDistance(found), ...(notice ? [ notice ] : []) ];
        entriesByKey.current = new Map(entries.map((entry) => [ entry.key, entry ]));
        return entries.map((entry) => entry.key);
    }, [ notes, geocodeRun, dismissed, map ]);

    const changeQuery = useCallback((newQuery: string) => {
        setDismissed(false);
        setQuery(newQuery);
        // Emptying the field is how the pin is taken back off the map.
        if (!newQuery.trim()) {
            onPickPlace(null);
        }
    }, [ onPickPlace ]);

    const runGeocoder = useCallback(async (searchQuery: string) => {
        const runId = ++latestRun.current;
        setGeocodeRun({ query: searchQuery, status: "loading", results: [] });

        try {
            // Where the map is looking, so a shop searched for from Corfu is answered with the one in
            // Corfu rather than the one in Finland.
            const results = await provider.search(searchQuery, { viewport: map ? viewportOf(map) : undefined });
            if (latestRun.current !== runId) return;
            setGeocodeRun({ query: searchQuery, status: "done", results: results.map(placeEntry) });
        } catch (e) {
            logError(`Geocoding with "${provider.name}" failed: ${e}`);
            if (latestRun.current !== runId) return;
            setGeocodeRun({ query: searchQuery, status: "failed", results: [] });
        }
    }, [ provider, map ]);

    /** Empties the field, which is also what takes a searched place off the map (see `changeQuery`). */
    const clearSearch = useCallback(() => {
        changeQuery("");
        // The field is where the reader was, and clearing it is rarely the end of searching.
        inputRef.current?.focus();
    }, [ changeQuery ]);

    const pickEntry = useCallback((key: string) => {
        const entry = entriesByKey.current.get(key);
        if (!entry || !map) return;

        if (entry.kind === "geocode") {
            runGeocoder(entry.query);
        } else if (entry.kind === "marker" || entry.kind === "place") {
            setDismissed(true);
            // A note of the map's own has a marker already; only a place needs one put down for it.
            onPickPlace(entry.kind === "place" ? entry.result : null);

            const bounds = entry.kind === "place" ? entry.result.bounds : undefined;
            if (bounds) {
                // Framed by what the place covers rather than flown to at a level guessed for every
                // place alike: one zoom that suits a city shows a street as the city around it.
                map.fitBounds(bounds, { padding: PLACE_PADDING, maxZoom: PLACE_MAX_ZOOM });
            } else {
                map.flyTo({ center: entry.center, zoom: entry.kind === "marker" ? MARKER_ZOOM : PLACE_ZOOM });
            }
        }
    }, [ map, runGeocoder, onPickPlace ]);

    const isHeading = useCallback(
        (key: string) => entriesByKey.current.get(key)?.kind === "heading", []);

    const renderEntry = useCallback((key: string) => {
        const entry = entriesByKey.current.get(key);
        if (!entry) return key;

        if (entry.kind === "heading") {
            return entry.label;
        }

        // A place reads over two lines: what it is called, and the address that places it. Every
        // other row is one thing said once.
        const address = entry.kind === "place" ? addressOf(entry.label, entry.result.name) : null;

        return (
            <span className={`geo-search-entry geo-search-entry-${entry.kind}`}>
                <Icon icon={entry.icon} />
                <span className="geo-search-entry-lines">
                    {entry.kind === "place"
                        ? <>
                            <span className="geo-search-entry-name">{entry.result.name}</span>
                            {address && <span className="geo-search-entry-address">{address}</span>}
                        </>
                        : entry.label}
                </span>
                {entry.distance !== undefined &&
                    <span className="geo-search-entry-distance">
                        {formatDistance(entry.distance, getMeasurementSystem())}
                    </span>}
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
                inputRef={inputRef}
                currentValue={query}
                onChange={changeQuery}
                onPick={pickEntry}
                source={source}
                renderItem={renderEntry}
                isHeading={isHeading}
                dropdownMinWidth={RESULT_LIST_WIDTH}
                autoActivate
                keepOpenOnPick
                placeholder={t("geo-map.search-placeholder")}
                aria-label={t("geo-map.search")}
            />
            {/* Kept in the bar whether or not there is anything to clear, and only shown when there
                is: a button coming and going would take the bar's width with it, moving the field
                under the reader mid-word. */}
            <OverlayToolbarButton
                className={clsx("geo-search-clear", query && "shown")}
                icon="bx bx-x"
                text={t("options.search_clear")}
                onClick={clearSearch}
            />
        </OverlayToolbar>
    );
}

/**
 * How far a row's place stands from where the map is looking, for the rows that stand anywhere: the
 * geocoder's row and its reports name no place, and a map that could not be drawn is looking nowhere.
 */
function withDistance(entry: SearchEntry, origin: [number, number] | null): SearchEntry {
    if (!origin || !("center" in entry)) {
        return entry;
    }

    return { ...entry, distance: metresBetween(origin, entry.center) };
}

/** The great-circle metres between two `[lng, lat]` points. */
function metresBetween([ lngA, latA ]: [number, number], [ lngB, latB ]: [number, number]) {
    const toRadians = Math.PI / 180;
    const deltaLat = (latB - latA) * toRadians;
    const deltaLng = (lngB - lngA) * toRadians;
    const h = Math.sin(deltaLat / 2) ** 2
        + Math.cos(latA * toRadians) * Math.cos(latB * toRadians) * Math.sin(deltaLng / 2) ** 2;

    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/** What the map is showing, as a geocoder reads a preferred area. */
function viewportOf(map: MapLibreGLMap): GeoBounds {
    const bounds = map.getBounds();
    return [ [ bounds.getWest(), bounds.getSouth() ], [ bounds.getEast(), bounds.getNorth() ] ];
}

/**
 * What a label says beyond the place's own name, which is the address around it — "Ōta, Japan" of
 * "Tokyo, Ōta, Japan". A label that does not begin with the name is left whole, having nothing to
 * repeat.
 */
function addressOf(label: string, name: string) {
    const rest = label.startsWith(name) ? label.slice(name.length) : label;
    return rest.replace(/^[\s,]+/, "");
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
 * What the geocoder has to offer for this query: the places a run answering it found, and whatever
 * has to be said about the run — the row that starts one, or a word on how the last one went.
 *
 * The two are separated because they belong in different parts of the list: places are sorted in
 * among the map's own notes, and a notice stands at the foot whatever the distances say.
 */
function geocodeEntries(run: GeocodeRun | undefined, query: string): {
    places: SearchEntry[];
    notice: SearchEntry | null;
} {
    if (run?.query !== query) {
        return {
            places: [],
            notice: {
                kind: "geocode",
                key: "geocode",
                label: t("geo-map.search-online", { query }),
                icon: "bx bx-search-alt",
                query
            }
        };
    }

    if (run.status === "loading") {
        return { places: [], notice: infoEntry(t("geo-map.searching-online"), "bx bx-loader-alt") };
    }
    if (run.status === "failed") {
        return { places: [], notice: infoEntry(t("geo-map.search-failed"), "bx bx-error-circle") };
    }
    if (!run.results.length) {
        return { places: [], notice: infoEntry(t("geo-map.no-places-found"), "bx bx-info-circle") };
    }

    return { places: run.results, notice: null };
}

/**
 * The places found, nearest first, under headings that say which are at hand and which are not — a
 * shop down the road and one on another continent are both answers to the same name, and the list
 * used to run them together.
 *
 * Headings only where there is something on both sides of {@link SEARCH_RADIUS_M}: one name over one
 * run of rows distinguishes it from nothing.
 */
function byDistance(entries: SearchEntry[]): SearchEntry[] {
    const sorted = [ ...entries ].sort((a, b) => (a.distance ?? Infinity) - (b.distance ?? Infinity));
    const atHand = sorted.filter((entry) => (entry.distance ?? Infinity) <= SEARCH_RADIUS_M);
    const further = sorted.slice(atHand.length);

    if (!atHand.length || !further.length) {
        return sorted;
    }

    return [
        headingEntry("nearby", t("geo-map.results-nearby")),
        ...atHand,
        headingEntry("far", t("geo-map.results-far")),
        ...further
    ];
}

function headingEntry(key: string, label: string): SearchEntry {
    return { kind: "heading", key: `heading:${key}`, label };
}

function placeEntry(result: GeoSearchResult): SearchEntry {
    return {
        kind: "place",
        key: `place:${result.id}`,
        label: result.label,
        icon: result.icon ?? DEFAULT_PLACE_ICON,
        center: [ result.lng, result.lat ],
        result
    };
}

/** A row that reports on the geocoder rather than offering a place. */
function infoEntry(label: string, icon: string): SearchEntry {
    return { kind: "info", key: STATUS_KEY, label, icon };
}
