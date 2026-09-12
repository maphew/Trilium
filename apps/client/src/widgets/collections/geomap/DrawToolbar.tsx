import type { Map as MapLibreGLMap } from "maplibre-gl";
import { useContext, useLayoutEffect, useState } from "preact/hooks";

import { t } from "../../../services/i18n";
import OverlayControlGroup, { OverlayControlButton } from "../../react/OverlayControlGroup";
import type { DrawTool } from "./DrawShape";
import { ParentMap } from "./map";

interface DrawToolbarProps {
    /** The map may not be edited, which takes the rail off it entirely. */
    isReadOnly: boolean;
    /** The tool the map is armed to draw with, if any — its button worn held down. */
    drawingTool: DrawTool | null;
    /** Arms the map to draw with the tool, or stands it down again (see index.tsx). */
    onToggleDrawing: (tool: DrawTool) => void;
}

/**
 * The drawing tools, across the head of the map where there is room for them and in a column down
 * its leading edge where there is not.
 *
 * A group of their own rather than four more buttons on {@link EditToolbar}, because the foot of the
 * map is full: the scale holds one corner and {@link MapToolbar} the other, and what is left in the
 * middle at phone width fits about three buttons. The head is clear on a roomy map; on a narrow one
 * the leading edge is, and a column grows into the map's height rather than towards either corner.
 *
 * Each button wears the shape its tool draws and no words, the shapes being what there is to say.
 * The armed tool is shown held down, and its tooltip says what a second press does, as the marker
 * button's does.
 */
export default function DrawToolbar({ isReadOnly, drawingTool, onToggleDrawing }: DrawToolbarProps) {
    const map = useContext(ParentMap);
    const acrossTheHead = useRoomAcrossTheHead(map);

    // No tools over a map that could not be drawn (see the WebGL fallback in map.tsx), and none
    // over one that may not be edited: every button draws, so all four would be disabled at once.
    if (!map || isReadOnly) return null;

    return (
        <OverlayControlGroup
            className="geo-draw-toolbar"
            placement={acrossTheHead ? "top-center" : "middle-start"}
            vertical={!acrossTheHead}
            overCanvas
        >
            {DRAW_TOOLS.map(({ tool, icon, title }) => (
                <OverlayControlButton
                    key={tool}
                    title={drawingTool === tool ? t("geo-map.draw-cancel") : title()}
                    icon={icon}
                    active={drawingTool === tool}
                    onClick={() => onToggleDrawing(tool)}
                />
            ))}
        </OverlayControlGroup>
    );
}

/** How wide the map must be for the tools to clear the search bar and the detail pane at its head,
 *  a group centred between the insets keeping half of what it does not take on either side. */
const HEAD_BAR_MIN_WIDTH = 920;

/**
 * Whether the map has room for the tools across its head, followed as the map is resized. Measured
 * rather than asked of the device: a map sharing a desktop screen with another note is as narrow as
 * a phone's, and the search bar and the detail pane stand at the head of it either way.
 *
 * Measured before the paint, since the map arrives a render after the group does and the column is
 * what a group with nothing measured yet would be drawn as.
 */
function useRoomAcrossTheHead(map: MapLibreGLMap | null) {
    const [ hasRoom, setHasRoom ] = useState(false);

    useLayoutEffect(() => {
        if (!map) return;

        const container = map.getContainer();
        function measure() {
            setHasRoom(container.clientWidth >= HEAD_BAR_MIN_WIDTH);
        }

        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(container);
        return () => observer.disconnect();
    }, [ map ]);

    return hasRoom;
}

/** The tools in the order they stand, each wearing the shape it draws. */
const DRAW_TOOLS: { tool: DrawTool; icon: string; title: () => string }[] = [
    { tool: "line", icon: "bx-vector", title: () => t("geo-map.draw-line") },
    { tool: "polygon", icon: "bx-shape-polygon", title: () => t("geo-map.draw-polygon") },
    { tool: "rectangle", icon: "bx-shape-square", title: () => t("geo-map.draw-rectangle") },
    { tool: "circle", icon: "bx-shape-circle", title: () => t("geo-map.draw-circle") }
];
