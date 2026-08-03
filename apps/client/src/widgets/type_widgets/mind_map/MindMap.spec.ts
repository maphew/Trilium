// @vitest-environment jsdom
// DOMPurify relies on browser-faithful DOM traversal (NodeIterator); happy-dom
// mishandles it and strips valid markup (surfaced by dompurify 3.4.8). Run the
// sanitization-dependent specs under jsdom, which matches real-browser behavior.
import { DARK_THEME, THEME as LIGHT_THEME } from "mind-elixir";
import { describe, expect, it } from "vitest";

import { buildTheme, sanitizeMindMapData } from "./MindMap.js";

describe("sanitizeMindMapData", () => {
    it("strips XSS/RCE vectors from dangerouslySetInnerHTML (GHSA-rj57-j38v-3577)", () => {
        const data = {
            nodeData: {
                id: "root",
                topic: "root",
                dangerouslySetInnerHTML: `<img src=x onerror="require('child_process').exec('calc')">`,
                children: []
            }
        };

        const sanitized = sanitizeMindMapData(data);
        const html = sanitized.nodeData.dangerouslySetInnerHTML;

        expect(html).not.toContain("onerror");
        expect(html).not.toContain("child_process");
        // The benign part of the markup is preserved rather than dropped wholesale.
        expect(html).toContain("<img");
    });

    it("removes <script> payloads while keeping harmless markup", () => {
        const data = { nodeData: { dangerouslySetInnerHTML: `<b>hi</b><script>alert(1)</script>` } };

        const html = sanitizeMindMapData(data).nodeData.dangerouslySetInnerHTML;

        expect(html).toContain("<b>hi</b>");
        expect(html).not.toContain("<script");
    });

    it("sanitizes the property anywhere in the tree, including nested children", () => {
        const data = {
            nodeData: {
                id: "root",
                topic: "root",
                children: [
                    { id: "a", topic: "a" },
                    {
                        id: "b",
                        topic: "b",
                        dangerouslySetInnerHTML: `<svg><script>alert(1)</script></svg>`,
                        children: [
                            { id: "c", dangerouslySetInnerHTML: `<a href="javascript:alert(1)">x</a>` }
                        ]
                    }
                ]
            }
        };

        sanitizeMindMapData(data);

        const b = data.nodeData.children[1];
        expect(b.dangerouslySetInnerHTML).not.toContain("<script");
        expect(b.children?.[0].dangerouslySetInnerHTML).not.toContain("javascript:");
    });

    it("mutates in place and returns the same reference", () => {
        const data = { nodeData: { topic: "root" } };
        expect(sanitizeMindMapData(data)).toBe(data);
    });

    it("leaves content without the property untouched", () => {
        const data = { nodeData: { id: "root", topic: "hello", children: [] } };
        sanitizeMindMapData(data);
        expect(data).toEqual({ nodeData: { id: "root", topic: "hello", children: [] } });
    });

    it("ignores a non-string dangerouslySetInnerHTML value", () => {
        const data = { nodeData: { dangerouslySetInnerHTML: 123 } };
        sanitizeMindMapData(data);
        expect(data.nodeData.dangerouslySetInnerHTML).toBe(123);
    });
});

describe("buildTheme", () => {
    function container(background?: string) {
        const el = document.createElement("div");
        if (background) {
            el.style.setProperty("--main-background-color", background);
        }
        return el;
    }

    it("draws the map on Trilium's background, keeping the rest of the scheme's theme", () => {
        const light = buildTheme("light", container("#fafafa"));
        expect(light.name).toBe(LIGHT_THEME.name);
        expect(light.cssVar?.["--bgcolor"]).toBe("#fafafa");
        expect(light.cssVar?.["--main-bgcolor"]).toBe(LIGHT_THEME.cssVar["--main-bgcolor"]);
        expect(light.palette).toEqual(LIGHT_THEME.palette);

        const dark = buildTheme("dark", container("#242424"));
        expect(dark.name).toBe(DARK_THEME.name);
        expect(dark.cssVar?.["--bgcolor"]).toBe("#242424");
    });

    it("leaves the theme as it is when Trilium's background cannot be resolved", () => {
        expect(buildTheme("dark", container())).toBe(DARK_THEME);
    });
});
