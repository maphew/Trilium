import { DefinitionObject } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The relation cell renders a jQuery-autocomplete-backed widget that does not work under
// happy-dom; stub it down to a plain input so the surrounding cell structure stays assertable.
vi.mock("./react/NoteAutocomplete", () => ({
    default: ({ id, noteId }: { id?: string; noteId?: string }) =>
        <input id={id} className="note-autocomplete-stub" value={noteId} />
}));

// `vi.mock` factories are hoisted above these declarations, so the mocks themselves must be
// created via `vi.hoisted` to exist by the time the factories run.
const { serverGetMock, serverPutMock, serverRemoveMock, logErrorMock } = vi.hoisted(() => ({
    // The text-label autocomplete effect calls out to the server for suggestion values.
    serverGetMock: vi.fn(async () => [] as string[]),
    serverPutMock: vi.fn(async () => ({ attributeId: "newAttributeId" })),
    serverRemoveMock: vi.fn(async () => undefined),
    logErrorMock: vi.fn()
}));

vi.mock("../services/server", () => ({
    default: {
        get: (...args: unknown[]) => serverGetMock(...(args as [])),
        put: (...args: unknown[]) => serverPutMock(...(args as [])),
        remove: (...args: unknown[]) => serverRemoveMock(...(args as []))
    }
}));

// Keep the global setup.ts websocket mock (subscribeToMessages et al.) and only add logError,
// which the unknown-attribute-type branch reports through.
vi.mock("../services/ws", async (importOriginal) => {
    const original = await importOriginal<{ default: object }>();
    return {
        ...original,
        default: { ...original.default, logError: (...args: unknown[]) => logErrorMock(...args) }
    };
});

import $ from "jquery";

import FAttribute from "../entities/fattribute";
import FNote from "../entities/fnote";
import froca from "../services/froca";
import noteAttributeCache from "../services/note_attribute_cache";
import { randomString } from "../services/utils";
import { buildNote } from "../test/easy-froca";
import { renderInto } from "../test/render";
import { PromotedAttributesContent, usePromotedAttributeData } from "./PromotedAttributes";

interface CellLike {
    uniqueId: string;
    definitionAttr: FAttribute;
    definition: DefinitionObject;
    valueAttr: { attributeId: string; type: string; name: string; value: string; noteId?: string };
    valueName: string;
}

/** Builds a definition attribute + matching value cell, mirroring what `usePromotedAttributeData` produces. */
function buildCell(note: FNote, {
    name = "myLabel",
    type = "label",
    value = "",
    definition = {},
    attributeId = "valueAttrId",
    uniqueId = "cell-1"
}: {
    name?: string;
    type?: "label" | "relation";
    value?: string;
    definition?: DefinitionObject;
    attributeId?: string;
    uniqueId?: string;
} = {}): CellLike {
    const definitionAttr = new FAttribute(froca, {
        noteId: note.noteId,
        attributeId: `${uniqueId}-def`,
        type: "label",
        name: `${type}:${name}`,
        value: "promoted",
        position: 10,
        isInheritable: false
    });
    // `definition` drives every render branch, so inject it directly rather than round-tripping
    // through the definition-string parser.
    definitionAttr.getDefinition = () => ({ isPromoted: true, ...definition });

    return {
        uniqueId,
        definitionAttr,
        definition: { isPromoted: true, ...definition },
        valueAttr: { attributeId, type, name, value, noteId: note.noteId },
        valueName: name
    };
}

async function renderCells(note: FNote, cells: CellLike[], setCells = vi.fn()) {
    let container: HTMLElement | undefined;
    await act(async () => {
        container = renderInto(
            <PromotedAttributesContent
                note={note}
                componentId="test-component"
                cells={cells as never}
                setCells={setCells}
            />);
        // Let the text-autocomplete server fetch settle.
        await new Promise((resolve) => setTimeout(resolve, 0));
    });
    if (!container) throw new Error("render produced no container");
    return container;
}

