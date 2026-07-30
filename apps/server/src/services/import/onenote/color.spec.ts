import { describe, expect, it } from "vitest";

import { hslToHex, parseHexColor, rgbToHsl } from "./color.js";

describe("parseHexColor", () => {
    it("parses #rrggbb and expands #rgb, tolerating case and whitespace", () => {
        expect(parseHexColor("#1353BA")).toEqual([0x13, 0x53, 0xba]);
        expect(parseHexColor("#333")).toEqual([0x33, 0x33, 0x33]);
        expect(parseHexColor("  #ffffff  ")).toEqual([255, 255, 255]);
    });

    it("rejects anything that isn't a 3- or 6-digit hex color", () => {
        for (const value of ["", "black", "333333", "#33", "#33333", "#3333333", "#33g333", "rgb(0,0,0)"]) {
            expect(parseHexColor(value)).toBeNull();
        }
    });
});

describe("rgbToHsl / hslToHex", () => {
    it("lightness-reflects grays exactly (the near-black ink correction)", () => {
        // #333333 -> #cccccc is the OneNote near-black case; pure black reflects to pure white.
        for (const [input, reflected] of [["#333333", "#cccccc"], ["#404040", "#bfbfbf"], ["#000000", "#ffffff"], ["#ffffff", "#000000"]]) {
            const rgb = parseHexColor(input);
            expect(rgb).not.toBeNull();
            const [hue, saturation, lightness] = rgbToHsl(rgb ?? [0, 0, 0]);
            expect(saturation).toBe(0);
            expect(hslToHex(hue, saturation, 1 - lightness)).toBe(reflected);
        }
    });

    it("preserves hue and saturation when reflecting chromatic colors", () => {
        // One color per hue sector of rgbToHsl, both lightness directions for hslToHex.
        const cases: [string, string][] = [
            ["#800000", "#ff7f7f"], // dark red (red-dominant sector)
            ["#008000", "#7fff7f"], // dark green (green-dominant sector)
            ["#000080", "#7f7fff"], // navy (blue-dominant sector)
            ["#800080", "#ff7fff"], // dark magenta (hue wraps past the top of the wheel)
            ["#ffe6e6", "#190000"] // near-white pink -> dark red (reflected lightness below 0.5)
        ];
        for (const [input, reflected] of cases) {
            const rgb = parseHexColor(input);
            expect(rgb).not.toBeNull();
            const [hue, saturation, lightness] = rgbToHsl(rgb ?? [0, 0, 0]);
            expect(hslToHex(hue, saturation, 1 - lightness)).toBe(reflected);
        }
    });

    it("round-trips a color through rgbToHsl and hslToHex unchanged", () => {
        for (const input of ["#1353ba", "#faf320", "#c62938", "#808080", "#000000"]) {
            const rgb = parseHexColor(input);
            expect(rgb).not.toBeNull();
            const [hue, saturation, lightness] = rgbToHsl(rgb ?? [0, 0, 0]);
            expect(hslToHex(hue, saturation, lightness)).toBe(input);
        }
    });
});
