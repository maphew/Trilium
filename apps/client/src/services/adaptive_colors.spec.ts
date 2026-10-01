import { type AdaptiveColorRole, DEFAULT_ADAPTIVE_COLOR_BANDS } from "@triliumnext/commons";
import { readFileSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import { readAdaptiveColorBands } from "./adaptive_colors.js";

const styleCss = readFileSync(join(__dirname, "..", "stylesheets", "style.css"), "utf-8");

const ROLES: Record<string, AdaptiveColorRole> = {
    "text": "text",
    "background": "background",
    "table-border": "tableBorder",
    "table-background": "tableBackground"
};
const BOUNDS = {
    "min-lightness": "minLightness",
    "max-lightness": "maxLightness",
    "max-chroma": "maxChroma"
} as const;

describe("readAdaptiveColorBands", () => {
    const root = document.documentElement;

    afterEach(() => root.removeAttribute("style"));

    it("finds a limit for every variable in style.css, set to its default", () => {
        const pattern = /--adaptive-([a-z-]+?)-(light|dark)-([a-z-]+):\s*([^;]+);/g;
        // Themes load before style.css, so only a zero-specificity block lets their `:root` win.
        const defaults = [ ...styleCss.matchAll(/:where\(:root\)\s*\{([^}]*)\}/g) ]
            .map(([ , block ]) => block)
            .join("\n");
        const variables = [ ...defaults.matchAll(pattern) ];
        expect(variables).toHaveLength(16);
        expect([ ...styleCss.matchAll(pattern) ]).toHaveLength(16);

        for (const [ , role, theme, bound, value ] of variables) {
            const field = BOUNDS[bound as keyof typeof BOUNDS];
            expect(ROLES[role]).toBeDefined();
            expect(field).toBeDefined();

            const band = DEFAULT_ADAPTIVE_COLOR_BANDS[ROLES[role]][theme as "light" | "dark"];
            expect(value.trim() === "none" ? Infinity : Number(value)).toBe(band[field]);
        }
    });

    it("reads the values a theme defines, and keeps the default for the rest", () => {
        root.style.setProperty("--adaptive-text-light-max-lightness", "35");
        root.style.setProperty("--adaptive-text-dark-max-chroma", "none");
        root.style.setProperty("--adaptive-table-border-dark-min-lightness", "50");
        root.style.setProperty("--adaptive-background-dark-max-lightness", "dark");

        const bands = readAdaptiveColorBands(root);
        expect(bands.text.light)
            .toEqual({ minLightness: 0, maxLightness: 35, maxChroma: Infinity });
        expect(bands.text.dark.maxChroma).toBe(Infinity);
        expect(bands.tableBorder.dark.minLightness).toBe(50);
        expect(bands.background).toEqual(DEFAULT_ADAPTIVE_COLOR_BANDS.background);
        expect(bands.tableBackground).toEqual(DEFAULT_ADAPTIVE_COLOR_BANDS.tableBackground);
    });
});
