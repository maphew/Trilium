/**
 * The rail of drawing tools over a geo map (see DrawToolbar.tsx). What is checked is that every tool
 * is offered, that a press arms the map and a press on an armed one stands it down, that the armed
 * tool is worn held down, and that a map that may not be edited carries no rail at all.
 */
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import type { DrawTool } from "./DrawShape";
import DrawToolbar from "./DrawToolbar";
import { ParentMap } from "./map";

/** Builds the rail over a map, which it asks nothing more of than being there at all. */
function renderRail({ map = {} as never, isReadOnly = false, drawingTool = null as DrawTool | null } = {}) {
    const onToggleDrawing = vi.fn();
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map}>
                <DrawToolbar isReadOnly={isReadOnly} drawingTool={drawingTool} onToggleDrawing={onToggleDrawing} />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the rail was not rendered");

    const all = () => [ ...container?.querySelectorAll<HTMLButtonElement>(".geo-draw-toolbar button") ?? [] ];
    return {
        onToggleDrawing,
        buttons: all,
        group: () => container?.querySelector(".geo-draw-toolbar") ?? null,
        button: (icon: string) => all().find((b) => b.classList.contains(icon)) ?? null
    };
}

/** Every drawing tool on the rail, by the icon its button wears. */
const DRAW_TOOL_ICONS: { tool: DrawTool; icon: string }[] = [
    { tool: "line", icon: "bx-vector" },
    { tool: "polygon", icon: "bx-shape-polygon" },
    { tool: "rectangle", icon: "bx-shape-square" },
    { tool: "circle", icon: "bx-shape-circle" }
];

describe("geo map DrawToolbar", () => {
    it("offers every drawing tool, wears the armed one as held down, and hands the arming to the map view", () => {
        for (const { tool, icon } of DRAW_TOOL_ICONS) {
            const { button, onToggleDrawing } = renderRail();

            expect(button(icon)?.classList.contains("active")).toBe(false);
            act(() => button(icon)?.click());
            expect(onToggleDrawing).toHaveBeenCalledWith(tool);

            const armed = renderRail({ drawingTool: tool });
            expect(armed.button(icon)?.classList.contains("active")).toBe(true);
        }
    });

    /**
     * A column down the leading edge rather than more buttons at the foot, which the scale and the
     * camera group already fill at phone width (see DrawToolbar.tsx).
     */
    it("stands as a column at the middle of the leading edge", () => {
        const { group, buttons } = renderRail();

        expect(group()?.getAttribute("data-orientation")).toBe("vertical");
        expect(group()?.getAttribute("data-placement")).toBe("middle-start");
        expect(buttons()).toHaveLength(DRAW_TOOL_ICONS.length);
    });

    /**
     * Drawing is all the rail offers, so a map that may not be edited would carry four dead buttons
     * and nothing else. The editing bar shows its own refused, having somewhere to stand either way.
     */
    it("comes off a map that may not be edited rather than standing there refused", () => {
        const { group, buttons } = renderRail({ isReadOnly: true });

        expect(group()).toBeNull();
        expect(buttons()).toHaveLength(0);
    });

    it("stands aside where there is no map at all", () => {
        const { buttons } = renderRail({ map: null as never });

        expect(buttons()).toHaveLength(0);
    });
});
