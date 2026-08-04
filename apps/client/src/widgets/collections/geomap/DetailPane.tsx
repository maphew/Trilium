import "./DetailPane.css";

import type { Map as MapLibreGLMap, MapMouseEvent } from "maplibre-gl";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import NoteContext, { openInCurrentNoteContext } from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import link from "../../../services/link";
import TitleRow from "../../layout/TitleRow";
import NoteDetail from "../../NoteDetail";
import ActionButton from "../../react/ActionButton";
import { useNoteLabel } from "../../react/hooks";
import PromotedAttributes from "../../PromotedAttributes";
import OverlayPanel, { OverlayPanelBody } from "../../react/OverlayPanel";
import { NoteContextContext, ParentComponent } from "../../react/react_utils";
import { moveMarker } from "./api";
import { ParentMap } from "./map";
import { LOCATION_ATTRIBUTE, MARKER_LAYER, parseLocation } from "./Markers";

/**
 * The pane standing against the trailing edge of the map for as long as a marker is selected.
 *
 * Drawn over the map rather than beside it: the map is what goes fullscreen (see MapToolbar), so a
 * pane outside it would leave the screen. It reads as a dock because the map keeps out of its way
 * (see {@link paneOffset}).
 */
export default function DetailPane({ notes, placing, isReadOnly, onRelocate }: {
    notes: FNote[];
    /** A marker is being placed, which is what the next click on the map is for. */
    placing: boolean;
    /** The map may not be edited, which leaves the pane the ways of opening a note and no more. */
    isReadOnly: boolean;
    /** Arms this map for the selected marker to be put somewhere else, the next click being where. */
    onRelocate: (noteId: string) => void;
}) {
    const map = useContext(ParentMap);
    const [ selectedNoteId, setSelectedNoteId ] = useState<string | null>(null);
    const note = notes.find((note) => note.noteId === selectedNoteId);
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);
    const { noteContext, paneComponent } = usePaneNoteContext(note);

    /**
     * Lets the pane go, having given whatever is being edited in it the chance to save.
     *
     * Switching from one marker to another needs no such thing: that is a note switch within the
     * pane, and the context announces it. Closing announces nothing at all — the widgets are simply
     * unmounted — so the event a note context is removed under is raised here in its place, which is
     * what the editors are listening for (see the spaced updates in hooks.tsx).
     *
     * Raised but not waited on: the save is under way by the time the call returns, and a request
     * already in flight does not care that what started it has gone. Waiting would hold the pane
     * open for a round trip to the server every time it was closed with something unsaved in it.
     */
    const closePane = useCallback(() => {
        void paneComponent.handleEventInChildren("beforeNoteContextRemove", { ntxIds: [ PANE_NTX_ID ] });
        setSelectedNoteId(null);
    }, [ paneComponent ]);

    /**
     * Arms the map for this marker to be put somewhere else, and stands the pane down while it waits.
     *
     * The pane goes because the click that names the new place has to land on the map, and the pane
     * covers the part of it nearest the marker — leaving it up would put the likeliest destinations
     * out of reach. What the map is waiting for is said by the instruction toast instead (see
     * index.tsx), which is where the same arming from the right-click menu says it too.
     */
    const relocate = useCallback(() => {
        if (!note) return;
        closePane();
        onRelocate(note.noteId);
    }, [ note, closePane, onRelocate ]);

    // A note no longer on the map takes the pane with it. Its location may merely have been cleared
    // — which is all "remove from map" does — so the note being gone is not the only case.
    useEffect(() => {
        if (selectedNoteId && (!note || !parseLocation(location))) {
            void closePane();
        }
    }, [ selectedNoteId, note, location, closePane ]);

    // A marker selects, anywhere else clears. Read off the rendered layer rather than bound to it
    // (`map.on("click", MARKER_LAYER, ...)`) so one handler answers both, with no ordering to rely on.
    useEffect(() => {
        if (!map || placing) return;

        const onClick = (e: MapMouseEvent) => {
            const feature = map.queryRenderedFeatures(e.point, { layers: [ MARKER_LAYER ] })[0];
            if (!feature || feature.geometry.type !== "Point") {
                void closePane();
                return;
            }

            setSelectedNoteId(String(feature.properties.id));
            map.easeTo({
                center: feature.geometry.coordinates as [ number, number ],
                offset: paneOffset(map)
            });
        };

        map.on("click", onClick);
        return () => { map.off("click", onClick); };
    }, [ map, placing, closePane ]);

    // Bound only while something is selected, so the map's other Escape — giving up on placing a
    // marker (see index.tsx) — stands alone when nothing is.
    useEffect(() => {
        if (!selectedNoteId) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                void closePane();
            }
        };
        // Captured, not bubbled: the panel stops key presses made inside it from reaching the map
        // underneath (see OverlayPanel), which would stop them reaching this listener too.
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [ selectedNoteId, closePane ]);

    if (!note) {
        return null;
    }

    return (
        // What the pane holds reads the note out of the context rather than being handed one (see
        // TitleRow), and answers to the pane's own component rather than the map's (see below).
        <ParentComponent.Provider value={paneComponent}>
            <NoteContextContext.Provider value={noteContext}>
                <MarkerDetails note={note} isReadOnly={isReadOnly} onClose={closePane} onRelocate={relocate} />
            </NoteContextContext.Provider>
        </ParentComponent.Provider>
    );
}

