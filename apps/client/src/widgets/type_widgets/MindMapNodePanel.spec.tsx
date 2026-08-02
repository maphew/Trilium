import type { MindElixirInstance, NodeObj } from "mind-elixir";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import MindMapNodePanel, { applyTagTexts, DEFAULT_FONT_SIZE, gatherTags, getCommonValue, MIXED, NODE_BACKGROUND_COLORS, NODE_COLORS } from "./MindMapNodePanel";

function buildNode(node: Partial<NodeObj> = {}): NodeObj {
    return { id: "n1", topic: "Node", ...node };
}

/**
 * A stand-in for the Mind Elixir instance exposing only what the panel touches: the live selection
 * and `reshapeNode`.
 */
function buildMind(nodes: NodeObj[]) {
    const reshapeNode = vi.fn();
    const mind = {
        currentNodes: nodes.map((nodeObj) => ({ nodeObj })),
        reshapeNode
    } as unknown as MindElixirInstance;
    return { mind, reshapeNode };
}

/** The order the panel lays its sections out in. */
const SIZE = 0;
const TEXT = 1;
const BACKGROUND = 2;
const BRANCH = 3;
const TAGS = 4;

function section(container: HTMLElement, index: number) {
    const sections = container.querySelectorAll<HTMLElement>(".mind-map-node-panel-section");
    return sections[index];
}

function tagTexts(container: HTMLElement) {
    return [ ...section(container, TAGS).querySelectorAll(".tn-chip > span") ].map((chip) => chip.textContent);
}

/** Types a tag into the field and settles it, the way Enter does for someone using the panel. */
function typeTag(container: HTMLElement, text: string) {
    const input = section(container, TAGS).querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("the tag field has no box to type in");
    input.value = text;
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}

function sizeButtons(container: HTMLElement) {
    return Array.from(section(container, SIZE).querySelectorAll<HTMLElement>(".btn"));
}

function activeSize(container: HTMLElement) {
    return sizeButtons(container).findIndex((button) => button.classList.contains("active"));
}

function presetCells(root: HTMLElement) {
    return Array.from(root.querySelectorAll<HTMLElement>(".color-cell")).filter((cell) =>
        !cell.classList.contains("color-cell-reset") && !cell.classList.contains("custom-color-cell"));
}

describe("getCommonValue", () => {
    it("reports the shared value, the absence of one, and disagreement", () => {
        const read = (node: NodeObj) => node.style?.color;

        expect(getCommonValue([], read)).toBeNull();
        expect(getCommonValue([buildNode()], read)).toBeNull();
        expect(getCommonValue([buildNode({ style: { color: "#ff0000" } })], read)).toBe("#ff0000");
        expect(getCommonValue([
            buildNode({ style: { color: "#ff0000" } }),
            buildNode({ style: { color: "#ff0000" } })
        ], read)).toBe("#ff0000");
        expect(getCommonValue([
            buildNode({ style: { color: "#ff0000" } }),
            buildNode({ style: { color: "#00ff00" } })
        ], read)).toBe(MIXED);
        expect(getCommonValue([
            buildNode({ style: { color: "#ff0000" } }),
            buildNode()
        ], read)).toBe(MIXED);
    });

    it("treats a blanked-out value the same as an unset one", () => {
        // Clearing a color writes an empty string rather than removing the property, so the two
        // spellings of "no color" have to agree.
        const read = (node: NodeObj) => node.style?.color;

        expect(getCommonValue([buildNode({ style: { color: "" } })], read)).toBeNull();
        expect(getCommonValue([
            buildNode({ style: { color: "" } }),
            buildNode()
        ], read)).toBeNull();
    });
});

