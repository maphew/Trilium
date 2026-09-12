import { useContext } from "preact/hooks";

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
 * The drawing tools, in a column down the leading edge of the map.
 *
 * A rail of their own rather than four more buttons on {@link EditToolbar}, because the foot of the
 * map is full: the scale holds one corner and {@link MapToolbar} the other, and what is left in the
 * middle at phone width fits about three buttons. The middle of the leading edge is free at every
 * width, and a column grows into the map's height rather than towards either corner.
 *
 * Each button wears the shape its tool draws and no words, the shapes being what there is to say.
 * The armed tool is shown held down, and its tooltip says what a second press does, as the marker
 * button's does.
 */
export default function DrawToolbar({ isReadOnly, drawingTool, onToggleDrawing }: DrawToolbarProps) {
    const map = useContext(ParentMap);

    // No rail over a map that could not be drawn (see the WebGL fallback in map.tsx), and none over
    // one that may not be edited: every button on it draws, so all four would be disabled at once.
    if (!map || isReadOnly) return null;

    return (
        <OverlayControlGroup className="geo-draw-toolbar" placement="middle-start" vertical overCanvas>
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

/** The tools in the order they stand on the rail, each wearing the shape it draws. */
const DRAW_TOOLS: { tool: DrawTool; icon: string; title: () => string }[] = [
    { tool: "line", icon: "bx-vector", title: () => t("geo-map.draw-line") },
    { tool: "polygon", icon: "bx-shape-polygon", title: () => t("geo-map.draw-polygon") },
    { tool: "rectangle", icon: "bx-shape-square", title: () => t("geo-map.draw-rectangle") },
    { tool: "circle", icon: "bx-shape-circle", title: () => t("geo-map.draw-circle") }
];
