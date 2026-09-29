import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/i18n.js", () => ({ t: (key: string) => key }));
vi.mock("./text_editor_context_menu.js", () => ({ getTextEditorContaining: vi.fn() }));

import type { CKTextEditor } from "@triliumnext/ckeditor5";

import type { MenuCommandItem, MenuItem } from "./context_menu.js";
import {
    buildTableContextMenuItems,
    buildTableMenuItems,
    hasTableCellSelection
} from "./table_context_menu.js";
import { getTextEditorContaining } from "./text_editor_context_menu.js";

const SECTION_TITLES = [
    "table_context_menu.insert_rows_above",
    "table_context_menu.insert_rows_below",
    "---",
    "table_context_menu.insert_columns_left",
    "table_context_menu.insert_columns_right",
    "---",
    "table_context_menu.delete_rows",
    "table_context_menu.delete_columns",
    "table_context_menu.delete_table",
    "---",
    "table_context_menu.distribute_columns",
    "---",
    "table_context_menu.merge_cells",
    "table_context_menu.split_cells"
];

describe("buildTableMenuItems", () => {
    it("returns the section in order, with a split submenu", () => {
        const { editor, syncSelectionToDomTarget } = stubEditor();
        const element = cellElement();

        const items = buildTableMenuItems(editor, element) ?? [];

        expect(syncSelectionToDomTarget).toHaveBeenCalledWith(element);
        expect(titles(items)).toEqual(SECTION_TITLES);

        const submenu = findItem(items, "table_context_menu.split_cells")?.items ?? [];
        expect(titles(submenu)).toEqual([
            "table_context_menu.split_vertically",
            "table_context_menu.split_horizontally"
        ]);
    });

    it("executes the mapped command and refocuses the editor", () => {
        const { editor, executed, focus } = stubEditor();
        const items = buildTableMenuItems(editor, cellElement()) ?? [];
        const submenu = findItem(items, "table_context_menu.split_cells")?.items ?? [];

        for (const title of titles(items).filter((t) => t !== "---")) {
            run(items, title);
        }
        run(submenu, "table_context_menu.split_vertically");
        run(submenu, "table_context_menu.split_horizontally");

        expect(executed).toEqual([
            "triliumInsertTableRowsAbove",
            "triliumInsertTableRowsBelow",
            "triliumInsertTableColumnsLeft",
            "triliumInsertTableColumnsRight",
            "removeTableRow",
            "removeTableColumn",
            "triliumDeleteTable",
            "triliumDistributeTableColumns",
            "mergeTableCells",
            "splitTableCellVertically",
            "splitTableCellHorizontally"
        ]);
        expect(focus).toHaveBeenCalledTimes(executed.length);
    });

    it("snapshots each row's enablement from its command", () => {
        const { editor } = stubEditor([
            "mergeTableCells",
            "splitTableCellVertically",
            "removeTableRow",
            "triliumDistributeTableColumns"
        ]);
        const items = buildTableMenuItems(editor, cellElement()) ?? [];

        expect(findItem(items, "table_context_menu.distribute_columns")?.enabled).toBe(false);
        expect(findItem(items, "table_context_menu.merge_cells")?.enabled).toBe(false);
        expect(findItem(items, "table_context_menu.split_cells")?.enabled).toBe(true);
        expect(findItem(items, "table_context_menu.delete_rows")?.enabled).toBe(false);
        expect(findItem(items, "table_context_menu.delete_columns")?.enabled).toBe(true);
        expect(findItem(items, "table_context_menu.insert_rows_above")?.enabled).toBe(true);
    });

    it("enables the split submenu while either split direction is enabled", () => {
        const splitRow = (disabled: string[]) => {
            const { editor } = stubEditor(disabled);
            const items = buildTableMenuItems(editor, cellElement()) ?? [];
            return findItem(items, "table_context_menu.split_cells")?.enabled;
        };

        expect(splitRow(["splitTableCellVertically"])).toBe(true);
        expect(splitRow(["splitTableCellHorizontally"])).toBe(true);
        expect(splitRow(["splitTableCellVertically", "splitTableCellHorizontally"])).toBe(false);
    });

    it("returns null without the plugin or a table cell at the target", () => {
        const { editor: withoutPlugin } = stubEditor([], { hasPlugin: false });
        expect(buildTableMenuItems(withoutPlugin, cellElement())).toBeNull();

        const { editor } = stubEditor([], { syncResult: false });
        expect(buildTableMenuItems(editor, cellElement())).toBeNull();
    });
});