describe("gatherTags", () => {
    it("hands over the tags a selection agrees on, whatever order each holds them in", () => {
        expect(gatherTags([buildNode()])).toEqual({ texts: [], readOnly: false });
        expect(gatherTags([buildNode({ tags: ["one", { text: "two" }] })]))
            .toEqual({ texts: ["one", "two"], readOnly: false });
        expect(gatherTags([
            buildNode({ id: "a", tags: ["one", "two"] }),
            buildNode({ id: "b", tags: ["two", "one"] })
        ])).toEqual({ texts: ["one", "two"], readOnly: false });
    });

    it("gathers everything the selection carries, for reading only, once they disagree", () => {
        expect(gatherTags([
            buildNode({ id: "a", tags: ["one", "shared"] }),
            buildNode({ id: "b", tags: ["shared", "two"] })
        ])).toEqual({ texts: ["one", "shared", "two"], readOnly: true });

        // One node holding none of them is a disagreement like any other.
        expect(gatherTags([buildNode({ id: "a", tags: ["one"] }), buildNode({ id: "b" })]))
            .toEqual({ texts: ["one"], readOnly: true });
    });
});

describe("applyTagTexts", () => {
    it("keeps a styled tag while its text stands, and plain text for the rest", () => {
        const styled = { text: "urgent", style: { color: "red" } };

        expect(applyTagTexts([styled, "later"], ["urgent", "done"])).toEqual([styled, "done"]);
        // Dropped from the texts, the styling goes with it rather than following the tag back.
        expect(applyTagTexts([styled], ["done"])).toEqual(["done"]);
        expect(applyTagTexts(undefined, ["done"])).toEqual(["done"]);
        expect(applyTagTexts([styled], [])).toEqual([]);
    });
});

