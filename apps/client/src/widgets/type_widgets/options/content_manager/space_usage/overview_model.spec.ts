import type { SpaceUsageOverviewNote, SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import type { TreemapItem } from "../../../../react/charts/Treemap";
import { buildOverviewModel, hueOf, type OverviewCell } from "./overview_model";

function entry(noteId: string, notePath: string[], sizes: Partial<SpaceUsageOverviewNote> = {}): SpaceUsageOverviewNote {
    return { noteId, notePath, ownSize: 0, attachmentsSize: 0, revisionsSize: 0, ...sizes };
}

function response(notes: SpaceUsageOverviewNote[], overrides: Partial<SpaceUsageOverviewResponse> = {}): SpaceUsageOverviewResponse {
    return {
        contentSize: 0,
        notes,
        otherNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
        hiddenNotes: { size: 0, revisionsSize: 0, noteCount: 0 },
        deletedNotes: { size: 0, noteCount: 0 },
        total: { size: 0, revisionsSize: 0, noteCount: 0 },
        ...overrides
    };
}

function build(overview: SpaceUsageOverviewResponse, includeRevisions = false) {
    return buildOverviewModel(overview, {
        otherNotesLabel: "Other notes",
        deletedNotesLabel: "Deleted notes",
        includeRevisions
    });
}

function childById(parent: TreemapItem<OverviewCell>, id: string) {
    const child = (parent.children ?? []).find((candidate) => candidate.id === id);
    if (!child) throw new Error(`No child '${id}' under '${parent.id}'`);
    return child;
}

describe("buildOverviewModel", () => {
    it("nests entries at their tree location; ancestors shape the layout but carry nothing", () => {
        const model = build(response([
            entry("leaf", [ "folder", "leaf" ], { ownSize: 100, attachmentsSize: 20 })
        ]));

        const folder = childById(model, "folder");
        expect(folder.value).toBeUndefined();
        expect(folder.attributes).toBeUndefined();
        expect(folder.data).toBeUndefined();

        const leaf = childById(folder, "leaf");
        expect(leaf.value).toBe(120);
        expect(leaf.data).toEqual({ noteId: "leaf" });
        expect(leaf.attributes).toEqual({ "data-href": "#root/folder/leaf" });
    });

    it("colors cells by their parent: siblings share a hue, other groups get their own", () => {
        const model = build(response([
            entry("a1", [ "parentA", "a1" ], { ownSize: 1 }),
            entry("a2", [ "parentA", "a2" ], { ownSize: 1 }),
            entry("b1", [ "parentB", "b1" ], { ownSize: 1 }),
            entry("top", [ "top" ], { ownSize: 1 })
        ]));

        const parentA = childById(model, "parentA");
        expect(childById(parentA, "a1").hue).toBe(hueOf("parentA"));
        expect(childById(parentA, "a2").hue).toBe(hueOf("parentA"));
        expect(childById(childById(model, "parentB"), "b1").hue).toBe(hueOf("parentB"));
        expect(childById(model, "top").hue).toBe(hueOf("root"));
    });

    it("gives an entry that is also an ancestor a nested self-cell wearing its children's hue", () => {
        const model = build(response([
            entry("parent", [ "parent" ], { ownSize: 50 }),
            entry("child", [ "parent", "child" ], { ownSize: 10 })
        ]));

        const parent = childById(model, "parent");
        expect(parent.value).toBeUndefined();

        const selfCell = childById(parent, "parent/own");
        expect(selfCell.value).toBe(50);
        expect(selfCell.hue).toBe(hueOf("parent"));
        expect(selfCell.data).toEqual({ noteId: "parent" });
        expect(selfCell.attributes).toEqual({ "data-href": "#root/parent" });
        expect(childById(parent, "child").value).toBe(10);
    });

    it("counts revisions into the weights only when asked to", () => {
        const notes = [ entry("a", [ "a" ], { ownSize: 5, revisionsSize: 7 }) ];
        const buckets = { otherNotes: { size: 30, revisionsSize: 4, noteCount: 9 } };

        const without = build(response(notes, buckets));
        expect(childById(without, "a").value).toBe(5);
        expect(childById(without, "/other-notes").value).toBe(30);

        const withRevisions = build(response(notes, buckets), true);
        expect(childById(withRevisions, "a").value).toBe(12);
        expect(childById(withRevisions, "/other-notes").value).toBe(34);
    });

    it("appends inert bucket cells, identified by a plain title rather than a note tooltip", () => {
        const model = build(response([], {
            otherNotes: { size: 11, revisionsSize: 0, noteCount: 3 },
            deletedNotes: { size: 22, noteCount: 2 }
        }));

        const other = childById(model, "/other-notes");
        expect(other.value).toBe(11);
        expect(other.hue).toBeUndefined();
        expect(other.data).toEqual({});
        expect(other.attributes).toEqual({ title: "Other notes" });

        const deleted = childById(model, "/deleted-notes");
        expect(deleted.value).toBe(22);
        expect(deleted.className).toBe("treemap-cell-deleted");
        expect(deleted.attributes).toEqual({ title: "Deleted notes" });
    });

    it("places an entry for the root itself as a top-level cell", () => {
        const model = build(response([ entry("root", [], { ownSize: 9 }) ]));

        expect(childById(model, "root").value).toBe(9);
    });

    it("leaves a zero-weight entry as an empty cell rather than a zero-sized one", () => {
        const model = build(response([ entry("empty", [ "empty" ]) ]));

        const empty = childById(model, "empty");
        expect(empty.value).toBeUndefined();
        expect(empty.attributes).toBeUndefined();
    });
});

describe("hueOf", () => {
    it("is stable and stays within the hue circle", () => {
        expect(hueOf("someNoteId")).toBe(hueOf("someNoteId"));
        for (const id of [ "", "root", "a", "0123456789abcdef" ]) {
            expect(hueOf(id)).toBeGreaterThanOrEqual(0);
            expect(hueOf(id)).toBeLessThan(360);
        }
    });
});