describe("buildTableContextMenuItems", () => {
    const resolveEditor = vi.mocked(getTextEditorContaining);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("ignores targets outside a table cell without resolving the editor", async () => {
        expect(await buildTableContextMenuItems(null)).toBeNull();
        expect(await buildTableContextMenuItems(document.createElement("div"))).toBeNull();
        expect(resolveEditor).not.toHaveBeenCalled();
    });

    it("builds the section for a cell target inside the active text editor", async () => {
        const { editor } = stubEditor();
        resolveEditor.mockResolvedValue(editor);
        const element = cellElement();

        const items = (await buildTableContextMenuItems(element)) ?? [];

        expect(resolveEditor).toHaveBeenCalledWith(element);
        expect(titles(items)).toEqual(SECTION_TITLES);
    });

    it("returns null when no text editor contains the target", async () => {
        resolveEditor.mockResolvedValue(null);
        expect(await buildTableContextMenuItems(cellElement())).toBeNull();
    });
});

describe("hasTableCellSelection", () => {
    const resolveEditor = vi.mocked(getTextEditorContaining);

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("reports the resolved editor's multi-cell selection", async () => {
        let selected: unknown[] | null = [ {}, {} ];
        resolveEditor.mockResolvedValue({
            plugins: {
                has: (name: string) => name === "TableSelection",
                get: () => ({ getSelectedTableCells: () => selected })
            }
        } as unknown as CKTextEditor);

        expect(await hasTableCellSelection(cellElement())).toBe(true);

        // A caret or a plain text range inside one cell reports null.
        selected = null;
        expect(await hasTableCellSelection(cellElement())).toBe(false);
    });

    it("reports false without an element, an editor, or the plugin", async () => {
        expect(await hasTableCellSelection(null)).toBe(false);
        expect(resolveEditor).not.toHaveBeenCalled();

        resolveEditor.mockResolvedValue(null);
        expect(await hasTableCellSelection(cellElement())).toBe(false);

        resolveEditor.mockResolvedValue(
            { plugins: { has: () => false } } as unknown as CKTextEditor
        );
        expect(await hasTableCellSelection(cellElement())).toBe(false);
    });
});

/**
 * A minimal editor double: `TableContextMenu` is present unless `hasPlugin` says otherwise, and
 * every command is enabled except the ones in `disabledCommands`.
 */
function stubEditor(disabledCommands: string[] = [], { hasPlugin = true, syncResult = true } = {}) {
    const executed: string[] = [];
    const focus = vi.fn();
    const syncSelectionToDomTarget = vi.fn(() => syncResult);
    const editor = {
        plugins: {
            has: (name: string) => hasPlugin && name === "TableContextMenu",
            get: () => ({ syncSelectionToDomTarget })
        },
        commands: {
            get: (name: string) => ({ isEnabled: !disabledCommands.includes(name) })
        },
        execute: (name: string) => {
            executed.push(name);
        },
        editing: { view: { focus } }
    };

    return { editor: editor as unknown as CKTextEditor, executed, focus, syncSelectionToDomTarget };
}

/** A node nested inside a detached `<td>`, standing in for the right-click target. */
function cellElement(): Element {
    const cell = document.createElement("td");
    const inner = document.createElement("span");
    cell.appendChild(inner);
    return inner;
}

/** The titles of `items`, with separators rendered as "---" so ordering stays readable. */
function titles(items: MenuItem<any>[]) {
    return items.map((item) => ("kind" in item && item.kind === "separator"
        ? "---"
        : (item as MenuCommandItem<any>).title));
}

function findItem(items: MenuItem<any>[], title: string) {
    const found = items.find((item) => !("kind" in item) && item.title === title);
    return found as MenuCommandItem<any> | undefined;
}

function run(items: MenuItem<any>[], title: string) {
    findItem(items, title)?.handler?.({} as never, {} as never);
}