/** Must agree with `--geo-detail-pane-width` in DetailPane.css. */
const PANE_WIDTH = 380;

/** Must agree with `--geo-map-inset` in index.css. */
const PANE_INSET = 20;

/** How far into the map the pane reaches: its width plus the gap, which it also covers. */
const PANE_REACH = PANE_WIDTH + PANE_INSET;

/**
 * How far off centre to hold a marker so the pane does not cover it.
 *
 * An `offset` rather than camera `padding`, though padding is what it is for: padding stays in the
 * transform, so `getCenter()` — which the view is saved from (see map.tsx) — would report the middle
 * of the uncovered half from then on, walking the saved viewport sideways on every open.
 */
function paneOffset(map: MapLibreGLMap): [number, number] {
    // An embedded map narrower than the pane leaves nowhere to hold the marker clear of.
    if (map.getContainer().clientWidth <= PANE_REACH) {
        return [ 0, 0 ];
    }

    // The pane stands at the trailing edge, which is the left one in a right-to-left app.
    const shift = PANE_REACH / 2;
    return [ glob.isRtl ? shift : -shift, 0 ];
}

/** The pane itself, for a marker there is one to draw. */
function MarkerDetails({ note, isReadOnly, onClose, onRelocate }: { note: FNote; isReadOnly: boolean; onClose(): void; onRelocate(): void }) {
    return (
        <OverlayPanel
            className="geo-detail-pane"
            header={<TitleRow compact />}
            close={{ text: t("geo-map.close-details"), onClick: onClose }}
        >
            <OverlayPanelBody className="geo-detail-pane-body">
                <MarkerActions note={note} isReadOnly={isReadOnly} onRelocate={onRelocate} />

                {/* Whatever fields the note's own definitions ask for, ahead of the note as the quick
                    editor puts them — a marker is often a note whose type says less about it than
                    its fields do. Nothing at all is shown for a note that promotes none. */}
                <PromotedAttributes />

                {/* The note itself, drawn by whichever widget its type calls for — the same one the
                    quick editor mounts, so a marker is written in exactly as it is anywhere else.
                    No toolbar stands beside it: the pane asks for the floating one, which the editor
                    carries with it (see the view scope below). */}
                <NoteDetail />
            </OverlayPanelBody>
        </OverlayPanel>
    );
}

/** The pane's own ntxId, as the quick editor has one of its own. */
const PANE_NTX_ID = "_geo-detail-pane";

/**
 * A note context of the pane's own, pointed at whichever marker is selected — the arrangement the
 * quick editor makes, so that the icon and title widgets work and a rename saves the usual way.
 *
 * One context for the pane rather than one per marker: moving between markers is a note switch
 * within a standing pane, not a new pane.
 */
