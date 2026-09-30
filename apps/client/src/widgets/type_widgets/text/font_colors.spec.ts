import { adaptColor, HIGHLIGHT_BACKGROUND } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_COLOR_PALETTE } from "../../react/ColorPicker.js";
import { buildFontColorConfig } from "./font_colors.js";

vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key }));

const SOURCES = [ "#000000", "#555555", "#aaaaaa", "#ffffff", ...DEFAULT_COLOR_PALETTE ];

describe("buildFontColorConfig", () => {
    it("lists four greys, then every note color hue, four to a row", () => {
        for (const palette of Object.values(buildFontColorConfig())) {
            expect(palette.columns).toBe(4);
            expect(palette.colors.map(({ label }) => label)).toEqual([
                "Black", "Dim grey", "Light grey", "White",
                "Red", "Orange", "Yellow", "Light green", "Green", "Aquamarine", "Turquoise",
                "Light blue", "Blue", "Purple", "text-editor.colors.pink"
            ]);
        }
    });

    it("stores each swatch as the pair for its role, without spaces", () => {
        const { fontColor, fontBackgroundColor } = buildFontColorConfig();
        expect(fontColor.colors.map(({ color }) => color))
            .toEqual(SOURCES.map((color) => adaptColor(color, "text")));
        expect(fontBackgroundColor.colors.map(({ color }) => color))
            .toEqual(SOURCES.map((color) => adaptColor(color, "background")));

        // CKEditor strips spaces from a color when a note loads, and matches swatches exactly.
        for (const { color } of [ ...fontColor.colors, ...fontBackgroundColor.colors ]) {
            expect(color).toMatch(/^light-dark\(#[0-9a-f]{6},#[0-9a-f]{6}\)$/);
        }
    });

    it("uses the palette's yellow for Markdown highlights", () => {
        const { colors } = buildFontColorConfig().fontBackgroundColor;
        expect(colors.find(({ label }) => label === "Yellow")?.color).toBe(HIGHLIGHT_BACKGROUND);
    });
});
