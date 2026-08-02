import type { MindElixirInstance, NodeObj } from "mind-elixir";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";
import MindMapNodePanel, { getCommonValue, MIXED, NODE_BACKGROUND_COLORS, NODE_COLORS } from "./MindMapNodePanel";

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

function section(container: HTMLElement, index: number) {
    const sections = container.querySelectorAll<HTMLElement>(".mind-map-node-panel-section");
    return sections[index];
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

describe("MindMapNodePanel", () => {
    it("offers every row on a single line, backgrounds as translucent variants of the same hues", () => {
        const nodes = [buildNode()];
        const { mind } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        for (const index of [0, 1, 2]) {
            // A row is the presets plus the clear and custom cells; more would wrap in the panel.
            expect(presetCells(section(container, index))).toHaveLength(NODE_COLORS.length);
            expect(section(container, index).querySelectorAll(".color-cell")).toHaveLength(NODE_COLORS.length + 2);
        }
        expect(NODE_BACKGROUND_COLORS).toEqual(NODE_COLORS.map((color) => `${color}40`));
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
        expect(selectedIn(0)).toBe(1);
        // The translucent background has to survive being matched against its swatch.
        expect(selectedIn(1)).toBe(2);
        expect(selectedIn(2)).toBe(0);
    });

    it("selects nothing for a property the selected nodes disagree on", () => {
        const nodes = [
            buildNode({ id: "a", style: { color: NODE_COLORS[0] } }),
            buildNode({ id: "b", style: { color: NODE_COLORS[1] } })
        ];
        const { mind } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        const textCells = Array.from(section(container, 0).querySelectorAll(".color-cell"));
        expect(textCells.some((cell) => cell.classList.contains("selected"))).toBe(false);
        // The properties they do agree on are still shown as unset.
        const backgroundReset = section(container, 1).querySelector(".color-cell-reset");
        expect(backgroundReset?.classList.contains("selected")).toBe(true);
    });

    it("patches every selected node, and blanks the property when a color is cleared", () => {
        const nodes = [buildNode({ id: "a" }), buildNode({ id: "b" })];
        const { mind, reshapeNode } = buildMind(nodes);

        const container = renderInto(<MindMapNodePanel mind={mind} nodes={nodes} />);

        presetCells(section(container, 0))[3].click();
        expect(reshapeNode).toHaveBeenCalledTimes(2);
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { color: NODE_COLORS[3] } });
        expect(reshapeNode).toHaveBeenNthCalledWith(2, mind.currentNodes[1], { style: { color: NODE_COLORS[3] } });

        reshapeNode.mockClear();
        presetCells(section(container, 1))[3].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { background: NODE_BACKGROUND_COLORS[3] } });

        reshapeNode.mockClear();
        section(container, 1).querySelector<HTMLElement>(".color-cell-reset")?.click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { style: { background: "" } });

        reshapeNode.mockClear();
        presetCells(section(container, 2))[1].click();
        expect(reshapeNode).toHaveBeenNthCalledWith(1, mind.currentNodes[0], { branchColor: NODE_COLORS[1] });
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
