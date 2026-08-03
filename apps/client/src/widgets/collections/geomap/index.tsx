import "./index.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import type maplibregl from "maplibre-gl";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import branches from "../../../services/branches";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { escapeHtml } from "../../../services/utils";
import CollectionProperties from "../../note_bars/CollectionProperties";
import ActionButton from "../../react/ActionButton";
import { ButtonOrActionButton } from "../../react/Button";
import { useCollectionTreeDrag, useNoteBlob, useNoteLabel, useNoteLabelBoolean, useNoteProperty, useSpacedUpdate, useTriliumEvent } from "../../react/hooks";
import { ViewModeProps } from "../interface";
import { createNewNote, moveMarker } from "./api";
import openContextMenu, { openMapContextMenu } from "./context_menu";
import Map, { GeoMouseEvent } from "./map";
import { DEFAULT_MAP_LAYER_NAME, MAP_LAYERS, MapLayer } from "./map_layer";
import Marker, { GpxTrack } from "./marker";

const DEFAULT_COORDINATES: [number, number] = [3.878638227135724, 446.6630455551659];
const DEFAULT_ZOOM = 2;
export const LOCATION_ATTRIBUTE = "geolocation";

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

    const onContextMenu = useCallback((e: GeoMouseEvent) => {
        openMapContextMenu(note, e, !isReadOnly);
    }, [ note, isReadOnly ]);

    // Dragging
    const containerRef = useRef<HTMLDivElement>(null);
    const apiRef = useRef<maplibregl.Map>(null);
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
                onContextMenu={onContextMenu}
                scale={hasScale}
            >
                {notes.map(note => <NoteWrapper note={note} isReadOnly={isReadOnly} hideLabels={hideLabels} />)}
            </Map>}
        </div>
    );
}

function useLayerData(note: FNote) {
    const [ layerName ] = useNoteLabel(note, "map:style");
    // Memo is needed because it would generate unnecessary reloads due to layer change.
    const layerData = useMemo(() => {
        // Custom layers.
        if (layerName?.startsWith("http")) {
            return {
                name: "Custom",
                type: "raster",
                url: layerName,
                attribution: ""
            } satisfies MapLayer;
        }

        // Built-in layers.
        const layerData = MAP_LAYERS[layerName ?? ""] ?? MAP_LAYERS[DEFAULT_MAP_LAYER_NAME];
        return layerData;
    }, [ layerName ]);

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

function NoteWrapper({ note, isReadOnly, hideLabels }: {
    note: FNote,
    isReadOnly: boolean,
    hideLabels: boolean
}) {
    const mime = useNoteProperty(note, "mime");
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);

    if (mime === "application/gpx+xml") {
        return <NoteGpxTrack note={note} hideLabels={hideLabels} />;
    }

    if (location) {
        const latLng = location?.split(",", 2).map((el) => parseFloat(el)) as [ number, number ] | undefined;
        if (!latLng) return;
        return <NoteMarker note={note} editable={!isReadOnly} latLng={latLng} hideLabels={hideLabels} />;
    }
}

function NoteMarker({ note, editable, latLng, hideLabels }: { note: FNote, editable: boolean, latLng: [number, number], hideLabels: boolean }) {
    // React to changes
    const [ color ] = useNoteLabel(note, "color");
    const [ iconClass ] = useNoteLabel(note, "iconClass");
    const [ archived ] = useNoteLabelBoolean(note, "archived");

    const title = useNoteProperty(note, "title");
    const iconHtml = useMemo(() => {
        const titleOrNone = hideLabels ? undefined : title;
        return buildIconHtml(note.getIcon(), note.getColorClass() ?? undefined, titleOrNone, note.noteId, archived);
    }, [ iconClass, color, title, note.noteId, archived, hideLabels ]);

    const onClick = useCallback(() => {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: note.noteId });
    }, [ note.noteId ]);

    // Middle click to open in new tab
    const onMouseDown = useCallback((e: MouseEvent) => {
        if (e.button === 1) {
            const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
            appContext.tabManager.openInNewTab(note.noteId, hoistedNoteId);
            return true;
        }
    }, [ note.noteId ]);

    const onDragged = useCallback((newCoordinates: { lat: number; lng: number }) => {
        moveMarker(note.noteId, newCoordinates);
    }, [ note.noteId ]);

    const onContextMenu = useCallback((e: GeoMouseEvent) => openContextMenu(note.noteId, e, editable), [ note.noteId, editable ]);

    return latLng && <Marker
        coordinates={latLng}
        iconHtml={iconHtml}
        iconSize={[25, 41]}
        draggable={editable}
        onMouseDown={onMouseDown}
        onDragged={editable ? onDragged : undefined}
        onClick={!editable ? onClick : undefined}
        onContextMenu={onContextMenu}
    />;
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
    const iconClass = useNoteLabel(note, "iconClass");

    const trackColor = useMemo(() => note.getLabelValue("color") ?? "blue", [ color ]);
    const startIconHtml = useMemo(() => buildIconHtml(note.getIcon(), note.getColorClass() ?? undefined, hideLabels ? undefined : note.title), [ iconClass, color, hideLabels ]);
    const endIconHtml = useMemo(() => buildIconHtml("bxs-flag-checkered"), [ ]);
    const waypointIconHtml = useMemo(() => buildIconHtml("bx bx-pin"), [ ]);

    return xmlString && <GpxTrack
        gpxXmlString={xmlString}
        trackColor={trackColor}
        startIconHtml={startIconHtml}
        endIconHtml={endIconHtml}
        waypointIconHtml={waypointIconHtml}
    />;
}

// SVG marker pin shape (replaces the Leaflet marker PNG).
const MARKER_SVG = `<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">` +
    `<path d="M12.5 0C5.6 0 0 5.6 0 12.5C0 21.9 12.5 41 12.5 41S25 21.9 25 12.5C25 5.6 19.4 0 12.5 0Z" fill="#2A81CB" />` +
    `<circle cx="12.5" cy="12.5" r="8" fill="white" />` +
    `</svg>`;

function buildIconHtml(bxIconClass: string, colorClass?: string, title?: string, noteIdLink?: string, archived?: boolean) {
    let html = /*html*/`\
        <div class="marker-pin">${MARKER_SVG}</div>
        <span class="bx ${escapeHtml(bxIconClass)} tn-icon ${escapeHtml(colorClass ?? "")}"></span>
        <span class="title-label">${escapeHtml(title ?? "")}</span>`;

    if (noteIdLink) {
        html = `<div data-href="#root/${escapeHtml(noteIdLink)}" class="${archived ? "archived" : ""}">${html}</div>`;
    }

    return html;
}

