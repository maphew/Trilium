import { describe, expect, it } from "vitest";

import {
    adaptColor,
    DEFAULT_ADAPTIVE_COLOR_BANDS,
    joinAdaptiveColorValue,
    splitAdaptiveColorValue,
    toAdaptiveColorValue
} from "./adaptive_color.js";

const HUES = [
    "#e64d4d", "#e6994d", "#e5e64d", "#99e64d", "#4de64d", "#4de699",
    "#4de5e6", "#4d99e6", "#4d4de6", "#994de6", "#e64db3"
];
const GREYS = [ "#000000", "#555555", "#aaaaaa", "#ffffff" ];

/** The Next themes' page background and default text color. */
const PAGE = {
    light: { background: "#ffffff", text: "#000000" },
    dark: { background: "#242424", text: "#cccccc" }
};

describe("adaptColor", () => {
    it("keeps the hue and moves the lightness into each theme's band", () => {
        expect(adaptColor("#e64d4d", "text")).toBe("light-dark(#b81e2c,#ff9f96)");
        expect(adaptColor("#e64d4d", "background")).toBe("light-dark(#ffdad6,#713531)");
        expect(adaptColor("#e5e64d", "background")).toBe("light-dark(#e8e4bd,#494917)");
    });

    it("keeps every palette color readable in both themes", () => {
        const colors = [ ...HUES, ...GREYS ];
        const text = colors.map((color) => pairOf(adaptColor(color, "text")));
        const backgrounds = colors.map((color) => pairOf(adaptColor(color, "background")));

        for (const theme of [ "light", "dark" ] as const) {
            const { background: page, text: defaultText } = PAGE[theme];
            for (const pair of text) {
                expect(contrast(pair[theme], page)).toBeGreaterThanOrEqual(4.5);
            }
            for (const pair of backgrounds) {
                expect(contrast(defaultText, pair[theme])).toBeGreaterThanOrEqual(4.5);
                for (const textPair of text) {
                    expect(contrast(textPair[theme], pair[theme])).toBeGreaterThanOrEqual(4.5);
                }
            }
        }
    });

    it("keeps table borders visible and table backgrounds readable in both themes", () => {
        const colors = [ ...HUES, ...GREYS ];
        const text = colors.map((color) => pairOf(adaptColor(color, "text")));

        for (const theme of [ "light", "dark" ] as const) {
            const { background: page, text: defaultText } = PAGE[theme];
            for (const color of colors) {
                // 3:1 is the WCAG minimum for graphical objects.
                const border = pairOf(adaptColor(color, "tableBorder"))[theme];
                expect(contrast(border, page)).toBeGreaterThanOrEqual(3);

                const cell = pairOf(adaptColor(color, "tableBackground"))[theme];
                expect(contrast(defaultText, cell)).toBeGreaterThanOrEqual(4.5);
                for (const textPair of text) {
                    expect(contrast(textPair[theme], cell)).toBeGreaterThanOrEqual(4.5);
                }
            }
        }

        // A border that is already visible in both themes keeps its color.
        expect(adaptColor("#e64d4d", "tableBorder")).toBe("light-dark(#e64d4d,#e64d4d)");
    });

    it("uses the limits it is given instead of the defaults", () => {
        const bands = {
            ...DEFAULT_ADAPTIVE_COLOR_BANDS,
            text: {
                ...DEFAULT_ADAPTIVE_COLOR_BANDS.text,
                light: { minLightness: 0, maxLightness: 0, maxChroma: Infinity }
            }
        };
        const defaultDark = pairOf(adaptColor("#e64d4d", "text")).dark;
        expect(adaptColor("#e64d4d", "text", bands)).toBe(`light-dark(#000000,${defaultDark})`);
    });

    it("gives each grey a shade of its own in both themes", () => {
        for (const role of [ "text", "background", "tableBorder", "tableBackground" ] as const) {
            const pairs = GREYS.map((grey) => pairOf(adaptColor(grey, role)));
            expect(new Set(pairs.map(({ light }) => light)).size).toBe(GREYS.length);
            expect(new Set(pairs.map(({ dark }) => dark)).size).toBe(GREYS.length);
        }
        expect(adaptColor("#000000", "text")).toBe("light-dark(#000000,#b9b9b9)");
        expect(adaptColor("#ffffff", "text")).toBe("light-dark(#5e5e5e,#ffffff)");
    });

    it("reads hex, rgb() and hsl() in both syntaxes", () => {
        const expected = adaptColor("#e64d4d", "text");
        expect(adaptColor("#E64D4D", "text")).toBe(expected);
        expect(adaptColor("rgb(230, 77, 77)", "text")).toBe(expected);
        expect(adaptColor("rgb(230 77 77)", "text")).toBe(expected);
        expect(adaptColor("#f00", "text")).toBe(adaptColor("#ff0000", "text"));
        expect(adaptColor("rgb(100%, 0%, 0%)", "text")).toBe(adaptColor("#ff0000", "text"));

        // The color picker's output, and the same value after CKEditor strips its spaces.
        const fromPicker = adaptColor("hsl(210, 75%, 60%)", "background");
        expect(fromPicker).toMatch(/^light-dark\(#[0-9a-f]{6},#[0-9a-f]{6}\)$/);
        expect(adaptColor("hsl(210,75%,60%)", "background")).toBe(fromPicker);
        expect(adaptColor("hsl(210deg 75% 60%)", "background")).toBe(fromPicker);
    });

    it("builds the editor's value from the pair and the color as picked, in hex", () => {
        const value = toAdaptiveColorValue("#E64D4D", "text");
        expect(value).toBe("light-dark(#b81e2c,#ff9f96)/*#e64d4d*/");
        expect(toAdaptiveColorValue("rgb(230, 77, 77)", "text")).toBe(value);
        expect(toAdaptiveColorValue("hsl(0, 75%, 60%)", "text")).toMatch(/\/\*#[0-9a-f]{6}\*\/$/);
        expect(splitAdaptiveColorValue(value))
            .toEqual({ color: "light-dark(#b81e2c,#ff9f96)", source: "#e64d4d" });

        // A value that is already built, a plain pair and a color that cannot be adapted stay.
        for (const unchanged of [ value, "light-dark(#b81e2c,#ff9f96)", "red" ]) {
            expect(toAdaptiveColorValue(unchanged, "text")).toBe(unchanged);
        }
        expect(splitAdaptiveColorValue("red")).toEqual({ color: "red" });
    });

    it("joins a loaded pair and color as picked, and ignores anything else", () => {
        expect(joinAdaptiveColorValue("light-dark(#b81e2c,#ff9f96)", "#E64D4D"))
            .toBe("light-dark(#b81e2c,#ff9f96)/*#e64d4d*/");
        expect(joinAdaptiveColorValue("light-dark(#b81e2c,#ff9f96)", "red"))
            .toBe("light-dark(#b81e2c,#ff9f96)");
        expect(joinAdaptiveColorValue("#ff0000", "#e64d4d")).toBe("#ff0000");
    });

    it("returns pairs, alpha colors and unknown values unchanged", () => {
        for (const value of [
            "light-dark(#b81e2c,#ff9f96)", "rgba(0, 0, 0, 0.5)", "rgb(0 0 0 / 50%)",
            "#11223344", "red", "var(--accent)", "#12345", "hsl(none 50% 50%)", ""
        ]) {
            expect(adaptColor(value, "text")).toBe(value);
        }
    });
});

function pairOf(value: string) {
    const match = /^light-dark\((#[0-9a-f]{6}),(#[0-9a-f]{6})\)$/.exec(value);
    expect(match).not.toBeNull();
    return { light: match?.[1] ?? "", dark: match?.[2] ?? "" };
}

function contrast(first: string, second: string) {
    const [ a, b ] = [ luminance(first), luminance(second) ];
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

function luminance(hex: string) {
    const [ r, g, b ] = [ 1, 3, 5 ]
        .map((start) => parseInt(hex.slice(start, start + 2), 16) / 255)
        .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
