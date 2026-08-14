import { describe, expect, it } from "vitest";

import { stripMarkdownFences } from "./ai_html.js";

describe("stripMarkdownFences", () => {
    it("returns unfenced content unchanged", () => {
        expect(stripMarkdownFences("<p>plain</p>")).toBe("<p>plain</p>");
    });

    it("strips a complete ```html fence pair", () => {
        expect(stripMarkdownFences("```html\n<p>hi</p>\n```")).toBe("<p>hi</p>\n");
        expect(stripMarkdownFences("```\n<p>hi</p>\n```\n")).toBe("<p>hi</p>\n");
    });

    it("strips an opening fence whose closing half has not streamed in yet", () => {
        expect(stripMarkdownFences("```html\n<p>st")).toBe("<p>st");
    });

    it("does not treat a ``` inside the content as a closing fence", () => {
        expect(stripMarkdownFences("```html\n<p>use ``` for fences</p>\n<p>more</p>"))
            .toBe("<p>use ``` for fences</p>\n<p>more</p>");
    });
});