describe("MindMapNodePanel", () => {
    it("offers every row on a single line, backgrounds as translucent variants of the same hues", () => {
        const nodes = [buildNode()];
        const { mind } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        for (const index of [TEXT, BACKGROUND, BRANCH]) {
            // A row is the presets plus the clear and custom cells; more would wrap in the panel.
            expect(presetCells(section(container, index))).toHaveLength(NODE_COLORS.length);
            expect(section(container, index).querySelectorAll(".color-cell")).toHaveLength(NODE_COLORS.length + 2);
        }
        expect(NODE_BACKGROUND_COLORS).toEqual(NODE_COLORS.map((color) => `${color}40`));
    });

    it("shows a node with no size of its own as medium, and applies the sizes it is asked for", () => {
        const nodes = [buildNode({ id: "a" }), buildNode({ id: "b" })];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        expect(sizeButtons(container)).toHaveLength(4);
        expect(activeSize(container)).toBe(1);

        sizeButtons(container)[2].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { fontSize: "24px" } });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { style: { fontSize: "24px" } });

        // Back to medium means back to having no size of its own, rather than the size of an
        // ordinary node — the root is larger than that.
        reshapeNode.mockClear();
        sizeButtons(container)[1].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { fontSize: DEFAULT_FONT_SIZE } });
        expect(DEFAULT_FONT_SIZE).toBe("");
    });

    it("shows the size the selection already carries, and none when the nodes disagree", () => {
        const large = { style: { fontSize: "24px" } };
        const { mind } = buildMind([buildNode(large)]);
        expect(activeSize(renderInto(<MindMapNodePanel mind={mind} nodes={[buildNode(large)]} />))).toBe(2);

        const mixed = [buildNode({ id: "a", ...large }), buildNode({ id: "b", style: { fontSize: "32px" } })];
        const mixedMind = buildMind(mixed);
        expect(activeSize(renderInto(<MindMapNodePanel mind={mixedMind.mind} nodes={mixed} />))).toBe(-1);
    });

    it("shows the colors the selection already carries", () => {
        const nodes = [buildNode({
            style: { color: NODE_COLORS[1], background: NODE_BACKGROUND_COLORS[2] },
            branchColor: NODE_COLORS[0]
        })];
        const { mind } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        const selectedIn = (index: number) => presetCells(section(container, index))
            .findIndex((cell) => cell.classList.contains("selected"));
        expect(selectedIn(TEXT)).toBe(1);
        // The translucent background has to survive being matched against its swatch.
        expect(selectedIn(BACKGROUND)).toBe(2);
        expect(selectedIn(BRANCH)).toBe(0);
    });

    it("selects nothing for a property the selected nodes disagree on", () => {
        const nodes = [
            buildNode({ id: "a", style: { color: NODE_COLORS[0] } }),
            buildNode({ id: "b", style: { color: NODE_COLORS[1] } })
        ];
        const { mind } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        const textCells = Array.from(section(container, TEXT).querySelectorAll(".color-cell"));
        expect(textCells.some((cell) => cell.classList.contains("selected"))).toBe(false);
        // The properties they do agree on are still shown as unset.
        const backgroundReset = section(container, BACKGROUND).querySelector(".color-cell-reset");
        expect(backgroundReset?.classList.contains("selected")).toBe(true);
    });

    it("patches every selected node, and blanks the property when a color is cleared", () => {
        const nodes = [buildNode({ id: "a" }), buildNode({ id: "b" })];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        presetCells(section(container, TEXT))[3].click();
        expect(reshapeNode).toHaveBeenCalledTimes(2);
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { color: NODE_COLORS[3] } });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { style: { color: NODE_COLORS[3] } });

        reshapeNode.mockClear();
        presetCells(section(container, BACKGROUND))[3].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { background: NODE_BACKGROUND_COLORS[3] } });

        reshapeNode.mockClear();
        section(container, BACKGROUND).querySelector<HTMLElement>(".color-cell-reset")?.click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { background: "" } });

        reshapeNode.mockClear();
        presetCells(section(container, BRANCH))[1].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { branchColor: NODE_COLORS[1] });
    });

    it("edits the tags of a single node, keeping the styling of the ones that stay", () => {
        const styled = { text: "urgent", style: { color: "red" } };
        const nodes = [buildNode({ tags: [styled, "later"] })];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        expect(tagTexts(container)).toEqual(["urgent", "later"]);

        typeTag(container, "done");

        expect(reshapeNode).toHaveBeenCalledWith(mind.currentNodes[0], { tags: [styled, "later", "done"] });
    });

    it("edits the tags of several nodes that carry the same ones, each keeping its own styling", () => {
        // The same tag, dressed differently on each node: what is written back has to be read from
        // the node it is written to, rather than from whichever node the field happened to show.
        const nodes = [
            buildNode({ id: "a", tags: [{ text: "urgent", style: { color: "red" } }] }),
            buildNode({ id: "b", tags: [{ text: "urgent", style: { color: "blue" } }] })
        ];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        expect(tagTexts(container)).toEqual(["urgent"]);
        expect(container.querySelector<HTMLInputElement>(".tn-field input")?.disabled).toBe(false);

        typeTag(container, "done");

        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { tags: [nodes[0].tags?.[0], "done"] });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { tags: [nodes[1].tags?.[0], "done"] });
    });

    it("gathers the tags of a selection that disagrees, for reading only", () => {
        const nodes = [
            buildNode({ id: "a", tags: ["one", "shared"] }),
            buildNode({ id: "b", tags: ["shared", "two"] })
        ];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        expect(tagTexts(container)).toEqual(["one", "shared", "two"]);
        expect(container.querySelector<HTMLInputElement>(".tn-field input")?.disabled).toBe(true);
        // Nothing to press: a removal would take a tag off a node that never had it.
        expect([...container.querySelectorAll<HTMLButtonElement>(".tn-chip-remove")].every((button) => button.disabled)).toBe(true);

        typeTag(container, "done");
        expect(reshapeNode).not.toHaveBeenCalled();
    });

    it("keeps clicks and key presses from reaching the map underneath", () => {
        const nodes = [buildNode()];
        const { mind } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);
        const panel = container.querySelector(".mind-map-node-panel");

        for (const event of [
            new MouseEvent("mousedown", { bubbles: true, cancelable: true }),
            new KeyboardEvent("keydown", { bubbles: true, cancelable: true, key: "Delete" })
        ]) {
            const stopPropagation = vi.spyOn(event, "stopPropagation");
            panel?.dispatchEvent(event);
            expect(stopPropagation).toHaveBeenCalled();
        }
    });
});
