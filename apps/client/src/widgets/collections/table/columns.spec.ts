import { describe, expect, it, vi } from "vitest";
import { buildColumnDefinitions, formatLabelDate, restoreExistingData, type SelectEditorParams } from "./columns";
import type { CellComponent, ColumnDefinition } from "tabulator-tables";

import options from "../../../services/options";

describe("restoreExistingData", () => {
    it("maintains important columns properties", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", formatter: "color", visible: false }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].editor).toBe("input");
        expect(restored[1].formatter).toBe("color");
    });

    it("should restore existing column data", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].width).toBe(300);
        expect(restored[1].width).toBe(200);
    });

    it("restores order of columns", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "noteId", title: "Note ID", width: 200, visible: true },
            { field: "title", title: "Title", width: 300, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].field).toBe("noteId");
        expect(restored[1].field).toBe("title");
    });

    it("inserts new columns at given position", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "newColumn", title: "New Column", editor: "input" }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs, 0);
        expect(restored.length).toBe(3);
        expect(restored[0].field).toBe("newColumn");
        expect(restored[1].field).toBe("title");
        expect(restored[2].field).toBe("noteId");
    });

    it("inserts new columns at the end if no position is specified", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "newColumn", title: "New Column", editor: "input" }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored.length).toBe(3);
        expect(restored[0].field).toBe("title");
        expect(restored[1].field).toBe("noteId");
        expect(restored[2].field).toBe("newColumn");
    });

    it("supports a rename", () => {
        const newDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", editor: "input" },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "newColumn", title: "New Column", editor: "input" }
        ];
        const oldDefs: ColumnDefinition[] = [
            { field: "title", title: "Title", width: 300, visible: true },
            { field: "noteId", title: "Note ID", width: 200, visible: true },
            { field: "oldColumn", title: "New Column", editor: "input" }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored.length).toBe(3);
    });

    it("doesn't alter the existing order", () => {
        const newDefs: ColumnDefinition[] = [
            { title: "#", headerSort: false, hozAlign: "center", resizable: false, frozen: true, rowHandle: false },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "title", title: "Title", editor: "input", width: 400 }
        ]
        const oldDefs: ColumnDefinition[] = [
            { title: "#", headerSort: false, hozAlign: "center", resizable: false, rowHandle: false },
            { field: "noteId", title: "Note ID", visible: false },
            { field: "title", title: "Title", editor: "input", width: 400 }
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored).toStrictEqual(newDefs);
    });

    it("allows hiding the row number column", () => {
        const newDefs: ColumnDefinition[] = [
            { title: "#", headerSort: false, hozAlign: "center", resizable: false, frozen: true, rowHandle: false },
        ]
        const oldDefs: ColumnDefinition[] = [
            { title: "#", headerSort: false, hozAlign: "center", resizable: false, rowHandle: false, visible: false },
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].visible).toStrictEqual(false);
    });

    it("enforces size for non-resizable columns", () => {
        const newDefs: ColumnDefinition[] = [
            { title: "#", resizable: false, width: "100px" },
        ]
        const oldDefs: ColumnDefinition[] = [
            { title: "#", resizable: false, width: "120px" },
        ];
        const restored = restoreExistingData(newDefs, oldDefs);
        expect(restored[0].width).toStrictEqual("100px");
    });
});

describe("buildColumnDefinitions — select columns", () => {
    /** Resolves the params a column hands its editor, which Tabulator asks for as a function. */
    function editorParamsOf(column: ColumnDefinition | undefined) {
        const params = column?.editorParams;
        if (typeof params !== "function") throw new Error("expected the params to be a function");
        return params({} as CellComponent) as SelectEditorParams;
    }

    function selectColumn(onCreateSelectOption?: (columnName: string, option: string) => void) {
        const columns = buildColumnDefinitions({
            info: [ { name: "status", type: "select", options: [ "Todo", "Done" ] } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1,
            onCreateSelectOption
        });
        return columns.find((column) => column.field === "labels.status");
    }

    it("hands the editor the column's own options, and a way to add to them", () => {
        const onCreateSelectOption = vi.fn();
        const params = editorParamsOf(selectColumn(onCreateSelectOption));

        expect(params.options).toEqual([ "Todo", "Done" ]);

        // The editor knows the option alone; the column it belongs to is bound in here.
        params.onCreateOption?.("Blocked");
        expect(onCreateSelectOption).toHaveBeenCalledWith("status", "Blocked");
    });

    it("leaves the editor no way to create where the caller offers none", () => {
        // Without it the field stays a plain picker rather than calling something undefined.
        expect(editorParamsOf(selectColumn()).onCreateOption).toBeUndefined();
    });
});

describe("formatLabelDate", () => {
    it("renders dates and datetimes in the configured formatting locale", () => {
        options.set("formattingLocale", "de");

        expect(formatLabelDate("2026-01-31", false)).toBe("31.01.2026");
        expect(formatLabelDate("2026-01-31T14:05", true)).toBe("31.01.2026, 14:05");
    });

    it("keeps a date-only value on its calendar day rather than shifting it by timezone", () => {
        options.set("formattingLocale", "de");

        // Parsed as UTC midnight, "2026-01-31" would roll back a day in a negative UTC offset.
        expect(formatLabelDate("2026-01-31", false)).toBe("31.01.2026");
    });

    it("echoes values that are not dates instead of throwing inside the grid render", () => {
        options.set("formattingLocale", "de");

        // Intl throws a RangeError on an invalid date, which would break the whole table.
        expect(formatLabelDate("not a date", true)).toBe("not a date");
        expect(formatLabelDate("not a date", false)).toBe("not a date");
    });

    it("renders a blank cell for missing values", () => {
        expect(formatLabelDate(undefined, false)).toBe("");
        expect(formatLabelDate(null, true)).toBe("");
        expect(formatLabelDate("", false)).toBe("");
    });
});
