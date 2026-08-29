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

    function openMenu(
        api: BoardApi,
        column: { color?: string, archived?: boolean } = {},
        onEditTitle = () => {}
    ) {
        const show = vi.spyOn(contextMenu, "show").mockImplementation(async () => {});
        const event = {
            preventDefault: () => {},
            stopPropagation: () => {},
            pageX: 0,
            pageY: 0
        } as ContextMenuEvent;

        openColumnContextMenu(api, event, { value: "To Do", ...column, onEditTitle });

        // The spy outlives one call, so it is the menu just opened that is read back.
        return show.mock.calls.at(-1)?.[0].items ?? [];
    }

    /** Renders the colour picker the menu offers for a column already carrying `color`. */
    async function openPicker(api: BoardApi, color?: string) {
        const items = openMenu(api, { color });
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

    it("offers the title editor, which the retired header button used to open", () => {
        const onEditTitle = vi.fn();
        const items = openMenu({} as BoardApi, {}, onEditTitle);

        // Found by its icon: i18next is never initialised under test, so every title is undefined.
        const entry = items.find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-edit-alt");
        if (!entry || !("handler" in entry)) throw new Error("expected an edit-title entry");

        entry.handler?.(entry, {} as never);
        expect(onEditTitle).toHaveBeenCalled();
    });

    it("offers to archive a column, and to bring back one already archived", () => {
        const api = { setColumnArchived: vi.fn() } as unknown as BoardApi;

        const archive = openMenu(api).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-archive");
        if (!archive || !("handler" in archive)) throw new Error("expected an archive entry");
        archive.handler?.(archive, {} as never);
        expect(api.setColumnArchived).toHaveBeenLastCalledWith("To Do", true);

        const unarchive = openMenu(api, { archived: true }).find(item =>
            item && "uiIcon" in item && item.uiIcon === "bx bx-archive-out");
        if (!unarchive || !("handler" in unarchive)) throw new Error("expected an unarchive entry");
        unarchive.handler?.(unarchive, {} as never);
        expect(api.setColumnArchived).toHaveBeenLastCalledWith("To Do", false);
    });

    it("puts archiving above deleting, so the safe way out leads", () => {
        const titled = openMenu({} as BoardApi).filter(item => item && "uiIcon" in item);
        expect(titled.map(item => "uiIcon" in item ? item.uiIcon : undefined))
            .toEqual([ "bx bx-edit-alt", "bx bx-archive", "bx bx-trash" ]);
    });

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
