import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A relation's target is picked in an Algolia autocomplete bound to jQuery, which is not loaded here.
vi.mock("./react/NoteAutocomplete", () => ({ default: () => null }));

// The chip fields have specs of their own; here they hand over their props, which is where the
// grid's behaviour lives — what the field is given, and what committing through it does.
const multiInput = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("./attribute_widgets/multi_value_input", () => ({
    default: (props: Record<string, unknown>) => {
        multiInput.current = props;
        return null;
    },
    BOOLEAN_OPTIONS: [ "true", "false" ]
}));
const relationInput = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));
vi.mock("./attribute_widgets/relation_values_input", () => ({
    default: (props: Record<string, unknown>) => {
        relationInput.current = props;
        return null;
    },
    RelationValueChips: () => null
}));

// The grid follows the note the tab shows; the tests hand it one directly. The context object is
// held stable: the grid rebuilds its cells when the context changes, told apart by identity.
const shownNote = vi.hoisted(() => ({ current: null as FNote | null }));
const noteContext = vi.hoisted(() => ({ viewScope: { viewMode: "default" } }));
vi.mock("./react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./react/hooks")>()),
    useNoteContext: () => ({
        note: shownNote.current,
        componentId: "cid",
        noteContext
    })
}));

import $ from "jquery";

import type Component from "../components/component";
import FAttribute from "../entities/fattribute";
import type FNote from "../entities/fnote";
import froca from "../services/froca";
import type LoadResults from "../services/load_results";
import noteAttributeCache from "../services/note_attribute_cache";
import server from "../services/server";
import { randomString } from "../services/utils";
import { buildNote } from "../test/easy-froca";
import { ParentComponent } from "./react/react_utils";
import PromotedAttributes, { buildPromotedCells, PromotedAttributesContent } from "./PromotedAttributes";

// A text field offers the values other notes hold under its name through the Algolia plugin, which
// is not loaded here; a stub that chains like jQuery does keeps the field's setup on its feet.
type PluggedIn = { autocomplete(...args: unknown[]): PluggedIn };
($.fn as unknown as PluggedIn).autocomplete = function (this: PluggedIn) { return this; };

describe("buildPromotedCells", () => {
    it("gathers a label allowing several values into one field, leaving a single-valued one its own", () => {
        const note = buildNote({
            title: "Task",
            "#label:tags": "promoted,multi,text",
            "#label:status": "promoted,single,text",
            "#tags": "alpha",
            "#status": "open"
        });
        hold(note, "label", "tags", "beta");

        const cells = buildPromotedCells(note);

        // One field per definition, in the order the definitions are declared.
        expect(cells.map((cell) => cell.valueName)).toEqual([ "tags", "status" ]);
        // The set as it will be shown: chips in the one field, not a field apiece.
        expect(cells[0].values).toEqual([ "alpha", "beta" ]);
        // A single value is still edited through the very attribute holding it, so that typing into
        // the field updates that attribute rather than rewriting everything under the name.
        expect(cells[1].values).toBeUndefined();
        expect(cells[1].valueAttr.value).toBe("open");
    });

    it("shows the values in the order the note holds them, whichever order they were loaded in", () => {
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text" });
        hold(note, "label", "tags", "second", 20);
        hold(note, "label", "tags", "first", 10);

        expect(buildPromotedCells(note)[0].values).toEqual([ "first", "second" ]);
    });

    it("offers an empty field where the note holds nothing under the name", () => {
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text" });

        const [ cell ] = buildPromotedCells(note);

        // A blank value among the chips would be a chip standing for nothing, whose remove button
        // would remove nothing; the field simply opens with none.
        expect(cell.values).toEqual([]);
        expect(cell.valueAttr).toMatchObject({ attributeId: "", type: "label", name: "tags" });
    });

    it("leaves a value stored empty out of the chips", () => {
        // A definition retyped from single to multi can leave one behind, as can an attribute created
        // and never filled in.
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text", "#tags": "" });
        hold(note, "label", "tags", "alpha");

        expect(buildPromotedCells(note)[0].values).toEqual([ "alpha" ]);
    });

    it("gathers a relation's targets into one field, as it gathers a label's values", () => {
        const note = buildNote({
            title: "Task",
            "#relation:related": "promoted,multi",
            "~related": "aaaaaaaaaaaa"
        });
        hold(note, "relation", "related", "bbbbbbbbbbbb");

        const cells = buildPromotedCells(note);

        expect(cells).toHaveLength(1);
        // The chips carry the targets' noteIds; naming the notes they point at is the field's affair.
        expect(cells[0].values).toEqual([ "aaaaaaaaaaaa", "bbbbbbbbbbbb" ]);
        expect(cells[0].valueAttr).toMatchObject({ attributeId: "", type: "relation", name: "related" });
    });

    it("gives a single-valued definition its empty field too, and keeps it to the one value", () => {
        const empty = buildNote({ title: "Task", "#label:status": "promoted,single,text" });
        expect(buildPromotedCells(empty)).toHaveLength(1);
        expect(buildPromotedCells(empty)[0].valueAttr).toMatchObject({ attributeId: "", value: "" });

        // Holding two under a single-valued name — a definition retyped from multi — shows the first.
        const twice = buildNote({ title: "Task", "#label:status": "promoted,single,text", "#status": "open" });
        hold(twice, "label", "status", "closed");
        const cells = buildPromotedCells(twice);
        expect(cells).toHaveLength(1);
        expect(cells[0].valueAttr.value).toBe("open");
    });
});

