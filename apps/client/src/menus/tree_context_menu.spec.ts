import { describe, expect, it } from "vitest";

import { buildNote } from "../test/easy-froca";
import { getDuplicateItems } from "./tree_context_menu";

describe("getDuplicateItems", () => {
    it("offers the note-only copy as soon as one of the notes has children", () => {
        const leaf = buildNote({ title: "Leaf" });
        const parent = buildNote({ title: "Parent", children: [ { title: "Child" } ] });

        expect(getDuplicateItems([ leaf ])).toBeNull();

        const items = getDuplicateItems([ leaf, parent ]);
        expect(items?.map((item) => "command" in item && item.command))
            .toStrictEqual([ "duplicateSubtree", "duplicateNote" ]);
    });
});
