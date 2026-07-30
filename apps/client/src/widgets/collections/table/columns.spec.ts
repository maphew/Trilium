import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { type AttributeDefinitionInformation, buildColumnDefinitions, formatLabelDate, restoreExistingData, type ValuesEditorParams } from "./columns";
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

describe("buildColumnDefinitions — typed columns", () => {
    it("edits every temporal type through its native picker, as the promoted field does", () => {
        const columns = buildColumnDefinitions({
            info: [
                { name: "date", type: "date" },
                { name: "datetime", type: "datetime" },
                { name: "time", type: "time" }
            ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        });
        const editorOf = (name: string) => columns.find((column) => column.field === `labels.${name}`)?.editor;

        expect(editorOf("date")).toBe("date");
        expect(editorOf("datetime")).toBe("datetime");
        // A plain input here would be a text box to type "14:05" into by hand.
        expect(editorOf("time")).toBe("time");
    });

    it("hands a url column's href through the scheme guard rather than linking the value as stored", () => {
        const column = buildColumnDefinitions({
            info: [ { name: "site", type: "url" } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).find((column) => column.field === "labels.site");

        // Tabulator's link formatter assigns whatever it is given straight to the anchor's href.
        const url = (column?.formatterParams as { url?: (cell: CellComponent) => string })?.url;
        if (typeof url !== "function") throw new Error("expected the href to be built by a callback");
        expect(url({ getValue: () => "javascript:alert(1)" } as CellComponent)).toBe("about:blank");
        expect(url({ getValue: () => "https://example.com" } as CellComponent)).toBe("https://example.com");
    });
});

describe("buildColumnDefinitions — colour columns", () => {
    /** Opens a colour cell's editor, as Tabulator does, and hands back what it built. */
    async function editColorCell(value: string) {
        const [ column ] = buildColumnDefinitions({
            info: [ { name: "tint", type: "color" } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).filter((candidate) => candidate.field === "labels.tint");

        const editor = column?.editor;
        if (typeof editor !== "function") throw new Error("expected an editor of its own");

        const success = vi.fn();
        let element: HTMLElement | false = false;
        await act(async () => {
            element = editor({ getValue: () => value } as CellComponent, () => {}, success, () => {}, {});
        });
        if (!element) throw new Error("expected the editor to build a field");
        return { element: element as HTMLElement, success };
    }

    it("reports the picked colour once the pick is settled, not through the drag", async () => {
        const { element, success } = await editColorCell("#ff0000");
        const picker = element.querySelector<HTMLInputElement>("input[type=color]");
        if (!picker) throw new Error("expected a colour picker");

        picker.value = "#00ff00";
        // Reporting ends the edit, so a colour reported as the picker is dragged through would tear
        // the editor down — and with it the open picker — at the first step.
        picker.dispatchEvent(new Event("input", { bubbles: true }));
        expect(success).not.toHaveBeenCalled();

        picker.dispatchEvent(new Event("change", { bubbles: true }));
        expect(success).toHaveBeenCalledWith("#00ff00");
    });

    it("clears a colour back to the unset value a bare picker cannot express", async () => {
        const { element, success } = await editColorCell("#ff0000");

        element.querySelector<HTMLElement>(".input-group-text")?.click();
        expect(success).toHaveBeenCalledWith("");
    });

    it("shows a colour as a swatch, naming it in the tooltip, and an unset one as nothing", () => {
        const [ column ] = buildColumnDefinitions({
            info: [ { name: "tint", type: "color" } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).filter((candidate) => candidate.field === "labels.tint");

        const formatter = column?.formatter;
        if (typeof formatter !== "function") throw new Error("expected a formatter of its own");
        const format = (value: unknown) =>
            formatter({ getValue: () => value } as CellComponent, {}, () => {}) as HTMLElement;

        // Filling the cell instead would paint over the row's own striping, hover and selection.
        const swatch = format("#ff2e88");
        expect(swatch.className).toBe("table-color-swatch");
        expect(swatch.style.backgroundColor).toBe("#ff2e88");
        expect(swatch.title).toBe("#ff2e88");

        // A cell holds whatever the label does: text naming no colour keeps the swatch, which the
        // browser leaves unpainted, and says what is stored where it can be read.
        expect(format("nonsense").title).toBe("nonsense");

        for (const empty of [ "", undefined, null ]) {
            expect(format(empty).className).toBe("");
        }
    });

    it("leaves a cell alone until a colour is picked, an opened picker being no decision", async () => {
        // A colour input has no empty value, so it shows black over an unset cell; committing that on
        // the way out would fill in a colour nobody chose.
        const { element, success } = await editColorCell("");
        expect(element.querySelector<HTMLInputElement>("input[type=hidden]")?.value).toBe("");
        expect(success).not.toHaveBeenCalled();
    });
});

describe("buildColumnDefinitions — select columns", () => {
    /** Resolves the params a column hands its editor, which Tabulator asks for as a function. */
    function editorParamsOf(column: ColumnDefinition | undefined) {
        const params = column?.editorParams;
        if (typeof params !== "function") throw new Error("expected the params to be a function");
        return params({} as CellComponent) as ValuesEditorParams;
    }

    function selectColumn(
        onCreateSelectOption?: (columnName: string, option: string) => void,
        currentSelectOptions?: (columnName: string) => string[] | undefined
    ) {
        const columns = buildColumnDefinitions({
            info: [ { name: "status", type: "select", options: [ "Todo", "Done" ] } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1,
            onCreateSelectOption,
            currentSelectOptions
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

    it("asks for the options as a cell is opened, so one just created is already among them", () => {
        // A cell can add an option to the definition, and the table does not rebuild its columns for
        // a change of its own — so a column built before that must not answer with what it was built
        // with, or the option would go missing until something else rebuilt the table.
        const currentSelectOptions = vi.fn(() => [ "Todo", "Done", "Blocked" ]);
        const params = editorParamsOf(selectColumn(undefined, currentSelectOptions));

        expect(params.options).toEqual([ "Todo", "Done", "Blocked" ]);
        expect(currentSelectOptions).toHaveBeenCalledWith("status");

        // Asked but unanswered — a column whose definition has since gone — falls back to its own.
        expect(editorParamsOf(selectColumn(undefined, () => undefined)).options).toEqual([ "Todo", "Done" ]);
    });

    it("leaves the editor no way to create where the caller offers none", () => {
        // Without it the field stays a plain picker rather than calling something undefined.
        expect(editorParamsOf(selectColumn()).onCreateOption).toBeUndefined();
    });
});

describe("buildColumnDefinitions — multi-valued columns", () => {
    function multiColumn(type: AttributeDefinitionInformation["type"]) {
        return buildColumnDefinitions({
            info: [ { name: "tags", type, isMulti: true } ],
            movableRows: false,
            existingColumnData: undefined,
            rowNumberHint: 1
        }).find((column) => column.field === "labels.tags");
    }

    it("edits and shows a set as chips whatever it holds, not only a set of options", () => {
        for (const type of [ "text", "date", "url", "select", "color", "boolean" ] as const) {
            const column = multiColumn(type);
            // The type's own single-value editor would show one of the values and store back one.
            expect(typeof column?.editor).toBe("function");
            expect(typeof column?.formatter).toBe("function");
            expect(column?.formatterParams).toEqual({ type });
            // The editor is told which kind of value it is gathering, since that decides the field.
            const params = column?.editorParams;
            if (typeof params !== "function") throw new Error("expected the params to be a function");
            expect((params({} as CellComponent) as ValuesEditorParams).labelType).toBe(type);
        }
    });

    /** Opens a multi-valued cell's editor, as Tabulator does, and puts it in the document. */
    async function editMultiCell(type: AttributeDefinitionInformation["type"], values: string[]) {
        const column = multiColumn(type);
        const editor = column?.editor;
        const params = column?.editorParams;
        if (typeof editor !== "function") throw new Error("expected an editor of its own");
        if (typeof params !== "function") throw new Error("expected the params to be a function");

        const success = vi.fn();
        let element: HTMLElement | false = false;
        await act(async () => {
            element = editor(
                { getValue: () => values } as CellComponent,
                () => {}, success, () => {}, params({} as CellComponent)
            );
        });
        if (!element) throw new Error("expected the editor to build a field");

        // Focus only means anything for an element the document holds.
        const built = element as HTMLElement;
        document.body.appendChild(built);
        return { element: built, success };
    }

    it("stays open where the focus leaves the page rather than the cell", async () => {
        const { element, success } = await editMultiCell("color", [ "#ff0000" ]);
        const picker = element.querySelector<HTMLInputElement>("input[type=color]");
        if (!picker) throw new Error("expected a colour picker");
        picker.focus();

        // A native picker's dialog takes the focus with nothing in the page gaining it. Ending the
        // edit here would take the editor down, and the dialog with it, before it reported a colour.
        picker.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        expect(success).not.toHaveBeenCalled();

        // Whereas the cell being left for good: nothing in the editor holds the focus any more.
        picker.blur();
        picker.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        expect(success).toHaveBeenCalledWith([ "#ff0000" ]);

        element.remove();
    });

    it("shows each value as its type reads it, rather than as the text it is stored as", () => {
        const format = (type: AttributeDefinitionInformation["type"], values: string[]) => {
            const formatter = multiColumn(type)?.formatter;
            if (typeof formatter !== "function") throw new Error("expected a formatter of its own");
            return formatter(
                { getValue: () => values } as CellComponent, { type }, () => {}
            ) as HTMLElement;
        };

        // A flag reads as the mark a column of single flags shows, not as the word "true".
        const flags = format("boolean", [ "true", "false" ]);
        expect([ ...flags.querySelectorAll(".tn-icon") ].map((mark) => mark.getAttribute("title")))
            .toEqual([ "true", "false" ]);
        expect(flags.querySelector(".table-flag-set")?.className).toContain("bx-check");
        expect(flags.querySelector(".table-flag-unset")?.className).toContain("bx-x");

        // And a colour as the same swatch a single one is shown by.
        expect(format("color", [ "#ff2e88" ]).querySelector(".table-color-swatch")?.getAttribute("title"))
            .toBe("#ff2e88");
    });

    it("links each url of a set, without making a hostile scheme clickable", () => {
        const formatter = multiColumn("url")?.formatter;
        if (typeof formatter !== "function") throw new Error("expected a formatter of its own");
        const cell = formatter(
            { getValue: () => [ "example.com", "javascript:alert(1)" ] } as CellComponent,
            { type: "url" }, () => {}
        ) as HTMLElement;

        expect([ ...cell.querySelectorAll("a") ].map((link) => link.getAttribute("href")))
            .toEqual([ "https://example.com", "about:blank" ]);
        // The value is still readable even where it is not one we may link to.
        expect(cell.textContent).toContain("javascript:alert(1)");
    });

    it("sorts by the values a cell holds, not by the array they arrive in", () => {
        const sorter = multiColumn("text")?.sorter;
        if (typeof sorter !== "function") throw new Error("expected a sorter of its own");

        const compare = (a: unknown, b: unknown) =>
            Math.sign((sorter as (a: unknown, b: unknown, ...rest: never[]) => number)(a, b));
        expect(compare([ "alpha", "beta" ], [ "alpha", "gamma" ])).toBe(-1);
        expect(compare([ "beta" ], [ "alpha", "beta" ])).toBe(1);
        expect(compare([ "alpha" ], [ "alpha" ])).toBe(0);
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
