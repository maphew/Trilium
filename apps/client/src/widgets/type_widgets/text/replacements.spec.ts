import { describe, expect, it } from "vitest";

import { buildCustomTransformations, type CustomReplacement, parseCustomReplacements } from "./replacements.js";

/**
 * Applies a transformation the way CKEditor's `TextTransformation` does — match the text before the
 * caret, then swap in every group the `to` array names — so the pattern and the replacement are
 * asserted together rather than by eyeballing the regex.
 */
function transform(replacement: CustomReplacement, text: string) {
    const [ transformation ] = buildCustomTransformations([ replacement ]);
    if (!transformation) return null;

    const { from, to } = transformation;
    if (!(from instanceof RegExp) || !Array.isArray(to)) {
        throw new Error("custom replacements are built as a RegExp plus a replacement array");
    }

    const matches = from.exec(text);
    if (!matches) return null;

    let result = text.slice(0, matches.index);
    for (let i = 1; i < matches.length; i++) {
        result += to[i - 1] ?? matches[i];
    }
    return result + text.slice(matches.index + matches[0].length);
}

describe("parseCustomReplacements", () => {
    it("reads the stored pairs", () => {
        expect(parseCustomReplacements(`[{"from":"TN","to":"Trilium Notes"}]`)).toEqual([
            { from: "TN", to: "Trilium Notes" }
        ]);
    });

    it("degrades to none for anything the option is not", () => {
        // It is user-entered content that syncs between devices, so a value that cannot be read has
        // to leave the editor working rather than take it down with it.
        for (const stored of [ "", null, undefined, "not json", "null", "42", `{"from":"a"}` ]) {
            expect(parseCustomReplacements(stored), String(stored)).toEqual([]);
        }
    });

    it("drops entries that are not a pair of strings, keeping the ones that are", () => {
        const stored = `[{"from":"TN","to":"Trilium Notes"},{"from":"x"},null,42,{"from":1,"to":2},{"from":"a","to":"b"}]`;

        expect(parseCustomReplacements(stored)).toEqual([
            { from: "TN", to: "Trilium Notes" },
            { from: "a", to: "b" }
        ]);
    });
});

describe("buildCustomTransformations", () => {
    it("replaces the text once it is followed by a space, keeping the space", () => {
        expect(transform({ from: "TN", to: "Trilium Notes" }, "about TN ")).toBe("about Trilium Notes ");
        // Opening the line counts as a boundary too.
        expect(transform({ from: "TN", to: "Trilium Notes" }, "TN ")).toBe("Trilium Notes ");
    });

    it("leaves a longer word that merely starts or ends with the text alone", () => {
        // Passing a bare string to CKEditor compiles to /(TN)$/, which would rewrite the tail of this.
        expect(transform({ from: "TN", to: "Trilium Notes" }, "BTN ")).toBeNull();
        // Firing on the closing space rather than the last letter is what keeps this typeable.
        expect(transform({ from: "TN", to: "Trilium Notes" }, "TNT ")).toBeNull();
        // ...and until that space arrives, nothing happens.
        expect(transform({ from: "TN", to: "Trilium Notes" }, "about TN")).toBeNull();
    });

    it("treats the typed text as literal, never as a pattern", () => {
        // A regular expression would match "xyz" here; a literal only matches the characters typed.
        expect(transform({ from: ".+", to: "…" }, "xyz ")).toBeNull();
        expect(transform({ from: ".+", to: "…" }, "a .+ ")).toBe("a … ");
        // The classic catastrophic-backtracking shape is inert, being matched character for character.
        expect(transform({ from: "(a+)+$", to: "ok" }, "x (a+)+$ ")).toBe("x ok ");
    });

    it("ignores a row that is still half-written", () => {
        expect(buildCustomTransformations([ { from: "", to: "Trilium Notes" } ])).toEqual([]);
        expect(buildCustomTransformations([ { from: "TN", to: "" } ])).toEqual([]);
        expect(buildCustomTransformations([ { from: "   ", to: "  " } ])).toEqual([]);
        // A finished row beside an unfinished one still compiles.
        expect(buildCustomTransformations([ { from: "TN", to: "" }, { from: "a", to: "b" } ])).toHaveLength(1);
    });
});
