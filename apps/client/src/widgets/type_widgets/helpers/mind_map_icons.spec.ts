import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { renderIconClasses } from "./mind_map_icons";

const uncheckedWindow = window as unknown as { glob: { iconRegistry?: unknown } };

/** Renders what Mind Elixir makes of a node's icons: the text it was given, one span each. */
function buildNode(...icons: string[]) {
    const container = document.createElement("div");
    container.innerHTML = `<me-tpc><span class="icons">${icons.map((icon) => `<span>${icon}</span>`).join("")}</span></me-tpc>`;
    return container;
}

describe("renderIconClasses", () => {
    beforeEach(() => {
        uncheckedWindow.glob.iconRegistry = { sources: [ { prefix: "bx" }, { prefix: "mdi" } ] };
    });

    afterEach(() => {
        delete uncheckedWindow.glob.iconRegistry;
    });

    it("dresses a Trilium icon class, whichever pack it belongs to", () => {
        const container = buildNode("bx bx-star", "mdi mdi-cube");

        expect(renderIconClasses(container)).toBe(true);

        const [ boxicon, mdi ] = container.querySelectorAll(".icons > span");
        expect(boxicon.className).toBe("bx bx-star");
        expect(boxicon.textContent).toBe("");
        expect(mdi.className).toBe("mdi mdi-cube");
    });

    it("leaves alone whatever is not one, so that a map made elsewhere keeps its icons", () => {
        // An emoji is an icon in its own right; a pack that is not installed names nothing that
        // could be drawn; and a sentence is a sentence.
        const container = buildNode("⭐", "phosphor ph-cube", "bx");

        expect(renderIconClasses(container)).toBe(false);

        expect([ ...container.querySelectorAll(".icons > span") ].map((icon) => [ icon.className, icon.textContent ]))
            .toEqual([ [ "", "⭐" ], [ "", "phosphor ph-cube" ], [ "", "bx" ] ]);
    });

    it("leaves a dressed icon something to read, for the exporter's sake", () => {
        // Mind Elixir's SVG exporter reads `childNodes[0].textContent` off every icon it finds, so
        // a span emptied down to nothing throws there — and the preview is rendered on every save.
        const container = buildNode("bx bx-star");

        renderIconClasses(container);

        const icon = container.querySelector(".icons > span");
        expect(icon?.childNodes).toHaveLength(1);
        expect(icon?.childNodes[0].textContent).toBe("");
    });

    it("can be run again over what it has already dressed, reporting that it changed nothing", () => {
        // It runs after every layout, and a layout does not always rebuild the node. Saying that
        // nothing was dressed is what stops the caller measuring the map over and over: it measures
        // again only where a node has just narrowed.
        const container = buildNode("bx bx-star");

        expect(renderIconClasses(container)).toBe(true);
        expect(renderIconClasses(container)).toBe(false);

        const icon = container.querySelector(".icons > span");
        expect(icon?.className).toBe("bx bx-star");
        expect(icon?.textContent).toBe("");
    });

    it("holds off until the icon packs are known", () => {
        delete uncheckedWindow.glob.iconRegistry;
        const container = buildNode("bx bx-star");

        renderIconClasses(container);

        expect(container.querySelector(".icons > span")?.textContent).toBe("bx bx-star");
    });
});
