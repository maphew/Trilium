import { describe, expect, it } from "vitest";

import { dropUnlinkedNotes } from "./data";

describe("dropUnlinkedNotes", () => {
    const nodes = [ { id: "root" }, { id: "source" }, { id: "target" }, { id: "loose" } ];
    const links = [ { id: "source-target", sourceNoteId: "source", targetNoteId: "target", names: [ "relates" ] } ];

    it("keeps the notes a relation touches along with the map root, and drops the rest", () => {
        expect(dropUnlinkedNotes(nodes, links, "root")).toEqual([ { id: "root" }, { id: "source" }, { id: "target" } ]);

        // Nothing linked at all: the root still stands on its own rather than leaving an empty map.
        expect(dropUnlinkedNotes(nodes, [], "root")).toEqual([ { id: "root" } ]);

        // A root that isn't among the nodes (a search note removes itself) doesn't conjure one up.
        expect(dropUnlinkedNotes(nodes, [], "missing")).toEqual([]);
    });
});