describe("PromotedAttributesContent", () => {
    let note: FNote;

    beforeAll(() => {
        // The text-label suggestion effect initialises the jQuery autocomplete plugin, which is
        // not loaded in the unit-test environment. Stub it so the effect can run to completion.
        ($.fn as unknown as { autocomplete: unknown }).autocomplete = function () { return this; };
    });

    beforeEach(() => {
        vi.clearAllMocks();
        serverGetMock.mockResolvedValue([]);
        serverPutMock.mockResolvedValue({ attributeId: "newAttributeId" });
        note = buildNote({ title: "Host note" });
    });

    it("renders no container when there are no cells", async () => {
        const emptyContainer = await renderCells(note, []);
        expect(emptyContainer.querySelector(".promoted-attributes-widget")).not.toBeNull();
        expect(emptyContainer.querySelector(".promoted-attributes-container")).toBeNull();

        // `undefined` (not yet loaded) behaves the same way.
        const pendingContainer = await renderCells(note, undefined as never);
        expect(pendingContainer.querySelector(".promoted-attributes-container")).toBeNull();
    });

    it("renders one cell per entry, with a label bound to the input", async () => {
        const container = await renderCells(note, [
            buildCell(note, { name: "first", uniqueId: "a" }),
            buildCell(note, { name: "second", uniqueId: "b" })
        ]);

        const cells = container.querySelectorAll(".promoted-attribute-cell");
        expect(cells).toHaveLength(2);

        const label = container.querySelector("label");
        const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
        expect(label?.textContent).toBe("first");
        expect(label?.getAttribute("for")).toBe(input?.id);
        expect(input?.id).toBeTruthy();
    });

    it("prefers the promoted alias over the raw attribute name", async () => {
        const container = await renderCells(note, [
            buildCell(note, { name: "rawName", definition: { promotedAlias: "Friendly name" } })
        ]);

        expect(container.querySelector("label")?.textContent).toBe("Friendly name");
    });

    it("maps each label type onto the matching input type", async () => {
        const cases: Array<[DefinitionObject["labelType"], string]> = [
            ["text", "text"],
            ["number", "number"],
            ["boolean", "checkbox"],
            ["date", "date"],
            ["datetime", "datetime-local"],
            ["time", "time"],
            ["url", "url"]
        ];

        for (const [labelType, expectedInputType] of cases) {
            const container = await renderCells(note, [
                buildCell(note, { definition: { labelType }, uniqueId: `cell-${labelType}` })
            ]);
            const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
            expect(input?.getAttribute("type"), `labelType=${labelType}`).toBe(expectedInputType);
            expect(container.querySelector(".promoted-attribute-cell")?.className)
                .toContain(`promoted-attribute-label-${labelType}`);
        }
    });

    it("renders a textarea instead of an input for the textarea label type", async () => {
        const container = await renderCells(note, [
            buildCell(note, { definition: { labelType: "textarea" }, value: "long text" })
        ]);

        const textarea = container.querySelector<HTMLTextAreaElement>("textarea.promoted-attribute-input");
        expect(textarea).not.toBeNull();
        expect(container.querySelector("input.promoted-attribute-input")).toBeNull();
        expect(textarea?.value).toBe("long text");
    });

    it("derives the number step from the configured precision", async () => {
        const twoDecimals = await renderCells(note, [
            buildCell(note, { definition: { labelType: "number", numberPrecision: 2 } })
        ]);
        expect(twoDecimals.querySelector("input.promoted-attribute-input")?.getAttribute("step")).toBe("0.01");

        const noPrecision = await renderCells(note, [
            buildCell(note, { definition: { labelType: "number" }, uniqueId: "no-precision" })
        ]);
        expect(noPrecision.querySelector("input.promoted-attribute-input")?.getAttribute("step")).toBe("1");
    });

    it("moves the label after the checkbox for boolean attributes and reflects the checked state", async () => {
        const container = await renderCells(note, [
            buildCell(note, { definition: { labelType: "boolean" }, value: "true" })
        ]);

        const checkbox = container.querySelector<HTMLInputElement>("input[type=checkbox]");
        expect(checkbox?.checked).toBe(true);
        // The boolean branch wraps the input in a `.tn-checkbox` label rather than preceding it.
        expect(container.querySelector("label.tn-checkbox")).not.toBeNull();

        const unchecked = await renderCells(note, [
            buildCell(note, { definition: { labelType: "boolean" }, value: "false", uniqueId: "unchecked" })
        ]);
        expect(unchecked.querySelector<HTMLInputElement>("input[type=checkbox]")?.checked).toBe(false);
    });

    it("renders the colour picker alongside a colour attribute", async () => {
        const container = await renderCells(note, [
            buildCell(note, { definition: { labelType: "color" }, value: "#123456" })
        ]);

        expect(container.querySelector(".note-color-picker")).not.toBeNull();
        // The raw input is kept but hidden, the picker drives the value.
        expect(container.querySelector("input.promoted-attribute-input")?.getAttribute("type")).toBe("hidden");
    });

    it("renders an open-link button for url attributes and opens the current value", async () => {
        const container = await renderCells(note, [
            buildCell(note, { definition: { labelType: "url" }, value: "https://example.com" })
        ]);

        const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
        expect(input?.getAttribute("type")).toBe("url");

        const openButton = container.querySelector<HTMLElement>(".open-external-link-button");
        expect(openButton).not.toBeNull();

        const windowOpen = vi.spyOn(window, "open").mockImplementation(() => null);
        openButton?.click();
        expect(windowOpen).toHaveBeenCalledWith("https://example.com", "_blank");

        // An empty value must not open a blank tab.
        windowOpen.mockClear();
        if (input) input.value = "";
        openButton?.click();
        expect(windowOpen).not.toHaveBeenCalled();
        windowOpen.mockRestore();
    });

    it("renders the note autocomplete for relation attributes", async () => {
        const container = await renderCells(note, [
            buildCell(note, { type: "relation", value: "targetNoteId" })
        ]);

        expect(container.querySelector(".promoted-attribute-cell")?.className)
            .toContain("promoted-attribute-relation");
        expect(container.querySelector<HTMLInputElement>(".note-autocomplete-stub")?.value).toBe("targetNoteId");
    });

    it("logs an error for an unknown attribute type and renders no input", async () => {
        const container = await renderCells(note, [
            buildCell(note, { type: "bogus" as never })
        ]);

        expect(logErrorMock).toHaveBeenCalledOnce();
        expect(container.querySelector(".promoted-attribute-input")).toBeNull();
    });

    it("shows the multiplicity add/remove buttons only for multi-valued attributes", async () => {
        const single = await renderCells(note, [
            buildCell(note, { definition: { multiplicity: "single" } })
        ]);
        expect(single.querySelector(".multiplicity")).toBeNull();

        const multi = await renderCells(note, [
            buildCell(note, { definition: { multiplicity: "multi" }, uniqueId: "multi" })
        ]);
        expect(multi.querySelectorAll(".multiplicity .tn-tool-button")).toHaveLength(2);
    });

    it("inserts a new empty cell after the current one when adding", async () => {
        const setCells = vi.fn();
        const cell = buildCell(note, { definition: { multiplicity: "multi" }, value: "existing" });
        const container = await renderCells(note, [cell], setCells);

        const addButton = container.querySelector<HTMLElement>(".multiplicity .bx-plus");
        await act(async () => { addButton?.click(); });

        expect(setCells).toHaveBeenCalledOnce();
        const inserted = setCells.mock.calls[0][0] as CellLike[];
        expect(inserted).toHaveLength(2);
        // Same definition and name, but a fresh identity and a blank value.
        expect(inserted[1].valueName).toBe(cell.valueName);
        expect(inserted[1].valueAttr.value).toBe("");
        expect(inserted[1].valueAttr.attributeId).toBe("");
        expect(inserted[1].uniqueId).not.toBe(cell.uniqueId);
    });

    it("deletes the attribute server-side and leaves a blank cell when removing the last value", async () => {
        const setCells = vi.fn();
        const cell = buildCell(note, {
            definition: { multiplicity: "multi" },
            value: "gone",
            attributeId: "existingAttrId"
        });
        const container = await renderCells(note, [cell], setCells);

        const removeButton = container.querySelector<HTMLElement>(".multiplicity .bx-trash");
        await act(async () => { removeButton?.click(); });

        expect(serverRemoveMock).toHaveBeenCalledWith(
            `notes/${note.noteId}/attributes/existingAttrId`, "test-component");
        // It was the only cell of its type, so an empty replacement keeps the field visible.
        const remaining = setCells.mock.calls[0][0] as CellLike[];
        expect(remaining).toHaveLength(1);
        expect(remaining[0].valueAttr.value).toBe("");
        expect(remaining[0].valueAttr.attributeId).toBe("");
    });

    it("removes the cell outright when other values of the same attribute remain", async () => {
        const setCells = vi.fn();
        const first = buildCell(note, {
            definition: { multiplicity: "multi" }, value: "one", attributeId: "attr1", uniqueId: "one"
        });
        const second = buildCell(note, {
            definition: { multiplicity: "multi" }, value: "two", attributeId: "attr2", uniqueId: "two"
        });
        const container = await renderCells(note, [first, second], setCells);

        const removeButtons = container.querySelectorAll<HTMLElement>(".multiplicity .bx-trash");
        await act(async () => { removeButtons[0]?.click(); });

        const remaining = setCells.mock.calls[0][0] as CellLike[];
        expect(remaining).toHaveLength(1);
        expect(remaining[0].valueAttr.value).toBe("two");
    });

    it("does not call the server when removing a cell that was never persisted", async () => {
        const setCells = vi.fn();
        const container = await renderCells(note, [
            buildCell(note, { definition: { multiplicity: "multi" }, attributeId: "" })
        ], setCells);

        await act(async () => { container.querySelector<HTMLElement>(".multiplicity .bx-trash")?.click(); });

        expect(serverRemoveMock).not.toHaveBeenCalled();
        expect(setCells).toHaveBeenCalledOnce();
    });

    it("persists a changed value on blur and writes back the returned attribute id", async () => {
        const setCells = vi.fn();
        const container = await renderCells(note, [
            buildCell(note, { name: "myLabel", value: "before", attributeId: "" })
        ], setCells);

        const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
        expect(input).not.toBeNull();
        if (!input) return;

        await act(async () => {
            input.value = "after";
            // Preact delegates blur to focusout.
            input.dispatchEvent(new Event("focusout", { bubbles: true }));
        });

        expect(serverPutMock).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: "", type: "label", name: "myLabel", value: "after" },
            "test-component"
        );

        // The state updater merges the server-assigned id into the matching cell.
        const updater = setCells.mock.calls[0][0] as (prev: CellLike[]) => CellLike[];
        const updated = updater([buildCell(note, { name: "myLabel", uniqueId: "cell-1" })]);
        expect(updated[0].valueAttr.attributeId).toBe("newAttributeId");
        expect(updated[0].valueAttr.value).toBe("after");
    });

    it("skips the server round-trip when the value did not change", async () => {
        const container = await renderCells(note, [
            buildCell(note, { value: "unchanged" })
        ]);

        const input = container.querySelector<HTMLInputElement>("input.promoted-attribute-input");
        if (!input) return;
        await act(async () => {
            input.dispatchEvent(new Event("focusout", { bubbles: true }));
        });

        expect(serverPutMock).not.toHaveBeenCalled();
    });

    it("sends the checkbox state rather than its value for boolean attributes", async () => {
        const container = await renderCells(note, [
            buildCell(note, { name: "flag", definition: { labelType: "boolean" }, value: "false" })
        ]);

        const checkbox = container.querySelector<HTMLInputElement>("input[type=checkbox]");
        if (!checkbox) return;
        await act(async () => {
            checkbox.checked = true;
            checkbox.dispatchEvent(new Event("focusout", { bubbles: true }));
        });

        expect(serverPutMock).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            expect.objectContaining({ name: "flag", value: "true" }),
            "test-component"
        );
    });

    it("fetches suggestion values only for text attributes", async () => {
        await renderCells(note, [buildCell(note, { name: "tags", definition: { labelType: "text" } })]);
        expect(serverGetMock).toHaveBeenCalledWith("attribute-values/tags");

        serverGetMock.mockClear();
        await renderCells(note, [buildCell(note, { definition: { labelType: "number" }, uniqueId: "num" })]);
        expect(serverGetMock).not.toHaveBeenCalled();
    });
});

