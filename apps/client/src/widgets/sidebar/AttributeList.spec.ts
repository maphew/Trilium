import { describe, expect, it } from "vitest";

import FAttribute, { FAttributeRow } from "../../entities/fattribute";
import type { Attribute } from "../../services/attribute_parser";
import froca from "../../services/froca";
import { getAttributeKind, getDisplayName, listInherited, listOwned, splitIntoSections } from "./AttributeList";

describe("listOwned", () => {
    it("orders by position and leaves out the attributes Trilium maintains itself", () => {
        const rows = listOwned([
            attribute({ name: "second", position: 20 }),
            attribute({ type: "relation", name: "internalLink", value: "target", position: 30 }),
            attribute({ name: "first", position: 10, value: "red", isInheritable: true })
        ]);

        expect(rows.map((row) => row.name)).toEqual([ "first", "second" ]);
        expect(rows[0]).toMatchObject({
            type: "label", name: "first", value: "red", isInheritable: true
        });
    });
});

describe("listInherited", () => {
    it("keeps only what comes from other notes, grouped by the note it comes from", () => {
        const rows = listInherited([
            attribute({ noteId: "bbb", name: "fromB2", position: 20 }),
            attribute({ noteId: "own", name: "ownLabel" }),
            attribute({ noteId: "aaa", name: "fromA" }),
            attribute({ noteId: "bbb", name: "fromB1", position: 10 })
        ], "own");

        expect(rows.map((row) => row.name)).toEqual([ "fromA", "fromB1", "fromB2" ]);
        expect(rows.map((row) => row.noteId)).toEqual([ "aaa", "bbb", "bbb" ]);
    });
});

describe("splitIntoSections", () => {
    it("sets the definitions of either aside, the note's own first, and splits the rest by ownership", () => {
        const sections = splitIntoSections(
            [ plain("cssClass"), plain("label:priority"), plain("relation:owner") ],
            [ plain("archived", "parent"), plain("label:status", "template") ]
        );

        expect(sections.owned.map((entry) => entry.attribute.name)).toEqual([ "cssClass" ]);
        expect(sections.inherited.map((entry) => entry.attribute.name)).toEqual([ "archived" ]);
        expect(sections.definitions.map((entry) => entry.attribute.name))
            .toEqual([ "label:priority", "relation:owner", "label:status" ]);
        // Which of the definitions the note may edit is the row's to know, the card holding both.
        expect(sections.definitions.map((entry) => entry.isOwned)).toEqual([ true, true, false ]);
    });
});

describe("getAttributeKind / getDisplayName", () => {
    it("tells a definition from what it defines, and shows it without its prefix", () => {
        const cases: [ FAttributeRow["type"], string, string, string ][] = [
            // type, name, expected kind, expected displayed name
            [ "label", "color", "label", "color" ],
            [ "relation", "template", "relation", "template" ],
            [ "label", "label:color", "label-definition", "color" ],
            [ "label", "relation:author", "relation-definition", "author" ],
            // A bare prefix defines nothing, so it stays an ordinary label — name and all.
            [ "label", "label:", "label", "label:" ]
        ];

        for (const [ type, name, expectedKind, expectedName ] of cases) {
            const attrType = getAttributeKind({ type, name });
            expect(attrType, name).toBe(expectedKind);
            expect(getDisplayName({ type, name }, attrType), name).toBe(expectedName);
        }
    });
});

function plain(name: string, noteId = "own"): Attribute {
    return { type: "label", name, noteId, value: "", isInheritable: false };
}

function attribute(row: Partial<FAttributeRow>) {
    return new FAttribute(froca, {
        attributeId: `attr-${row.name ?? "x"}`,
        noteId: "own",
        type: "label",
        name: "label",
        value: "",
        position: 10,
        isInheritable: false,
        ...row
    });
}
