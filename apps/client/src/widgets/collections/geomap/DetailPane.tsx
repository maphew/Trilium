import "./DetailPane.css";

import type { Map as MapLibreGLMap, MapMouseEvent } from "maplibre-gl";
import { useContext, useEffect, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import { openInCurrentNoteContext } from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import link from "../../../services/link";
import ActionButton from "../../react/ActionButton";
import { useNoteIcon, useNoteLabel, useNoteProperty } from "../../react/hooks";
import OverlayPanel, { OverlayPanelBody, OverlayPanelTitle } from "../../react/OverlayPanel";
import { moveMarker } from "./api";
import { ParentMap } from "./map";
import { LOCATION_ATTRIBUTE, MARKER_LAYER, parseLocation } from "./Markers";

/**
 * What is known about the marker that has been clicked, standing against the trailing edge of the
 * map for as long as one is selected.
 *
 * The pane is drawn over the map rather than beside it — the map is what goes fullscreen (see
 * MapToolbar), so a pane standing outside it would leave the screen the moment it was filled, and an
 * embedded map may be narrower than the pane is wide. What makes it read as a dock instead of a card
 * laid over the map is that the map keeps out of its way: the marker is brought to the middle of
 * what is left uncovered rather than to the middle of the map (see {@link paneOffset}), and the bar
 * of buttons in the corner steps aside for it (see DetailPane.css).
 */
export default function DetailPane({ notes, placing, isReadOnly }: {
    notes: FNote[];
    /** A marker is being placed, which is what the next click on the map is for. */
    placing: boolean;
    /** The map may not be edited, which leaves the pane the ways of opening a note and no more. */
    isReadOnly: boolean;
}) {
    const map = useContext(ParentMap);
    const [ selectedNoteId, setSelectedNoteId ] = useState<string | null>(null);
    const note = notes.find((note) => note.noteId === selectedNoteId);
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);

    // A note that is no longer on the map takes the pane with it, rather than leaving it standing
    // for a marker that is not there any more: the note may have left the collection, or been
    // deleted, or merely had its location cleared — which is what "remove from map" does, and which
    // leaves the note itself exactly where it was.
    useEffect(() => {
        if (selectedNoteId && (!note || !parseLocation(location))) {
            setSelectedNoteId(null);
        }
    }, [ selectedNoteId, note, location ]);

    // What is under the pointer decides: a marker is selected, and a click anywhere else clears the
    // selection, the way clicking off a place closes its card. Read off the rendered layer rather
    // than bound to it (`map.on("click", MARKER_LAYER, ...)`), so that one handler answers both
    // cases and there is no order between two of them to rely on.
    useEffect(() => {
        if (!map || placing) return;

        const onClick = (e: MapMouseEvent) => {
            const feature = map.queryRenderedFeatures(e.point, { layers: [ MARKER_LAYER ] })[0];
            if (!feature || feature.geometry.type !== "Point") {
                setSelectedNoteId(null);
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
    }, [ map, placing ]);

    // The way out that every transient surface in the app answers to. Bound only while there is a
    // selection, so that the map's other Escape — the one that gives up placing a marker (see
    // index.tsx) — is the only listener standing when there is nothing selected.
    useEffect(() => {
        if (!selectedNoteId) return;

        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                setSelectedNoteId(null);
            }
        };
        // Heard on the way down rather than on the way up: the panel stops the key presses made
        // inside it from reaching what is underneath (see OverlayPanel), which is right — what is
        // underneath is a map with shortcuts of its own — but it also stops them reaching this. On
        // the way down nothing has had the chance to stop them yet, so Escape closes the pane from
        // within it as readily as from the map.
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [ selectedNoteId ]);

    if (!note) {
        return null;
    }

    return <MarkerDetails note={note} isReadOnly={isReadOnly} onClose={() => setSelectedNoteId(null)} />;
}

/**
 * How wide the pane stands.
 *
 * Has to agree with `--geo-detail-pane-width` in DetailPane.css: the map is told how much of itself
 * the pane covers so that it can hold the selected marker clear of it, and a number is the only form
 * that side of the pair can take.
 */
const PANE_WIDTH = 380;

/** How far the pane is held off the edge it stands against, matching `--geo-map-inset` (index.css). */
const PANE_INSET = 20;

/**
 * How far into the map the pane reaches from that edge. The gap counts as covered: it is the pane's
 * own air, and a marker sitting in it reads as tucked behind the pane rather than beside it.
 */
const PANE_REACH = PANE_WIDTH + PANE_INSET;

/**
 * How far off its own centre the map has to hold a marker for the pane not to cover it.
 *
 * Handed over as `offset` rather than as camera `padding`, though padding is what it is for: padding
 * becomes part of the transform and stays there, so `getCenter()` — which is what the view is saved
 * from (see map.tsx) — would report the middle of the uncovered half from then on, and the saved
 * viewport would walk sideways every time the pane was opened. An offset applies to the one
 * animation and leaves nothing behind.
 */
function paneOffset(map: MapLibreGLMap): [number, number] {
    // A pane with the whole map under it — an embedded one narrower than the pane — leaves nowhere
    // to hold the marker clear of, so it is left where it is.
    if (map.getContainer().clientWidth <= PANE_REACH) {
        return [ 0, 0 ];
    }

    // The pane stands at the trailing edge, which is the left one where the app reads right to left.
    const shift = PANE_REACH / 2;
    return [ glob.isRtl ? shift : -shift, 0 ];
}

/** The pane itself, for a marker there is one to draw. */
function MarkerDetails({ note, isReadOnly, onClose }: { note: FNote; isReadOnly: boolean; onClose(): void }) {
    const icon = useNoteIcon(note);
    const title = useNoteProperty(note, "title");

    return (
        <OverlayPanel
            className="geo-detail-pane"
            header={<OverlayPanelTitle icon={icon ?? note.getIcon()} text={title ?? note.title} />}
            close={{ text: t("geo-map.close-details"), onClick: onClose }}
        >
            <OverlayPanelBody>
                <MarkerActions note={note} isReadOnly={isReadOnly} />
            </OverlayPanelBody>
        </OverlayPanel>
    );
}

/**
 * What can be done with the note behind the marker: the ways of opening it, and the way of opening
 * where it is.
 *
 * These are the ways every note in Trilium is opened, which is why they are named as they are named
 * everywhere else — the same strings the link menu offers them under. What is not among them is
 * the quick editor: it used to be what a click on a marker raised, and the pane took that click
 * over, so offering it here would only put a modal back over the pane that replaced it.
 */
function MarkerActions({ note, isReadOnly }: { note: FNote; isReadOnly: boolean }) {
    const [ location ] = useNoteLabel(note, LOCATION_ATTRIBUTE);
    const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
    // The path the note is best reached by from wherever the reader is hoisted, rather than its id:
    // a note may hang in several places, and every one of these opens a path.
    const notePath = note.getBestNotePathString(hoistedNoteId);
    const latLng = parseLocation(location);

    return (
        <div className="geo-detail-pane-actions">
            <ActionButton
                icon="bx bx-log-in"
                text={t("geo-map.open-note")}
                // Handed the event so that the note lands in the pane's own tab, which is the one
                // the map is in — `openInCurrentNoteContext` reads it off the element clicked.
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
                // Where the note is, handed to whatever the system opens a place with, as the map's
                // own right-click menu does with the point that was clicked.
                onClick={() => latLng && link.goToLinkExt(null, `geo:${latLng[1]},${latLng[0]}`)}
                disabled={!latLng}
            />

            {/* Left out rather than shown spent on a map that cannot be edited, as the map's own
                right-click menu leaves it out: the rest of the row reads a note, and this is the
                one thing here that writes one. */}
            {!isReadOnly && (
                <ActionButton
                    className="geo-detail-pane-remove"
                    icon="bx bx-trash"
                    text={t("geo-map-context.remove-from-map")}
                    // Only the note's location goes; the note itself stays exactly where it was in
                    // the tree. Nothing closes the pane afterwards because nothing has to — a note
                    // with nowhere to be drawn is a note the pane stops standing for (see above).
                    //
                    // Called rather than commanded, though `deleteFromMap` is a command the map
                    // already answers: a command is broadcast, and every geo map open at the time
                    // would take the same note off the same map in turn.
                    onClick={() => void moveMarker(note.noteId, null)}
                />
            )}
        </div>
    );
}
