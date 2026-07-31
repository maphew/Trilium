import { describe, expect, it } from "vitest";

import { getFitPadding, isLightColor, mixColors, toMapType, withAlpha } from "./utils";

describe("mixColors", () => {
    it("takes a colour the given part of the way to another, and gives up on what it cannot read", () => {
        expect(mixColors("#000000", "#ffffff", 0)).toBe("#000000");
        expect(mixColors("#000000", "#ffffff", 1)).toBe("#ffffff");
        expect(mixColors("#000000", "#ffffff", 0.5)).toBe("#808080");
        expect(mixColors("#ff0000", "#0000ff", 0.5)).toBe("#800080");

        // Anything but a plain `#rrggbb` is past mixing: the colour being headed for is answered outright.
        expect(mixColors("red", "#0000ff", 0.5)).toBe("#0000ff");
        expect(mixColors("#000000", "rgb(0, 0, 255)", 0.5)).toBe("rgb(0, 0, 255)");
    });
});

describe("withAlpha", () => {
    it("asks for a colour at an opacity, and leaves alone what cannot carry one", () => {
        expect(withAlpha("#123456", 1)).toBe("#123456ff");
        expect(withAlpha("#123456", 0)).toBe("#12345600");
        expect(withAlpha("#123456", 0.15)).toBe("#12345626");

        // Beyond either end is still one end or the other, rather than a colour a canvas cannot read.
        expect(withAlpha("#123456", 2)).toBe("#123456ff");
        expect(withAlpha("#123456", -1)).toBe("#12345600");

        expect(withAlpha("red", 0.5)).toBe("red");
    });
});

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
