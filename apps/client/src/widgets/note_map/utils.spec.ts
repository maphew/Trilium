import { describe, expect, it } from "vitest";

import { getFitPadding, getHopDistances, mixColors, toMapType, withAlpha } from "./utils";

describe("getHopDistances", () => {
    const link = (source: string, target: string) => ({ source, target });

    it("counts the relations between each note and the one the map is rooted at, whichever way they run", () => {
        // root → near → far, and a relation pointing back at the root rather than away from it.
        const distances = getHopDistances("root", [ link("root", "near"), link("near", "far"), link("pointsAtRoot", "root") ]);

        expect(distances.get("root")).toBe(0);
        expect(distances.get("near")).toBe(1);
        expect(distances.get("far")).toBe(2);
        // Being pointed at is as near as pointing to.
        expect(distances.get("pointsAtRoot")).toBe(1);
    });

    it("keeps the shortest way to a note, and leaves out what cannot be reached at all", () => {
        // "far" is two hops one way round and one the other.
        const distances = getHopDistances("root", [ link("root", "near"), link("near", "far"), link("root", "far") ]);
        expect(distances.get("far")).toBe(1);

        expect(getHopDistances("root", [ link("root", "near"), link("alone", "elsewhere") ]).has("alone")).toBe(false);
    });

    it("has nothing to measure where the map is not rooted at one of its own notes", () => {
        // A search note is not among its own results, so its map has no note to be rooted at.
        expect(getHopDistances("search", [ link("result", "other") ]).size).toBe(0);
    });

    it("reads the ends of a relation once the graph has looked them up", () => {
        // The graph swaps each end for the note it stands for, in place, once it has the data.
        const distances = getHopDistances("root", [ { source: { id: "root" }, target: { id: "near" } } ]);
        expect(distances.get("near")).toBe(1);
    });
});

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
