/**
 * The drawing tools over a geo map (see DrawToolbar.tsx). What is checked is that every tool is
 * offered, that a press arms the map and a press on an armed one stands it down, that the armed tool
 * is worn held down, that the width of the map settles where they stand, and that a map that may not
 * be edited carries none of them at all.
 */
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import type { DrawTool } from "./DrawShape";
import DrawToolbar from "./DrawToolbar";
import { ParentMap } from "./map";

/** A map of a given width, which is all the tools ask of one: where they stand follows from it. */
function fakeMap(width: number) {
    const container = document.createElement("div");
    Object.defineProperty(container, "clientWidth", { value: width, configurable: true });
    return { getContainer: () => container } as never;
}

/** A map with no room at its head, which is where the tools stand in a column down its side. */
const NARROW = 400;

/** A map roomy enough for the tools to stand across its head, clear of the search bar and the pane. */
const ROOMY = 1200;

/** Builds the tools over a map of the given width. */
function renderTools({ map = fakeMap(NARROW), isReadOnly = false, drawingTool = null as DrawTool | null } = {}) {
    const onToggleDrawing = vi.fn();
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map}>
                <DrawToolbar isReadOnly={isReadOnly} drawingTool={drawingTool} onToggleDrawing={onToggleDrawing} />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the tools were not rendered");

    const all = () => [ ...container?.querySelectorAll<HTMLButtonElement>(".geo-draw-toolbar button") ?? [] ];
    return {
        onToggleDrawing,
        buttons: all,
        group: () => container?.querySelector(".geo-draw-toolbar") ?? null,
        button: (icon: string) => all().find((b) => b.classList.contains(icon)) ?? null
    };
}

/** Every drawing tool, by the icon its button wears. */
const DRAW_TOOL_ICONS: { tool: DrawTool; icon: string }[] = [
    { tool: "line", icon: "bx-vector" },
    { tool: "polygon", icon: "bx-shape-polygon" },
    { tool: "rectangle", icon: "bx-shape-square" },
    { tool: "circle", icon: "bx-shape-circle" }
];

describe("geo map DrawToolbar", () => {
    it("offers every drawing tool, wears the armed one as held down, and hands the arming to the map view", () => {
        for (const { tool, icon } of DRAW_TOOL_ICONS) {
            const { button, onToggleDrawing } = renderTools();

            expect(button(icon)?.classList.contains("active")).toBe(false);
            act(() => button(icon)?.click());
            expect(onToggleDrawing).toHaveBeenCalledWith(tool);

            const armed = renderTools({ drawingTool: tool });
            expect(armed.button(icon)?.classList.contains("active")).toBe(true);
        }
    });

    /**
     * A column down the leading edge rather than more buttons at the foot, which the scale and the
     * camera group already fill at this width (see DrawToolbar.tsx).
     */
    it("stands as a column at the middle of the leading edge of a narrow map", () => {
        const { group, buttons } = renderTools();

        expect(group()?.getAttribute("data-orientation")).toBe("vertical");
        expect(group()?.getAttribute("data-placement")).toBe("middle-start");
        expect(buttons()).toHaveLength(DRAW_TOOL_ICONS.length);
    });

    /** Where the head is wide enough to clear the search bar and the detail pane standing on it. */
    it("stands as a bar across the head of a roomy map", () => {
        const { group, buttons } = renderTools({ map: fakeMap(ROOMY) });

        expect(group()?.getAttribute("data-placement")).toBe("top-center");
        expect(group()?.hasAttribute("data-orientation")).toBe(false);
        expect(buttons()).toHaveLength(DRAW_TOOL_ICONS.length);
    });

    /**
     * Drawing is all the group offers, so a map that may not be edited would carry four dead buttons
     * and nothing else. The editing bar shows its own refused, having somewhere to stand either way.
     */
    it("comes off a map that may not be edited rather than standing there refused", () => {
        const { group, buttons } = renderTools({ isReadOnly: true });

        expect(group()).toBeNull();
        expect(buttons()).toHaveLength(0);
    });

    it("stands aside where there is no map at all", () => {
        const { buttons } = renderTools({ map: null as never });

        expect(buttons()).toHaveLength(0);
    });
});
