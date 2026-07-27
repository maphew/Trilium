import { describe, expect, it, vi } from "vitest";

import parser, { extractAttributeDefinitionTypeAndName } from "./promoted_attribute_definition_parser.js";

describe("promoted_attribute_definition_parser.parse", () => {
    it("parses promoted, label type and multiplicity tokens (with surrounding whitespace)", () => {
        const def = parser.parse(" promoted , number , single ");

        expect(def).toEqual({
            isPromoted: true,
            labelType: "number",
            multiplicity: "single"
        });
    });

    it("accepts every supported label type and multi multiplicity", () => {
        const labelTypes = ["text", "textarea", "number", "boolean", "date", "datetime", "time", "url", "color"];
        for (const labelType of labelTypes) {
            expect(parser.parse(labelType)).toEqual({ labelType });
        }

        expect(parser.parse("multi")).toEqual({ multiplicity: "multi" });
    });

    it("parses precision, alias and inverse key=value tokens", () => {
        const def = parser.parse("precision=2,alias=foo,inverse=isChildOf");

        expect(def).toEqual({
            numberPrecision: 2,
            promotedAlias: "foo",
            inverseRelation: "isChildOf"
        });
    });

    it("logs and ignores unrecognized tokens", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        try {
            const def = parser.parse("bogus");
            expect(def).toEqual({});
            expect(logSpy).toHaveBeenCalledWith("Unrecognized attribute definition token:", "bogus");
        } finally {
            logSpy.mockRestore();
        }
    });
});

describe("promoted_attribute_definition_parser.serialize", () => {
    it("writes the promoted flag and its alias, the alias only when promoted", () => {
        expect(parser.serialize({ isPromoted: true, promotedAlias: "Foo" }, "label")).toBe("promoted,alias=Foo,single,text");

        // An alias is meaningless without the flag, so it is left out.
        expect(parser.serialize({ promotedAlias: "Foo" }, "label")).toBe("single,text");
    });

    it("falls back to the multiplicity and label type the consumers assume", () => {
        expect(parser.serialize({}, "label")).toBe("single,text");
        expect(parser.serialize({}, "relation")).toBe("single");
        expect(parser.serialize({ multiplicity: "multi", labelType: "boolean" }, "label")).toBe("multi,boolean");
    });

    it("writes the precision only for a number with one set", () => {
        expect(parser.serialize({ labelType: "number", numberPrecision: 2 }, "label")).toBe("single,number,precision=2");
        expect(parser.serialize({ labelType: "number" }, "label")).toBe("single,number");
        expect(parser.serialize({ labelType: "text", numberPrecision: 2 }, "label")).toBe("single,text");
        // Zero digits is a precision like any other.
        expect(parser.serialize({ labelType: "number", numberPrecision: 0 }, "label")).toBe("single,number,precision=0");
    });

    it("writes the inverse relation for relations only, filtering invalid characters", () => {
        expect(parser.serialize({ inverseRelation: "isChildOf" }, "relation")).toBe("single,inverse=isChildOf");
        expect(parser.serialize({ inverseRelation: "is child#Of!" }, "relation")).toBe("single,inverse=ischildOf");

        // A blank name is dropped, and a label definition has no inverse to write.
        expect(parser.serialize({ inverseRelation: "   " }, "relation")).toBe("single");
        expect(parser.serialize({ inverseRelation: "isChildOf" }, "label")).toBe("single,text");
    });

    it("round-trips through parse without losing settings", () => {
        const labelDefinition = "promoted,alias=Foo,multi,number,precision=2";
        expect(parser.serialize(parser.parse(labelDefinition), "label")).toBe(labelDefinition);

        const relationDefinition = "promoted,single,inverse=isChildOf";
        expect(parser.serialize(parser.parse(relationDefinition), "relation")).toBe(relationDefinition);
    });
});

describe("extractAttributeDefinitionTypeAndName", () => {
    it("extracts the label type and strips the prefix", () => {
        expect(extractAttributeDefinitionTypeAndName("label:TEST:TEST1")).toEqual(["label", "TEST:TEST1"]);
    });

    it("treats anything not starting with label: as a relation", () => {
        expect(extractAttributeDefinitionTypeAndName("relation:author")).toEqual(["relation", "author"]);
    });
});
