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
