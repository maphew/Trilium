import { _getModelData as getModelData, _setModelData as setModelData, Essentials, Paragraph, Table, TableSelection, TableUtils } from "ckeditor5";
import type { ClassicEditor, ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import TableContextMenu from "./table_context_menu.js";

const INSERT_COMMANDS = [
    "triliumInsertTableRowsAbove",
    "triliumInsertTableRowsBelow",
    "triliumInsertTableColumnsLeft",
    "triliumInsertTableColumnsRight"
] as const;

describe("TableContextMenu", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Table, TableSelection, TableContextMenu]);
    });

    it("loads and registers the multi-insert commands", () => {
        expect(editor.plugins.get(TableContextMenu)).toBeInstanceOf(TableContextMenu);
        for (const name of INSERT_COMMANDS) {
            expect(editor.commands.get(name), name).toBeDefined();
        }
    });

    it("enables the insert commands only inside a table", () => {
        setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
        for (const name of INSERT_COMMANDS) {
            expect(editor.commands.get(name)?.isEnabled, name).toBe(false);
        }

        setModelData(editor.model, modelTable([["1[]1"]]));
        for (const name of INSERT_COMMANDS) {
            expect(editor.commands.get(name)?.isEnabled, name).toBe(true);
        }
    });

    describe("insert rows", () => {
        it("inserts one row above or below the caret row", () => {
            setModelData(editor.model, modelTable([["1[]1", "12"], ["21", "22"]]));
            editor.execute("triliumInsertTableRowsAbove");
            expect(tableData(editor)).toBe(modelTable([["", ""], ["11", "12"], ["21", "22"]]));

            setModelData(editor.model, modelTable([["1[]1", "12"], ["21", "22"]]));
            editor.execute("triliumInsertTableRowsBelow");
            expect(tableData(editor)).toBe(modelTable([["11", "12"], ["", ""], ["21", "22"]]));
        });

        it("inserts as many rows as the selection spans", () => {
            setModelData(editor.model, modelTable([["11"], ["21"], ["31"]]));
            selectCells(editor, [0, 0], [1, 0]);
            editor.execute("triliumInsertTableRowsAbove");
            expect(tableData(editor)).toBe(modelTable([[""], [""], ["11"], ["21"], ["31"]]));

            setModelData(editor.model, modelTable([["11"], ["21"], ["31"]]));
            selectCells(editor, [1, 0], [2, 0]);
            editor.execute("triliumInsertTableRowsBelow");
            expect(tableData(editor)).toBe(modelTable([["11"], ["21"], ["31"], [""], [""]]));
        });

        it("extends headingRows only when inserting inside the heading band", () => {
            setModelData(editor.model, modelTable([["h[]1"], ["21"]], 'headingRows="1"'));
            editor.execute("triliumInsertTableRowsAbove");
            expect(tableData(editor)).toBe(modelTable([[""], ["h1"], ["21"]], 'headingRows="2"'));

            setModelData(editor.model, modelTable([["h[]1"], ["21"]], 'headingRows="1"'));
            editor.execute("triliumInsertTableRowsBelow");
            expect(tableData(editor)).toBe(modelTable([["h1"], [""], ["21"]], 'headingRows="1"'));
        });
    });

    describe("insert columns", () => {
        it("inserts one column left or right of the caret column", () => {
            setModelData(editor.model, modelTable([["1[]1", "12"]]));
            editor.execute("triliumInsertTableColumnsLeft");
            expect(tableData(editor)).toBe(modelTable([["", "11", "12"]]));

            setModelData(editor.model, modelTable([["1[]1", "12"]]));
            editor.execute("triliumInsertTableColumnsRight");
            expect(tableData(editor)).toBe(modelTable([["11", "", "12"]]));
        });

        it("inserts as many columns as the selection spans", () => {
            setModelData(editor.model, modelTable([["11", "12", "13"]]));
            selectCells(editor, [0, 0], [0, 1]);
            editor.execute("triliumInsertTableColumnsLeft");
            expect(tableData(editor)).toBe(modelTable([["", "", "11", "12", "13"]]));

            setModelData(editor.model, modelTable([["11", "12", "13"]]));
            selectCells(editor, [0, 0], [0, 1]);
            editor.execute("triliumInsertTableColumnsRight");
            expect(tableData(editor)).toBe(modelTable([["11", "12", "", "", "13"]]));
        });
    });

    describe("syncSelectionToDomTarget", () => {
        it("moves the selection into an unselected cell", () => {
            setModelData(editor.model, modelTable([["1[]1", "12"], ["21", "22"]]));
            const plugin = editor.plugins.get(TableContextMenu);

            expect(plugin.syncSelectionToDomTarget(domCell(editor, 1, 1))).toBe(true);
            expect(selectionCells(editor)).toHaveLength(1);
            expect(selectionCells(editor)[0]).toBe(getCell(editor, 1, 1));

            // A node nested inside the cell resolves to the cell.
            const nested = domCell(editor, 0, 1).firstChild;
            expect(nested && plugin.syncSelectionToDomTarget(nested)).toBe(true);
            expect(selectionCells(editor)[0]).toBe(getCell(editor, 0, 1));
        });

        it("keeps a multi-cell selection that contains the target", () => {
            setModelData(editor.model, modelTable([["11", "12"], ["21", "22"]]));
            const plugin = editor.plugins.get(TableContextMenu);
            selectCells(editor, [0, 0], [1, 1]);

            expect(plugin.syncSelectionToDomTarget(domCell(editor, 0, 1))).toBe(true);
            expect(selectionCells(editor)).toHaveLength(4);
            expect(selectionCells(editor)).toContain(getCell(editor, 0, 0));
        });

        it("rejects targets outside a table cell of this editor", () => {
            setModelData(editor.model, "<paragraph>foo</paragraph>");
            const plugin = editor.plugins.get(TableContextMenu);

            const paragraph = editor.editing.view.getDomRoot()?.querySelector("p");
            expect(paragraph && plugin.syncSelectionToDomTarget(paragraph)).toBe(false);
            expect(plugin.syncSelectionToDomTarget(document.body)).toBe(false);

            const strayCell = document.createElement("td");
            document.body.appendChild(strayCell);
            try {
                expect(plugin.syncSelectionToDomTarget(strayCell)).toBe(false);
            } finally {
                strayCell.remove();
            }
        });
    });

    describe("right-button mousedown", () => {
        it("keeps a cell selection alive under a right-click on it", () => {
            setModelData(editor.model, modelTable([["11", "12"], ["21", "22"]]));
            selectCells(editor, [0, 0], [1, 1]);

            const event = mouseDown(domCell(editor, 0, 1), 2);

            expect(event.defaultPrevented).toBe(true);
            expect(selectionCells(editor)).toHaveLength(4);
        });

        it("does not interfere with other clicks", () => {
            setModelData(editor.model, modelTable([["11", "12"], ["21", "22"]]));
            selectCells(editor, [0, 0], [1, 0]);

            // Left button on a selected cell.
            expect(mouseDown(domCell(editor, 0, 0), 0).defaultPrevented).toBe(false);

            // Right button outside the cell selection.
            expect(mouseDown(domCell(editor, 1, 1), 2).defaultPrevented).toBe(false);

            // Right button with a plain in-cell selection.
            setModelData(editor.model, modelTable([["1[]1"]]));
            expect(mouseDown(domCell(editor, 0, 0), 2).defaultPrevented).toBe(false);
        });
    });
});