describe("usePromotedAttributeData", () => {
    /** Runs the hook against a real note and returns the cells it derived. */
    async function collectCells(note: FNote | null | undefined, noteContext: unknown = defaultNoteContext()) {
        let cells: CellLike[] | undefined;

        function Probe() {
            const [ derived ] = usePromotedAttributeData(note, "test-component", noteContext as never);
            cells = derived as CellLike[] | undefined;
            return null;
        }

        await act(async () => {
            renderInto(<Probe />);
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        return cells;
    }

    function defaultNoteContext() {
        return { viewScope: { viewMode: "default" } };
    }

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("returns no cells without a note, outside the default view mode, or for table views", async () => {
        expect(await collectCells(null)).toEqual([]);

        const note = buildNote({ title: "Plain", "#label:foo": "promoted" });
        expect(await collectCells(note, { viewScope: { viewMode: "attachments" } })).toEqual([]);

        const tableNote = buildNote({ title: "Table", "#label:foo": "promoted", "#viewType": "table" });
        expect(await collectCells(tableNote)).toEqual([]);
    });

    it("builds a cell per promoted definition, ignoring non-promoted ones", async () => {
        const note = buildNote({
            title: "Definitions",
            "#label:promotedOne": "promoted,text",
            "#label:notPromoted": "text",
            "#promotedOne": "a value"
        });

        const cells = await collectCells(note);

        expect(cells).toHaveLength(1);
        expect(cells?.[0].valueName).toBe("promotedOne");
        expect(cells?.[0].valueAttr.value).toBe("a value");
        expect(cells?.[0].definition.labelType).toBe("text");
        expect(cells?.[0].uniqueId).toBeTruthy();
    });

    it("synthesises an empty cell when a promoted definition has no value yet", async () => {
        const note = buildNote({ title: "No value", "#label:empty": "promoted,text" });

        const cells = await collectCells(note);

        expect(cells).toHaveLength(1);
        expect(cells?.[0].valueAttr.value).toBe("");
        // A blank attribute id marks it as not yet persisted.
        expect(cells?.[0].valueAttr.attributeId).toBe("");
    });

    it("keeps every value for multi multiplicity but only the first for single", async () => {
        const multiNote = buildNote({ title: "Multi", "#label:tag": "promoted,multi,text", "#tag": "first" });
        addLabel(multiNote, "tag", "second");
        const multiCells = await collectCells(multiNote);
        expect(multiCells?.map((cell) => cell.valueAttr.value)).toEqual(["first", "second"]);

        const singleNote = buildNote({ title: "Single", "#label:tag": "promoted,single,text", "#tag": "first" });
        addLabel(singleNote, "tag", "second");
        const singleCells = await collectCells(singleNote);
        expect(singleCells?.map((cell) => cell.valueAttr.value)).toEqual(["first"]);
    });

    it("builds relation cells from relation definitions", async () => {
        const target = buildNote({ title: "Target" });
        const note = buildNote({
            title: "With relation",
            "#relation:link": "promoted",
            "~link": target.noteId
        });

        const cells = await collectCells(note);

        expect(cells).toHaveLength(1);
        expect(cells?.[0].valueAttr.type).toBe("relation");
        expect(cells?.[0].valueAttr.value).toBe(target.noteId);
    });

    it("returns no cells when promoted attributes are hidden", async () => {
        const note = buildNote({
            title: "Hidden",
            "#label:foo": "promoted,text",
            "#hidePromotedAttributes": "true"
        });

        expect(await collectCells(note)).toEqual([]);
    });
});

/** Adds an extra label to an existing note (buildNote's literal API allows one value per key). */
function addLabel(note: FNote, name: string, value: string) {
    const attributeId = randomString(12);
    const attribute = new FAttribute(froca, {
        noteId: note.noteId,
        attributeId,
        type: "label",
        name,
        value,
        position: note.attributes.length,
        isInheritable: false
    });
    froca.attributes[attributeId] = attribute;
    note.attributes.push(attributeId);
    (noteAttributeCache.attributes[note.noteId] ??= []).push(attribute);
}
