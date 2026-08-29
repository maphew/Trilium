import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import contextMenu, { ContextMenuEvent } from "../../../menus/context_menu";
import BoardApi from "./api";
import { openColumnContextMenu } from "./context_menu";

describe("Board column context menu", () => {
    let container: HTMLElement | undefined;

    afterEach(() => {
        vi.restoreAllMocks();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** Renders the colour picker the menu offers for a column already carrying `color`. */
    async function openPicker(api: BoardApi, color?: string) {
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const event = {
            preventDefault: () => {},
            stopPropagation: () => {},
            pageX: 0,
            pageY: 0
        } as ContextMenuEvent;

        openColumnContextMenu(api, event, "To Do", color);

        const items = show.mock.calls[0][0].items ?? [];
        const custom = items.find(item => item && "kind" in item && item.kind === "custom");
        if (!custom || !("componentFn" in custom)) {
            throw new Error("expected a colour picker in the menu");
        }

        const element = document.createElement("div");
        container = element;
        document.body.appendChild(element);
        // Rendered as a component, the way the menu itself does it, so its hooks have a context.
        await act(async () => {
            render(h(custom.componentFn, {}), element);
        });

        return element;
    }

    it("shows the column's own colour as the selected one", async () => {
        const api = { setColumnColor: vi.fn() } as unknown as BoardApi;
        const picker = await openPicker(api, "#4d99e6");

        const selected = picker.querySelector<HTMLElement>(".color-cell.selected");
        expect(selected?.style.getPropertyValue("--color")).toBe("#4d99e6");
    });

    it("writes a pick to the column, and a clear back to no colour", async () => {
        const api = { setColumnColor: vi.fn() } as unknown as BoardApi;
        const picker = await openPicker(api);

        // The reset cell leads the row, so the first plain cell after it is a preset.
        const preset = picker
            .querySelectorAll<HTMLElement>(".color-cell:not(.color-cell-reset)")[0];
        await act(async () => preset.click());
        expect(api.setColumnColor)
            .toHaveBeenLastCalledWith("To Do", preset.style.getPropertyValue("--color"));

        await act(async () => picker.querySelector<HTMLElement>(".color-cell-reset")?.click());
        expect(api.setColumnColor).toHaveBeenLastCalledWith("To Do", null);
    });
});