describe("PromotedAttributesContent", () => {
    let container: HTMLElement;
    let put: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        multiInput.current = null;
        relationInput.current = null;
        put = vi.fn(async () => ({}));
        server.put = put as unknown as typeof server.put;
        // The text fields ask for the values other notes hold under the name, to suggest them.
        server.get = (async () => []) as unknown as typeof server.get;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    /** The grid over cells of its own, holding them as the widget's hook does. */
    function Host({ note }: { note: FNote }) {
        const [ cells, setCells ] = useState<ReturnType<typeof buildPromotedCells> | undefined>(() => buildPromotedCells(note));
        return <PromotedAttributesContent note={note} componentId="cid" cells={cells} setCells={setCells} />;
    }

    function mount(note: FNote) {
        act(() => render(<Host note={note} />, container));
    }

    it("gives a single-valued label its own field, edited through the attribute holding the value", () => {
        const note = buildNote({
            title: "Task",
            "#label:status": "promoted,single,text",
            "#status": "open"
        });
        mount(note);

        const input = container.querySelector<HTMLInputElement>(".promoted-attribute-input");
        expect(input?.value).toBe("open");
        expect(input?.dataset.attributeName).toBe("status");
    });

    it("writes a multi label's set back by name, and patches the field it shows in place", async () => {
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text", "#tags": "alpha" });
        mount(note);

        expect(multiInput.current).toMatchObject({ labelType: "text", values: [ "alpha" ] });

        await act(async () => (multiInput.current?.onCommit as (values: string[]) => Promise<void>)([ "alpha", "beta" ]));

        // Only what the set gained is written — the attribute already there is left as it stands.
        expect(put).toHaveBeenCalledOnce();
        expect(put).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: undefined, type: "label", name: "tags", value: "beta" },
            "cid"
        );
        // The grid ignores reloads of its own making, so the field is patched by hand.
        expect(multiInput.current?.values).toEqual([ "alpha", "beta" ]);
    });

    it("adds a select option to the definition itself, the field offering it from then on", async () => {
        const note = buildNote({ title: "Task", "#label:status": "promoted,multi,select,options=Todo;Done" });
        mount(note);

        expect(multiInput.current?.options).toEqual([ "Todo", "Done" ]);

        await act(async () => (multiInput.current?.onCreateOption as (option: string) => Promise<void>)("Blocked"));

        // Written back to the very attribute declaring the field, options and the rest of it intact.
        expect(put).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            expect.objectContaining({ name: "label:status", value: expect.stringContaining("Blocked") }),
            "cid"
        );
        expect(multiInput.current?.options).toEqual([ "Todo", "Done", "Blocked" ]);
    });

    it("writes a multi relation's targets by name, as it writes a label's values", async () => {
        const target = buildNote({ title: "Alpha" });
        const other = buildNote({ title: "Beta" });
        const note = buildNote({ title: "Task", "#relation:crew": "promoted,multi", "~crew": target.noteId });
        mount(note);

        expect(relationInput.current?.values).toEqual([ target.noteId ]);

        await act(async () => (relationInput.current?.onCommit as (values: string[]) => Promise<void>)([ target.noteId, other.noteId ]));

        expect(put).toHaveBeenCalledWith(
            `notes/${note.noteId}/attribute`,
            { attributeId: undefined, type: "relation", name: "crew", value: other.noteId },
            "cid"
        );
        expect(relationInput.current?.values).toEqual([ target.noteId, other.noteId ]);
    });
});

describe("PromotedAttributes", () => {
    let container: HTMLElement;
    /** What the widget subscribed to, for handing it a reload as the real component tree would. */
    let handlers: Map<string, (data: unknown) => void>;

    beforeEach(() => {
        vi.clearAllMocks();
        multiInput.current = null;
        server.get = (async () => []) as unknown as typeof server.get;
        handlers = new Map();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    function mount(note: FNote) {
        shownNote.current = note;
        const parent = {
            componentId: "cid",
            registerHandler: (name: string, callback: (data: unknown) => void) => handlers.set(name, callback),
            removeHandler: () => {}
        } as unknown as Component;
        act(() => render(
            <ParentComponent.Provider value={parent}>
                <PromotedAttributes />
            </ParentComponent.Provider>,
            container
        ));
    }

    it("builds the fields the note's definitions ask for, and rebuilds on a change made elsewhere", () => {
        const note = buildNote({ title: "Task", "#label:tags": "promoted,multi,text", "#tags": "alpha" });
        mount(note);

        expect(container.querySelectorAll(".promoted-attribute-cell")).toHaveLength(1);
        expect(multiInput.current?.values).toEqual([ "alpha" ]);

        // Another client fills a value in: the reload reaches the grid, which rereads the note.
        hold(note, "label", "tags", "beta");
        const loadResults = {
            getAttributeRows: () => [ {
                noteId: note.noteId, type: "label", name: "tags", value: "beta", isInheritable: false
            } ]
        } as unknown as LoadResults;
        act(() => handlers.get("entitiesReloaded")?.({ loadResults }));

        expect(multiInput.current?.values).toEqual([ "alpha", "beta" ]);
    });

    it("keeps the grid empty for a table view, whose cells already edit the same fields", () => {
        const note = buildNote({
            title: "Grid", "#viewType": "table",
            "#label:tags": "promoted,multi,text", "#tags": "alpha"
        });
        mount(note);

        expect(container.querySelectorAll(".promoted-attribute-cell")).toHaveLength(0);
    });
});

/** Gives the note another attribute under a name it already carries, which one literal cannot. */
function hold(note: FNote, type: "label" | "relation", name: string, value: string, position = 100) {
    const attributeId = randomString(12);
    const attribute = new FAttribute(froca, {
        noteId: note.noteId,
        attributeId,
        type,
        name,
        value,
        position,
        isInheritable: false
    });

    froca.attributes[attributeId] = attribute;
    note.attributes.push(attributeId);
    noteAttributeCache.attributes[note.noteId]?.push(attribute);
}