function modelTable(rows: string[][], attributes = ""): string {
    const rowsMarkup = rows
        .map((cells) => {
            const cellsMarkup = cells
                .map((cell) => `<tableCell><paragraph>${cell}</paragraph></tableCell>`)
                .join("");
            return `<tableRow>${cellsMarkup}</tableRow>`;
        })
        .join("");
    return `<table${attributes ? ` ${attributes}` : ""}>${rowsMarkup}</table>`;
}

function tableData(editor: ClassicEditor): string {
    return getModelData(editor.model, { withoutSelection: true });
}

function getCell(editor: ClassicEditor, row: number, column: number): ModelElement {
    const cell = editor.model.document.getRoot()?.getNodeByPath([0, row, column]);
    if (!cell || !cell.is("element", "tableCell")) {
        throw new Error(`No table cell at row ${row}, column ${column}.`);
    }
    return cell;
}

function domCell(editor: ClassicEditor, row: number, column: number): HTMLElement {
    const viewCell = editor.editing.mapper.toViewElement(getCell(editor, row, column));
    const dom = viewCell && editor.editing.view.domConverter.mapViewToDom(viewCell);
    if (!(dom instanceof HTMLElement)) {
        throw new Error(`No DOM cell at row ${row}, column ${column}.`);
    }
    return dom;
}

function selectCells(editor: ClassicEditor, anchor: [number, number], target: [number, number]) {
    editor.plugins.get(TableSelection).setCellSelection(
        getCell(editor, anchor[0], anchor[1]),
        getCell(editor, target[0], target[1])
    );
}

function selectionCells(editor: ClassicEditor): ModelElement[] {
    return editor.plugins.get(TableUtils).getSelectionAffectedTableCells(editor.model.document.selection);
}

function mouseDown(target: HTMLElement, button: number): MouseEvent {
    const event = new MouseEvent("mousedown", { button, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}
