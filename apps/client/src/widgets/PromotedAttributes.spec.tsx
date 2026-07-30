import { describe, expect, it, vi } from "vitest";

// A relation's target is picked in an Algolia autocomplete bound to jQuery, which is not loaded here.
vi.mock("./react/NoteAutocomplete", () => ({ default: () => null }));

import FAttribute from "../entities/fattribute";
import type FNote from "../entities/fnote";
import froca from "../services/froca";
import noteAttributeCache from "../services/note_attribute_cache";
import { randomString } from "../services/utils";
import { buildNote } from "../test/easy-froca";
import { buildPromotedCells } from "./PromotedAttributes";

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
