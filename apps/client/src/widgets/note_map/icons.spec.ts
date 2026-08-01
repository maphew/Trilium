import { afterEach, describe, expect, it, vi } from "vitest";

import { loadIconFont, resolveIconGlyphs } from "./icons";

describe("resolveIconGlyphs", () => {
    afterEach(() => vi.restoreAllMocks());

    /**
     * What the stylesheet makes of each icon class, as it is read back off the probe wearing it.
     * Stubbed rather than written as CSS: the map is drawn against a browser's own style resolution,
     * which the test environment has none of.
     */
    const answerWith = (contents: Record<string, string>) => vi.spyOn(window, "getComputedStyle")
        .mockImplementation((element, pseudo) => {
            const className = (element as HTMLElement).className.replace("icon-glyph-probe ", "");
            return { content: pseudo === "::before" ? contents[className] : "" } as CSSStyleDeclaration;
        });

    it("reads what each class draws, however the stylesheet quotes it, and asks once per class", () => {
        const host = document.createElement("div");
        const resolve = answerWith({
            "bx bx-file": "\"\"",
            "bx bx-code": "''",
            // A class that draws no icon at all, and one the stylesheet says nothing about.
            "bx bx-nothing": "none",
            "bx bx-unknown": ""
        });

        const glyphs = resolveIconGlyphs([ "bx bx-file", "bx bx-code", "bx bx-nothing", "bx bx-unknown", "bx bx-file" ], host);

        expect(glyphs.get("bx bx-file")).toBe("");
        expect(glyphs.get("bx bx-code")).toBe("");
        expect(glyphs.has("bx bx-nothing")).toBe(false);
        expect(glyphs.has("bx bx-unknown")).toBe(false);

        // Four classes asked for five times: what a map of thousands of notes is spared.
        expect(resolve).toHaveBeenCalledTimes(4);
        // The probe is an element of no consequence, and is not left behind as one.
        expect(host.childElementCount).toBe(0);
    });

    it("takes the probe back out of the map even where the styles cannot be read", () => {
        const host = document.createElement("div");
        vi.spyOn(window, "getComputedStyle").mockImplementation(() => {
            throw new Error("no styles to speak of");
        });

        expect(() => resolveIconGlyphs([ "bx bx-file" ], host)).toThrow();
        expect(host.childElementCount).toBe(0);
    });
});

describe("loadIconFont", () => {
    afterEach(() => vi.restoreAllMocks());

    it("is done either way, a font that cannot be promised being no reason not to draw the map", async () => {
        // Somewhere with no font set to ask at all, which is where these tests themselves run.
        await expect(loadIconFont()).resolves.toBeUndefined();

        // And somewhere that has one and cannot promise the font.
        Object.defineProperty(document, "fonts", {
            configurable: true,
            value: { load: () => Promise.reject(new Error("no such font")) }
        });

        try {
            await expect(loadIconFont()).resolves.toBeUndefined();
        } finally {
            Reflect.deleteProperty(document, "fonts");
        }
    });
});
