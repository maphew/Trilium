import { describe, expect, it } from "vitest";

import { dropUnlinkedNotes } from "./data";

describe("dropUnlinkedNotes", () => {
    const nodes = [ { id: "root" }, { id: "source" }, { id: "target" }, { id: "loose" } ];
    const links = [ { id: "source-target", sourceNoteId: "source", targetNoteId: "target", names: [ "relates" ] } ];

    it("keeps the notes a relation touches along with the map root, and drops the rest", () => {
        expect(dropUnlinkedNotes(nodes, links, "root")).toEqual([ { id: "root" }, { id: "source" }, { id: "target" } ]);

        // Nothing linked at all: the root still stands on its own rather than leaving an empty map.
        expect(dropUnlinkedNotes(nodes, [], "root")).toEqual([ { id: "root" } ]);

        // A root that isn't among the nodes (a search note is not part of its own results) would
        // leave nothing to keep, so the map is left as it was rather than emptied.
        expect(dropUnlinkedNotes(nodes, [], "missing")).toEqual(nodes);
        expect(dropUnlinkedNotes(nodes, links, "missing")).toEqual([ { id: "source" }, { id: "target" } ]);
    });
});
