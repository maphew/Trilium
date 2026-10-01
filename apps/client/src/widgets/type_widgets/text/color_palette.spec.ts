import {
    DEFAULT_ADAPTIVE_COLOR_BANDS as DEFAULTS,
    HIGHLIGHT_BACKGROUND,
    HIGHLIGHT_SOURCE,
    splitAdaptiveColorValue,
    toAdaptiveColorValue
} from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

import { DEFAULT_COLOR_PALETTE } from "../../react/ColorPicker.js";
import { buildFontColorConfig, buildTableColorConfig } from "./color_palette.js";

vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key }));

const SOURCES = [ "#000000", "#555555", "#aaaaaa", "#ffffff", ...DEFAULT_COLOR_PALETTE ];
const LABELS = [
    "Black", "Dim grey", "Light grey", "White",
    "Red", "Orange", "Yellow", "Light green", "Green", "Aquamarine", "Turquoise",
    "Light blue", "Blue", "Purple", "text-editor.colors.pink"
];

describe("buildFontColorConfig", () => {
    it("lists four greys, then every note color hue, four to a row", () => {
        for (const palette of Object.values(buildFontColorConfig(DEFAULTS))) {
            expect(palette.columns).toBe(4);
            expect(palette.colors.map(({ label }) => label)).toEqual(LABELS);
        }
    });

    it("stores each swatch as its role's pair and the color as picked, without spaces", () => {
        const { fontColor, fontBackgroundColor } = buildFontColorConfig(DEFAULTS);
        expect(fontColor.colors.map(({ color }) => color))
            .toEqual(SOURCES.map((color) => toAdaptiveColorValue(color, "text")));
        expect(fontBackgroundColor.colors.map(({ color }) => color))
            .toEqual(SOURCES.map((color) => toAdaptiveColorValue(color, "background")));

        // CKEditor strips spaces from a color when a note loads, and matches swatches exactly.
        for (const { color } of [ ...fontColor.colors, ...fontBackgroundColor.colors ]) {
            expect(color).toMatch(/^light-dark\(#[0-9a-f]{6},#[0-9a-f]{6}\)\/\*#[0-9a-f]{6}\*\/$/);
        }
    });

    it("turns the swatches into pairs with the theme's limits", () => {
        const bands = {
            ...DEFAULTS,
            background: {
                ...DEFAULTS.background,
                dark: { minLightness: 0, maxLightness: 20, maxChroma: 10 }
            }
        };
        const { colors } = buildFontColorConfig(bands).fontBackgroundColor;
        expect(colors.map(({ color }) => color))
            .toEqual(SOURCES.map((color) => toAdaptiveColorValue(color, "background", bands)));
        expect(colors[4].color).not.toBe(toAdaptiveColorValue(SOURCES[4], "background"));
    });

    it("matches the Markdown highlight's yellow with the default limits", () => {
        const { colors } = buildFontColorConfig(DEFAULTS).fontBackgroundColor;
        const yellow = colors.find(({ label }) => label === "Yellow")?.color ?? "";
        expect(splitAdaptiveColorValue(yellow))
            .toEqual({ color: HIGHLIGHT_BACKGROUND, source: HIGHLIGHT_SOURCE });
    });
});

describe("buildTableColorConfig", () => {
    it("gives table and cell borders and backgrounds the same swatches, as plain colors", () => {
        const { tableProperties, tableCellProperties } = buildTableColorConfig();
        for (const colors of [
            tableProperties.borderColors, tableProperties.backgroundColors,
            tableCellProperties.borderColors, tableCellProperties.backgroundColors
        ]) {
            expect(colors.map(({ label }) => label)).toEqual(LABELS);
            expect(colors.map(({ color }) => color)).toEqual(SOURCES);
        }
    });
});
