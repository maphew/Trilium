/**
 * The bar of editing actions over a geo map (see EditToolbar.tsx). What is checked is the one
 * button it holds so far: that a press arms the map and a press on an armed one stands it down,
 * that the mode is worn as held down, and that a map that may not be edited refuses it.
 */
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import EditToolbar from "./EditToolbar";
import { ParentMap } from "./map";

/** Builds the bar over a map, which it asks nothing more of than being there at all. */
function renderBar({ map = {} as never, isReadOnly = false, placing = false } = {}) {
    const onTogglePlacement = vi.fn();
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map}>
                <EditToolbar isReadOnly={isReadOnly} placing={placing} onTogglePlacement={onTogglePlacement} />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the toolbar was not rendered");

    return {
        onTogglePlacement,
        button: () => container?.querySelector<HTMLButtonElement>(".geo-edit-toolbar button") ?? null
    };
}

describe("geo map EditToolbar", () => {
    it("offers to add a note, and hands the arming to the map view", () => {
        const { button, onTogglePlacement } = renderBar();

        expect(button()?.className).toContain("bx-plus");
        expect(button()?.classList.contains("active")).toBe(false);

        act(() => button()?.click());
        expect(onTogglePlacement).toHaveBeenCalledTimes(1);
    });

    it("wears an armed map as held down, and the same press stands it down", () => {
        const { button, onTogglePlacement } = renderBar({ placing: true });

        expect(button()?.classList.contains("active")).toBe(true);

        act(() => button()?.click());
        expect(onTogglePlacement).toHaveBeenCalledTimes(1);
    });

    it("refuses on a map that may not be edited", () => {
        const { button } = renderBar({ isReadOnly: true });

        expect(button()?.disabled).toBe(true);
    });

    it("stands aside where there is no map at all", () => {
        const { button } = renderBar({ map: null as never });

        expect(button()).toBeNull();
    });
});
