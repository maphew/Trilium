import { describe, expect, it } from "vitest";

import { getFitPadding, toMapType } from "./utils";

describe("toMapType", () => {
    it("only reads the tree map out of the label, the link map standing for anything else", () => {
        expect(toMapType("tree")).toBe("tree");
        expect(toMapType("link")).toBe("link");
        expect(toMapType("nonsense")).toBe("link");
        expect(toMapType(null)).toBe("link");
        expect(toMapType(undefined)).toBe("link");
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
