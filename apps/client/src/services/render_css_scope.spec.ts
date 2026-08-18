import { describe, expect, it } from "vitest";

import { RENDER_SCOPE_CLASS, scopeRenderNoteCss } from "./render_css_scope.js";

/** Collapses whitespace, so assertions read as CSS rather than as the serializer's exact layout. */
function scope(css: string) {
    return scopeRenderNoteCss(css).replace(/\s+/g, " ").trim();
}

const OPEN = `@scope (.${RENDER_SCOPE_CLASS}) {`;

describe("scopeRenderNoteCss", () => {
    it("wraps rules and leaves ordinary selectors alone", () => {
        expect(scope(".card { color: red }")).toBe(`${OPEN} .card { color: red } }`);
        expect(scope("#id .card > a:hover { color: red }")).toBe(`${OPEN} #id .card > a:hover { color: red } }`);
        expect(scope("")).toBe("");
    });

    it("rewrites selectors that address the document root", () => {
        expect(scope("body { max-width: 980px }")).toBe(`${OPEN} :scope { max-width: 980px } }`);
        expect(scope("html { color: red }")).toBe(`${OPEN} :scope { color: red } }`);
        expect(scope(":root { --x: 1 }")).toBe(`${OPEN} :scope { --x: 1 } }`);
        expect(scope("html body { color: red }")).toBe(`${OPEN} :scope { color: red } }`);
        expect(scope("html > body .card { color: red }")).toBe(`${OPEN} :scope .card { color: red } }`);
        expect(scope("body.dark { color: red }")).toBe(`${OPEN} :scope.dark { color: red } }`);
        expect(scope("body + .x { color: red }")).toBe(`${OPEN} :scope + .x { color: red } }`);
    });

    it("does not mistake other identifiers for the document root", () => {
        expect(scope("bodyguard { color: red }")).toBe(`${OPEN} bodyguard { color: red } }`);
        expect(scope("[data-body] { color: red }")).toBe(`${OPEN} [data-body] { color: red } }`);
        expect(scope(".x body { color: red }")).toBe(`${OPEN} .x body { color: red } }`);
    });

    it("rewrites every selector in a list, splitting only on top-level commas", () => {
        expect(scope("body, .x { color: red }")).toBe(`${OPEN} :scope, .x { color: red } }`);
        expect(scope(":is(a, body) { color: red }")).toBe(`${OPEN} :is(a, body) { color: red } }`);
        expect(scope("[title=\"a,b\"], body { color: red }")).toBe(`${OPEN} [title="a,b"], :scope { color: red } }`);
    });

    it("recurses into grouping at-rules, which stay scoped", () => {
        expect(scope("@media (min-width: 1px) { body { color: red } .x { color: blue } }"))
            .toBe(`${OPEN} @media (min-width: 1px) { :scope { color: red } .x { color: blue } } }`);
        expect(scope("@supports (display: grid) { body { color: red } }"))
            .toBe(`${OPEN} @supports (display: grid) { :scope { color: red } } }`);
    });

    it("hoists at-rules that define document-global names or must stay at the top level", () => {
        expect(scope("@keyframes spin { from { opacity: 0 } } body { color: red }"))
            .toBe(`@keyframes spin { from { opacity: 0 } } ${OPEN} :scope { color: red } }`);
        expect(scope("@font-face { font-family: X } .a { color: red }"))
            .toBe(`@font-face { font-family: X } ${OPEN} .a { color: red } }`);
        expect(scope("@import url(\"x.css\"); .a { color: red }"))
            .toBe(`@import url("x.css"); ${OPEN} .a { color: red } }`);
        // Nothing left to scope, so no empty wrapper is emitted.
        expect(scope("@font-face { font-family: X }")).toBe("@font-face { font-family: X }");
    });

    it("survives braces and commas that are not structural", () => {
        expect(scope("a::after { content: \"}\" } .b { color: red }"))
            .toBe(`${OPEN} a::after { content: "}" } .b { color: red } }`);
        expect(scope("/* } */ body { color: red }")).toBe(`${OPEN} :scope { color: red } }`);
        expect(scope("body { color: red /* } */ }")).toBe(`${OPEN} :scope { color: red /* } */ } }`);
    });

    it("recovers from an unterminated rule rather than dropping the stylesheet", () => {
        expect(scope(".a { color: red")).toBe(`${OPEN} .a { color: red} }`);
        expect(scope("body { color: red } .b {")).toBe(`${OPEN} :scope { color: red } .b {} }`);
    });
});
