import "./index.css";

import type { Map as MapLibreGLMap } from "maplibre-gl";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import { getReadableTextColor } from "../../../services/css_class_manager";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import { renderIconImage } from "../../../services/icon_glyphs";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { escapeHtml } from "../../../services/utils";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import { ButtonOrActionButton } from "../../react/Button";
import { useCollectionTreeDrag, useNoteBlob, useNoteLabel, useNoteLabelBoolean, useNoteProperty, useSpacedUpdate, useTriliumEvent } from "../../react/hooks";
import { ViewModeProps } from "../interface";
import { createNewNote, moveMarker } from "./api";
import ContextMenus from "./ContextMenus";
import { GpxTrack } from "./GpxTrack";
import Map, { GeoMouseEvent } from "./map";
import { DEFAULT_MAP_LAYER_NAME, MAP_LAYERS, MapLayer } from "./map_layer";
import MapToolbar from "./MapToolbar";
import Markers, { LOCATION_ATTRIBUTE } from "./Markers";
import Tooltips from "./Tooltips";

const DEFAULT_COORDINATES: [number, number] = [3.878638227135724, 446.6630455551659];
const DEFAULT_ZOOM = 2;

export { LOCATION_ATTRIBUTE };

interface MapData {
    view?: {
        center?: { lat: number; lng: number } | [number, number];
        zoom?: number;
    };
}

enum State {
    Normal,
    NewNote
}

export default function GeoView({ note, noteIds, viewConfig, saveConfig }: ViewModeProps<MapData>) {
    const [ state, setState ] = useState(State.Normal);
    const [ coordinates, setCoordinates ] = useState(viewConfig?.view?.center);
    const [ zoom, setZoom ] = useState(viewConfig?.view?.zoom);
    const [ hasScale ] = useNoteLabelBoolean(note, "map:scale");
    const [ hideLabels ] = useNoteLabelBoolean(note, "map:hideLabels");
    const [ clustered ] = useNoteLabelBoolean(note, "map:cluster");
    const [ isReadOnly ] = useNoteLabelBoolean(note, "readOnly");
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    const [ notes, setNotes ] = useState<FNote[]>([]);
    const layerData = useLayerData(note);
    const spacedUpdate = useSpacedUpdate(() => {
        if (viewConfig) {
            saveConfig(viewConfig);
        }
    }, 5000);

    useEffect(() => { froca.getNotes(noteIds).then(setNotes); }, [ noteIds ]);

    useEffect(() => {
        if (!note) return;
        setCoordinates(viewConfig?.view?.center ?? DEFAULT_COORDINATES);
        setZoom(viewConfig?.view?.zoom ?? DEFAULT_ZOOM);
    }, [ note, viewConfig ]);

    // Note creation. Scoped to this map instance via a local callback rather than the global
    // geoMapCreateChildNote command: embedded maps share no note context (no distinct ntxId), so a
    // broadcast command would arm placement mode on every map at once. The button is this command's
    // only trigger, so a direct handler keeps it isolated to the clicked map.
    const startNotePlacement = useCallback(() => setState(State.NewNote), []);

    // Placement mode (NewNote) is armed by the button. Tying the instruction toast and the global
    // Escape-to-cancel listener to the state (rather than the click handler) guarantees both are
    // torn down on cancel, on completion (map click) and on unmount — otherwise the listener leaks
    // and a fresh one accumulates on every placement cycle.
    useEffect(() => {
        if (state !== State.NewNote) return;

        toast.showPersistent({
            icon: "plus",
            id: "geo-new-note",
            title: t("geo-map.create-child-note-toast-title"),
            message: t("geo-map.create-child-note-instruction")
        });

        const globalKeyListener = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setState(State.Normal);
            }
        };
        window.addEventListener("keydown", globalKeyListener);

        return () => {
            window.removeEventListener("keydown", globalKeyListener);
            toast.closePersistent("geo-new-note");
        };
    }, [ state ]);

    useTriliumEvent("deleteFromMap", ({ noteId }) => {
        moveMarker(noteId, null);
    });

    const onClick = useCallback(async (e: GeoMouseEvent) => {
        if (state === State.NewNote) {
            // Leaving NewNote closes the instruction toast via the placement-mode effect cleanup.
            await createNewNote(note, e);
            setState(State.Normal);
        }
    }, [ note, state ]);

    // Dragging
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<MapLibreGLMap>(null);
    useCollectionTreeDrag(containerRef, {
        dragEnabled: !isReadOnly,
        includeArchived,
        async callback(treeData, e) {
            const api = apiRef.current;
            // treeData is non-empty in practice (useNoteTreeDrag drops empty payloads), but guard
            // explicitly so the treeData[0] access can't throw.
            if (!note || !api || isReadOnly || !treeData.length) return [];

            const { noteId } = treeData[0];

            const offset = containerRef.current?.getBoundingClientRect();
            const x = e.clientX - (offset?.left ?? 0);
            const y = e.clientY - (offset?.top ?? 0);
            const lngLat = api.unproject([ x, y ]);
            const latlng = { lat: lngLat.lat, lng: lngLat.lng };

            const targetNote = await froca.getNote(noteId, true);
            const parents = targetNote?.getParentNoteIds();
            if (parents?.includes(note.noteId)) {
                await moveMarker(noteId, latlng);
                return [];
            }

            await branches.cloneNoteToParentNote(noteId, note.noteId);
            await moveMarker(noteId, latlng);
            return [ noteId ];
        }
    });

    return (
        <div className={`geo-view ${state === State.NewNote ? "placing-note" : ""}`}>
            <CollectionProperties
                note={note}
                rightChildren={<>
                    <ToggleReadOnlyButton note={note} />
                    <ButtonOrActionButton
                        icon="bx bx-plus"
                        text={t("geo-map.create-child-note-text")}
                        title={t("geo-map.create-child-note-title")}
                        onClick={startNotePlacement}
                        disabled={isReadOnly}
                    />
                </>}
            />
            { coordinates !== undefined && zoom !== undefined && <Map
                apiRef={apiRef} containerRef={containerRef}
                coordinates={coordinates}
                zoom={zoom}
                layerData={layerData}
                viewportChanged={(coordinates, zoom) => {
                    if (!viewConfig) viewConfig = {};
                    viewConfig.view = { center: coordinates, zoom };
                    spacedUpdate.scheduleUpdate();
                }}
                onClick={onClick}
                scale={hasScale}
            >
                <MapToolbar />
                <Tooltips />
                <ContextMenus note={note} isReadOnly={isReadOnly} />
                <Markers notes={notes} hideLabels={hideLabels} isDarkTheme={layerData.isDarkTheme ?? false} clustered={clustered} />
                {notes.map(note => <NoteGpxTrackWrapper note={note} hideLabels={hideLabels} />)}
            </Map>}
        </div>
    );
}

