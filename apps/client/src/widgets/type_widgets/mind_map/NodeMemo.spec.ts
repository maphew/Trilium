import type { NodeObj } from "mind-elixir";
import { describe, expect, it } from "vitest";

import { getNodeMemo, toMemoHtml } from "./NodeMemo";

function buildNode(node: Partial<NodeObj> = {}): NodeObj {
    return { id: "n1", topic: "Node", ...node };
}

describe("the memo of a node", () => {
    it("is read from the field the node menu wrote, which Mind Elixir has no say over", () => {
        // Its own `note` field is a different one, never written here: reading that instead would
        // leave every memo written before this panel unseen.
        expect(getNodeMemo(buildNode({ memo: "Ask about this" } as Partial<NodeObj>))).toBe("Ask about this");
        expect(getNodeMemo(buildNode({ note: "elsewhere" } as Partial<NodeObj>))).toBeUndefined();
        expect(getNodeMemo(buildNode())).toBeUndefined();
    });

    it("survives being taken into an editor, however it was written", () => {
        // Written through the textarea this replaces, a memo is plain text: read as HTML, a `<`
        // would swallow what follows it and the memo would come back shorter than it went in.
        expect(toMemoHtml("2 < 3 & counting")).toBe("<p>2 &lt; 3 &amp; counting</p>");
        expect(toMemoHtml("first\nsecond")).toBe("<p>first</p><p>second</p>");
        // Written through the editor, it is HTML already and is handed over as it stands.
        expect(toMemoHtml("<p>Ask <strong>about</strong> this</p>")).toBe("<p>Ask <strong>about</strong> this</p>");
        expect(toMemoHtml(null)).toBe("");
        expect(toMemoHtml("")).toBe("");
    });
});
