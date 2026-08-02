import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LEAD_ICON_CLASS, renderIconClasses } from "./icons";

const uncheckedWindow = window as unknown as { glob: { iconRegistry?: unknown } };

/**
 * Renders what Mind Elixir makes of a node: its text, and after it the icons it was given as the
 * text they arrived as, one span each.
 */
function buildNode(...icons: string[]) {
    const container = document.createElement("div");
    container.innerHTML = `<me-tpc><span class="text">Topic</span>`
        + `<span class="icons">${icons.map((icon) => `<span>${icon}</span>`).join("")}</span></me-tpc>`;
    return container;
}

/** Every icon of the node, in the order they are worn — the one moved ahead of the text included. */
function icons(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLElement>(`me-tpc > .${LEAD_ICON_CLASS}, me-tpc > .icons > span`) ];
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

        const [ boxicon, mdi ] = icons(container);
        expect(boxicon.classList).toContain("bx-star");
        expect(boxicon.textContent).toBe("");
        expect(mdi.className).toBe("mdi mdi-cube");
    });

    it("leaves alone whatever is not one, so that a map made elsewhere keeps its icons", () => {
        // An emoji is an icon in its own right; a pack that is not installed names nothing that
        // could be drawn; and a sentence is a sentence. The first still leads the text, being the
        // node's first icon whether or not Trilium is the one drawing it.
        const container = buildNode("⭐", "phosphor ph-cube", "bx");

        renderIconClasses(container);

        expect(icons(container).map((icon) => [ icon.textContent, icon.classList.contains(LEAD_ICON_CLASS) ]))
            .toEqual([ [ "⭐", true ], [ "phosphor ph-cube", false ], [ "bx", false ] ]);
    });

    it("leaves a dressed icon something to read, for the exporter's sake", () => {
        // Mind Elixir's SVG exporter reads `childNodes[0].textContent` off every icon it finds, so
        // a span emptied down to nothing throws there — and the preview is rendered on every save.
        const container = buildNode("bx bx-star");

        renderIconClasses(container);

        const [ icon ] = icons(container);
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

        const [ icon ] = icons(container);
        expect(icon?.className).toBe(`bx bx-star ${LEAD_ICON_CLASS}`);
        expect(icon?.textContent).toBe("");
    });

    it("sets the first icon ahead of the node's text, leaving the rest after it", () => {
        const container = buildNode("bx bx-star", "mdi mdi-cube", "⭐");

        renderIconClasses(container);

        // The first is a child of the node itself now, standing before its text; the others stay in
        // the wrapper Mind Elixir put them in, which is where its exporter looks for them.
        expect([ ...(container.querySelector("me-tpc")?.children ?? []) ].map((child) => child.className))
            .toEqual([ `bx bx-star ${LEAD_ICON_CLASS}`, "text", "icons" ]);
        expect(container.querySelectorAll(".icons > span")).toHaveLength(2);
    });

    it("moves the first icon once, however often it is run", () => {
        // Run after every layout, and a layout does not always rebuild the node — moving again
        // would take the second icon to the front along with the first.
        const container = buildNode("bx bx-star", "mdi mdi-cube");

        expect(renderIconClasses(container)).toBe(true);
        expect(renderIconClasses(container)).toBe(false);

        expect(container.querySelectorAll(`.${LEAD_ICON_CLASS}`)).toHaveLength(1);
        expect(icons(container).map((icon) => icon.className.replace(` ${LEAD_ICON_CLASS}`, "")))
            .toEqual([ "bx bx-star", "mdi mdi-cube" ]);
    });

    it("leaves a node with no text of its own — nothing to lead — as it is", () => {
        const container = document.createElement("div");
        container.innerHTML = `<me-tpc><span class="icons"><span>bx bx-star</span></span></me-tpc>`;

        renderIconClasses(container);

        expect(container.querySelector(`.${LEAD_ICON_CLASS}`)).toBeNull();
        expect(container.querySelector(".icons > span")?.className).toBe("bx bx-star");
    });

    it("holds off until the icon packs are known", () => {
        delete uncheckedWindow.glob.iconRegistry;
        const container = buildNode("bx bx-star");

        renderIconClasses(container);

        expect(icons(container)[0]?.textContent).toBe("bx bx-star");
    });
});