function useLayerData(note: FNote) {
    const [ layerName ] = useNoteLabel(note, "map:style");
    // Whether the style is a dark one, which decides how a marker's title is drawn over it (see
    // Markers). Only the style itself can say, and a style named by URL says nothing to us: it is
    // fetched by the map, and its tiles are pictures besides. So the note is asked instead.
    const [ isDarkStyle ] = useNoteLabelBoolean(note, "map:darkStyle");
    // Memo is needed because it would generate unnecessary reloads due to layer change.
    const layerData = useMemo(() => {
        // Custom layers.
        if (layerName?.startsWith("http")) {
            return {
                name: "Custom",
                type: "raster",
                url: layerName,
                attribution: "",
                isDarkTheme: isDarkStyle
            } satisfies MapLayer;
        }

        // Built-in layers, which declare it for themselves. The label is still honoured over one, so
        // that setting it does something wherever it is set; it can only ever say that a style is
        // dark, never that it is light, so a built-in dark style keeps its own answer either way.
        const layerData = MAP_LAYERS[layerName ?? ""] ?? MAP_LAYERS[DEFAULT_MAP_LAYER_NAME];
        return isDarkStyle ? { ...layerData, isDarkTheme: true } : layerData;
    }, [ layerName, isDarkStyle ]);

    return layerData;
}

function ToggleReadOnlyButton({ note }: { note: FNote }) {
    const [ isReadOnly, setReadOnly ] = useNoteLabelBoolean(note, "readOnly");

    return <ActionButton
        text={isReadOnly ? t("toggle_read_only_button.unlock-editing") : t("toggle_read_only_button.lock-editing")}
        icon={isReadOnly ? "bx bx-lock-open-alt" : "bx bx-lock-alt"}
        onClick={() => setReadOnly(!isReadOnly)}
    />;
}

/**
 * A GPX note's track, where the note is one.
 *
 * Only tracks are rendered a component apiece: a note that merely carries a location is drawn into
 * the shared symbol layer instead (see {@link Markers}).
 */
function NoteGpxTrackWrapper({ note, hideLabels }: { note: FNote, hideLabels: boolean }) {
    const mime = useNoteProperty(note, "mime");

    if (mime !== "application/gpx+xml") {
        return null;
    }

    return <NoteGpxTrack note={note} hideLabels={hideLabels} />;
}