function usePaneNoteContext(note: FNote | undefined) {
    const parentComponent = useContext(ParentComponent);
    const [ noteContext ] = useState(() => new NoteContext(PANE_NTX_ID));
    // Stands between the map's component and the pane's contents. See below for why.
    const [ paneComponent ] = useState(() => new Component());

    useEffect(() => {
        if (!parentComponent) return;

        // A child of the map's component, so app-wide events still travel down into the pane — a
        // component hanging off nothing would never hear that its note was edited elsewhere.
        parentComponent.child(paneComponent);
        return () => parentComponent.removeChild(paneComponent);
    }, [ parentComponent, paneComponent ]);

    useEffect(() => {
        /*
         * The context was built here rather than by the tab manager, so it has no parent to raise
         * events through and is given one by hand — the pane's component, not the map's.
         *
         * Pointing a note context at a note announces a note switch, and an unbound `useNoteContext`
         * rebinds to whatever context it hears named (see hooks.tsx). The quick editor gets away
         * with announcing to its parent because it is a dialog at the root; the pane is inside the
         * map, so the collection view around it would rebind to the marker's note, tear the map down
         * and take the WebGL context with it.
         */
        noteContext.triggerEvent = (name, data) => paneComponent.handleEventInChildren(name, data);
    }, [ noteContext, paneComponent ]);

    useEffect(() => {
        if (!note) return;

        const notePath = note.getBestNotePathString(appContext.tabManager.getActiveContext()?.hoistedNoteId);
        void noteContext.setNote(notePath, {
            // Selecting a marker is not the kind of navigation that should dismiss an open dialog.
            keepActiveDialog: true,
            viewScope: {
                // A note held read-only only because of its size is editable here, as it is in the
                // quick editor; one the reader has marked read-only stays that way.
                readOnlyTemporarilyDisabled: !note.hasLabel("readOnly"),
                // The pane has a third of a note's width, which is not a toolbar's worth: the
                // editor's own follows the selection instead of standing in a bar (see link.ts).
                floatingToolbar: true
            }
        });
    }, [ noteContext, note?.noteId ]);

    return { noteContext, paneComponent };
}

/**
 * The ways of opening the note, named as the link menu names them.
 *
 * The quick editor is deliberately absent: it is what a click on a marker used to raise, and the
 * pane took that click over — offering it here would put a modal back over the pane that replaced it.
 */
function MarkerActions({ note, isReadOnly, onRelocate }: { note: FNote; isReadOnly: boolean; onRelocate(): void }) {
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);
    const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
    // A path rather than an id: a note may hang in several places, and each of these opens a path.
    const notePath = note.getBestNotePathString(hoistedNoteId);
    const latLng = parseLocation(location);

    return (
        <div className="geo-detail-pane-actions">
            <ActionButton
                icon="bx bx-log-in"
                text={t("geo-map.open-note")}
                // Handed the event: `openInCurrentNoteContext` reads the target tab off the element
                // clicked, which lands the note in the tab the map is in.
                onClick={(e) => notePath && openInCurrentNoteContext(e as MouseEvent, notePath)}
                disabled={!notePath}
            />

            <ActionButton
                icon="bx bx-link-external"
                text={t("link_context_menu.open_note_in_new_tab")}
                onClick={() => notePath && appContext.tabManager.openContextWithNote(notePath, { hoistedNoteId })}
                disabled={!notePath}
            />

            <ActionButton
                icon="bx bx-window-open"
                text={t("link_context_menu.open_note_in_new_window")}
                onClick={() => notePath && appContext.triggerCommand("openInWindow", { notePath, hoistedNoteId })}
                disabled={!notePath}
            />

            <ActionButton
                icon="bx bx-map-alt"
                text={t("geo-map-context.open-location")}
                // Handed to whatever the system opens a place with, as the right-click menu does.
                onClick={() => latLng && link.goToLinkExt(null, `geo:${latLng[1]},${latLng[0]}`)}
                disabled={!latLng}
            />

            {/* Left out rather than disabled on a read-only map, as the right-click menu leaves them
                out: everything else in the row reads the note, these two alone write it. */}
            {!isReadOnly && <>
                <ActionButton
                    className="geo-detail-pane-move"
                    icon="bx bx-move"
                    text={t("geo-map-context.move-marker")}
                    // The marker is put somewhere else by being placed again rather than dragged: the
                    // notes are drawn into one symbol layer, not an element apiece, so there is
                    // nothing on the map to take hold of.
                    onClick={onRelocate}
                />

                <ActionButton
                    className="geo-detail-pane-remove"
                    icon="bx bx-trash"
                    text={t("geo-map-context.remove-from-map")}
                    // Only the location goes; the note stays in the tree. Nothing closes the pane
                    // afterwards because the effect above already stands it down.
                    //
                    // Called rather than commanded: `deleteFromMap` is broadcast, so every open geo
                    // map would take the same note off in turn.
                    onClick={() => void moveMarker(note.noteId, null)}
                />
            </>}
        </div>
    );
}
