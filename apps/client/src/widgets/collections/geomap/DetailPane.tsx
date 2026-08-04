import "./DetailPane.css";

import type { Map as MapLibreGLMap, MapMouseEvent } from "maplibre-gl";
import { useContext, useEffect, useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import { useNoteIcon, useNoteLabel, useNoteProperty } from "../../react/hooks";
import OverlayPanel, { OverlayPanelBody, OverlayPanelTitle } from "../../react/OverlayPanel";
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
export default function DetailPane({ notes, placing }: {
    notes: FNote[];
    /** A marker is being placed, which is what the next click on the map is for. */
    placing: boolean;
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
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [ selectedNoteId ]);

    if (!note) {
        return null;
    }

    return <MarkerDetails note={note} onClose={() => setSelectedNoteId(null)} />;
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
function MarkerDetails({ note, onClose }: { note: FNote; onClose(): void }) {
    const icon = useNoteIcon(note);
    const title = useNoteProperty(note, "title");

    return (
        <OverlayPanel
            className="geo-detail-pane"
            header={<OverlayPanelTitle icon={icon ?? note.getIcon()} text={title ?? note.title} />}
            close={{ text: t("geo-map.close-details"), onClick: onClose }}
        >
            {/* Nothing is made of the note yet — what stands here is the wiring, and the pane is
                filled in a step of its own. */}
            <OverlayPanelBody>Hello world</OverlayPanelBody>
        </OverlayPanel>
    );
}