function NoteGpxTrack({ note, hideLabels }: { note: FNote, hideLabels?: boolean }) {
    const [ xmlString, setXmlString ] = useState<string>();
    const blob = useNoteBlob(note);

    useEffect(() => {
        if (!blob) return;
        server.get<string | Uint8Array>(`notes/${note.noteId}/open`, undefined, true).then(xmlResponse => {
            if (xmlResponse instanceof Uint8Array) {
                setXmlString(new TextDecoder().decode(xmlResponse));
            } else {
                setXmlString(xmlResponse);
            }
        });
    }, [ blob ]);

    // React to changes
    const color = useNoteLabel(note, "color");
    useNoteLabel(note, "iconClass");

    const trackColor = useMemo(() => note.getLabelValue("color") ?? "blue", [ color ]);
    const startIconHtml = useIconHtml(note.getIcon(), note.getColorClass() ?? undefined, hideLabels ? undefined : note.title);
    const endIconHtml = useIconHtml("bx bxs-flag-checkered");
    const waypointIconHtml = useIconHtml("bx bx-pin");

    return xmlString && <GpxTrack
        gpxXmlString={xmlString}
        trackColor={trackColor}
        startIconHtml={startIconHtml}
        endIconHtml={endIconHtml}
        waypointIconHtml={waypointIconHtml}
    />;
}

/** The pin shape, filled with whatever colour the note asks for. Replaces the Leaflet marker PNG. */
function buildMarkerSvg(color: string) {
    return `<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">` +
        `<path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="${escapeHtml(color)}" />` +
        `</svg>`;
}

/** What a pin is filled with where its note asks for no colour of its own. */
const DEFAULT_MARKER_COLOR = "#2A81CB";

/** The size the icon is drawn at, matching the font size the CSS-styled span used. */
const MARKER_ICON_SIZE = 17;

/**
 * The marker HTML for {@link buildIconHtml}, built asynchronously because the icon inside it is
 * drawn through the shared icon-rendering service. Undefined until the first build resolves; the
 * service caches each icon/colour pair, so every marker after the first with the same icon gets
 * its HTML in a single tick.
 */
function useIconHtml(iconClass: string, colorClass?: string, title?: string, noteIdLink?: string, archived?: boolean) {
    const [ html, setHtml ] = useState<string>();

    useEffect(() => {
        let cancelled = false;
        buildIconHtml(iconClass, colorClass, title, noteIdLink, archived).then((result) => {
            if (!cancelled) {
                setHtml(result);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [ iconClass, colorClass, title, noteIdLink, archived ]);

    return html;
}

async function buildIconHtml(iconClass: string, colorClass?: string, title?: string, noteIdLink?: string, archived?: boolean) {
    // The note's colour fills the pin, as it does for the note markers drawn into the symbol layer,
    // and the icon is cut out of it in whichever of black or white stands out against that.
    const pinColor = resolveNoteColor(colorClass) ?? DEFAULT_MARKER_COLOR;

    // Drawn as a picture through the shared icon service (icon_glyphs.ts) rather than styled by
    // CSS, so the marker renders any icon pack's icon the way the rest of the app draws it. A
    // class the service cannot resolve falls back to the CSS-styled span.
    //
    // The class is passed on whole, as callers give it — a complete one, family and all. The
    // service resolves a class by wearing it and reading back what the stylesheet made of it, so
    // every class handed over is one more voice in that cascade: a `bx` of our own would have the
    // built-in pack's font competing with the pack the icon actually belongs to.
    const image = await renderIconImage(iconClass, {
        size: MARKER_ICON_SIZE,
        color: getReadableTextColor(pinColor)
    });
    const icon = image
        ? `<img class="tn-icon" src="${image}" alt="" />`
        : `<span class="${escapeHtml(iconClass)} tn-icon"></span>`;

    let html = /*html*/`\
        <div class="marker-pin">${buildMarkerSvg(pinColor)}</div>
        ${icon}
        <span class="title-label">${escapeHtml(title ?? "")}</span>`;

    if (noteIdLink) {
        html = `<div data-href="#root/${escapeHtml(noteIdLink)}" class="${archived ? "archived" : ""}">${html}</div>`;
    }

    return html;
}

/**
 * The concrete colour a note's colour class stands for — the light-theme variant, the same value
 * the CSS-styled span used to read from `--light-theme-custom-color`, or `null` for a note that
 * asks for no colour. Only the stylesheet knows the adjusted value, so it is read off an element
 * wearing the class, the way the icon service reads its glyphs.
 */
function resolveNoteColor(colorClass?: string) {
    if (!colorClass) {
        return null;
    }

    const probe = document.createElement("span");
    probe.className = colorClass;
    document.body.appendChild(probe);
    try {
        return getComputedStyle(probe).getPropertyValue("--light-theme-custom-color").trim() || null;
    } finally {
        probe.remove();
    }
}

