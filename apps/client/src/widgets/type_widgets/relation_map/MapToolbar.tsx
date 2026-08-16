import "./MapToolbar.css";

import type { PanZoom } from "panzoom";
import { useEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";

/** What the buttons ask for, which is what the map itself answers (see `usePanZoom` in RelationMap.tsx). */
export type MapCommand = "relationMapResetZoomIn" | "relationMapResetZoomOut" | "relationMapResetPanZoom";

interface MapToolbarProps {
    /** The map the scale is read from, or `undefined` while there is none yet. */
    panZoom: PanZoom | undefined;
    onCommand: (command: MapCommand) => void;
}

/**
 * The controls standing in the corner of a relation map: how close in it is drawn, and the way back
 * to where it started.
 *
 * They stand on the {@link OverlayControlGroup} the image viewer's zoom buttons stand on (see
 * {@link ImageViewer}), as the other two maps' controls and the diagram preview's do, in place of the
 * three floating buttons that were here before. The readout between the steps says the scale the way
 * those do — a hundred being the map drawn at its own size — and pressed, takes the map back there
 * and to the corner it started in, which is what the button wearing a crop mark did.
 *
 * What the three do is asked for as commands rather than done here, the same commands the floating
 * buttons above the map ask for (`RelationMapButtons` in FloatingButtonsDefinitions.tsx): the map is
 * driven from two places, and how far a step goes is settled in the one place that answers them. The
 * map itself is only read from — for the scale to show, and for the ends of its range, which is what
 * leaves a step with nothing left to give disabled. Absent until there is a map to read.
 */
export default function MapToolbar({ panZoom, onCommand }: MapToolbarProps) {
    const scale = useMapScale(panZoom);

    if (!panZoom) return null;

    return (
        <OverlayControlGroup className="relation-map-toolbar">
            <OverlayControlButton
                title={t("relation_map_buttons.zoom_out_title")}
                icon="bx-minus-circle"
                disabled={scale <= panZoom.getMinZoom()}
                onClick={() => onCommand("relationMapResetZoomOut")}
            />
            <OverlayControlButton
                title={t("relation_map_buttons.reset_pan_zoom_title")}
                text={`${Math.round(scale * 100)}%`}
                onClick={() => onCommand("relationMapResetPanZoom")}
            />
            <OverlayControlButton
                title={t("relation_map_buttons.zoom_in_title")}
                icon="bx-plus-circle"
                disabled={scale >= panZoom.getMaxZoom()}
                onClick={() => onCommand("relationMapResetZoomIn")}
            />
        </OverlayControlGroup>
    );
}

interface EditToolbarProps {
    /** The map may not be edited, which is every one of these buttons refused at once. */
    isReadOnly: boolean;
    /** Asks for a title and leaves the note waiting for a place to be clicked (see `useNoteCreation`
     *  in RelationMap.tsx). */
    onAddNote: () => void;
}

/**
 * The editing actions, standing in the middle of the map's foot on a group of their own — adding a
 * note today, with room along the row for whatever editing the map comes to offer next.
 *
 * A group of its own rather than more buttons on {@link MapToolbar}, as on the geo map: that one is
 * the camera — how close in the map is drawn and where it stands — and what changes the map is
 * another kind of thing. The middle of the foot is where the geo map's editing stands too, and it
 * keeps the two apart at any width: a group pinned to the corner opposite would meet the camera on a
 * narrow pane. Beside it in this module rather than in one of its own, as the mind map's two bars
 * are: a group of one button is not a file's worth, and the two are read together.
 *
 * Adding a note is the one thing this map is edited by, so the + carries its name in words rather
 * than standing as a bare glyph, as the geo map's does. It stands on the map rather than in the
 * note's own bar of actions, where it was: what it starts is finished by a click on the map, so it
 * belongs beside the canvas that answers it — the toast that follows says as much in words.
 */
export function EditToolbar({ isReadOnly, onAddNote }: EditToolbarProps) {
    return (
        <OverlayControlGroup className="relation-map-edit-toolbar">
            <OverlayControlButton
                title={t("relation_map_buttons.create_child_note_title")}
                icon="bx-folder-plus"
                text={t("relation_map_buttons.create_child_note_text")}
                className="relation-map-add-note-button"
                disabled={isReadOnly}
                onClick={onAddNote}
            />
        </OverlayControlGroup>
    );
}

/**
 * The scale the map is drawn at, followed as it changes — by these buttons, by the wheel, or by the
 * saved view being restored.
 *
 * Read off the map's own transform, which it reports as it is panned as well as zoomed: a pan leaves
 * the scale where it was, and a state set to the number it already holds costs nothing.
 */
function useMapScale(panZoom: PanZoom | undefined) {
    const [ scale, setScale ] = useState(1);

    useEffect(() => {
        if (!panZoom) return;

        const report = () => setScale(panZoom.getTransform().scale);
        // The map may have been moved between being built and being listened to.
        report();

        panZoom.on("transform", report);
        return () => panZoom.off("transform", report);
    }, [ panZoom ]);

    return scale;
}
