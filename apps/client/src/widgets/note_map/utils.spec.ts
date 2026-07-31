import { describe, expect, it } from "vitest";

import { getFitPadding, isLightColor, toMapType } from "./utils";

describe("toMapType", () => {
    it("only reads the tree map out of the label, the link map standing for anything else", () => {
        expect(toMapType("tree")).toBe("tree");
        expect(toMapType("link")).toBe("link");
        expect(toMapType("nonsense")).toBe("link");
        expect(toMapType(null)).toBe("link");
        expect(toMapType(undefined)).toBe("link");
    });
});

describe("isLightColor", () => {
    it("tells the colours a note's icon wants drawing dark over from the ones it wants light", () => {
        expect(isLightColor("#ffffff")).toBe(true);
        expect(isLightColor("#ffff00")).toBe(true);
        expect(isLightColor("#fff")).toBe(true);
        expect(isLightColor("rgb(255, 255, 255)")).toBe(true);

        expect(isLightColor("#000000")).toBe(false);
        // Red reads as dark despite being a bright colour: the eye takes little of its brightness
        // from the red channel, which is what the icon over it has to stand out against.
        expect(isLightColor("#ff0000")).toBe(false);
        expect(isLightColor("#2c4f3d")).toBe(false);
        expect(isLightColor("rgba(0, 0, 0, 0.5)")).toBe(false);

        // Nothing to go on falls back to the light icon drawn over the darker half of the colours.
        expect(isLightColor("nonsense")).toBe(false);
        expect(isLightColor("")).toBe(false);
    });
});

describe("getFitPadding", () => {
    it("crops the sidebar's map the more of it there is to crop, and leaves the others alone", () => {
        // A handful of notes is mostly its labels, which the fit does not measure: given a margin.
        expect(getFitPadding("sidebar", 1)).toBe(20);
        expect(getFitPadding("sidebar", 5)).toBe(20);

        // A crowd is fitted past the edges of its box, the outermost notes cropped.
        expect(getFitPadding("sidebar", 25)).toBe(-25);
        expect(getFitPadding("sidebar", 500)).toBe(-25);

        // Between the two, evenly.
        expect(getFitPadding("sidebar", 15)).toBe(-2.5);

        // The maps with room of their own keep their fixed margins whatever is in them.
        expect(getFitPadding("ribbon", 1)).toBe(50);
        expect(getFitPadding("ribbon", 500)).toBe(50);
        expect(getFitPadding("type", 500)).toBe(30);
        expect(getFitPadding("hoisted", 500)).toBe(30);
    });
});
