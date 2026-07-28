import { describe, expect, it, vi } from "vitest";

import parser, {
    extractAttributeDefinitionTypeAndName,
    LABEL_TYPES,
    MULTIPLICITIES
} from "./promoted_attribute_definition_parser.js";

const { parse, serialize } = parser;

/** Runs `fn` with `console.log` silenced, handing it the spy so logged tokens can be asserted. */
function withSilencedLog(fn: (logSpy: ReturnType<typeof vi.spyOn>) => void) {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
        fn(logSpy);
    } finally {
        logSpy.mockRestore();
    }
}

describe("promoted_attribute_definition_parser.parse", () => {
    it("parses the promoted flag, label type and multiplicity, trimming whitespace", () => {
        expect(parse("promoted")).toEqual({ isPromoted: true });
        expect(parse(" promoted , number , single ")).toEqual({
            isPromoted: true,
            labelType: "number",
            multiplicity: "single"
        });
    });

    it("accepts every declared label type and multiplicity", () => {
        // Driven off the exported constants so a newly declared type cannot be left unparsed.
        for (const labelType of LABEL_TYPES) {
            expect(parse(labelType)).toEqual({ labelType });
        }

        for (const multiplicity of MULTIPLICITIES) {
            expect(parse(multiplicity)).toEqual({ multiplicity });
        }
    });

    it("parses the precision, tolerating a malformed or missing one", () => {
        expect(parse("precision=2")).toEqual({ numberPrecision: 2 });
        expect(parse("precision=0")).toEqual({ numberPrecision: 0 });
        // parseInt tolerates trailing characters.
        expect(parse("precision=3px")).toEqual({ numberPrecision: 3 });
        // A missing value yields NaN rather than throwing.
        expect(parse("precision")).toEqual({ numberPrecision: NaN });
    });

    it("parses the promoted alias verbatim, including spaces", () => {
        expect(parse("alias=My Label")).toEqual({ promotedAlias: "My Label" });
        expect(parse("alias=")).toEqual({ promotedAlias: "" });
        // A missing value yields undefined rather than throwing.
        expect(parse("alias")).toEqual({ promotedAlias: undefined });
    });

    it("keeps everything after the first '=' as the value", () => {
        // Splitting on every '=' would truncate these at the second separator.
        expect(parse("alias=a=b")).toEqual({ promotedAlias: "a=b" });
        expect(parse("alias====")).toEqual({ promotedAlias: "===" });
    });

    it("parses the inverse relation, stripping characters a relation name may not hold", () => {
        // Allowed: letters, numbers, underscore and colon.
        expect(parse("inverse=isParentOf")).toEqual({ inverseRelation: "isParentOf" });
        expect(parse("inverse=is:parent_of2")).toEqual({ inverseRelation: "is:parent_of2" });
        // Disallowed characters (spaces, punctuation, dashes) are removed.
        expect(parse("inverse=is parent-of!")).toEqual({ inverseRelation: "isparentof" });
        // A missing value yields an empty name rather than throwing.
        expect(parse("inverse")).toEqual({ inverseRelation: "" });
    });

    it("combines multiple tokens, letting a later token of the same kind win", () => {
        expect(parse("promoted,single,text,precision=4,alias=Foo")).toEqual({
            isPromoted: true,
            multiplicity: "single",
            labelType: "text",
            numberPrecision: 4,
            promotedAlias: "Foo"
        });

        expect(parse("text,number")).toEqual({ labelType: "number" });
        expect(parse("single,multi")).toEqual({ multiplicity: "multi" });
    });

    it("logs and skips an unrecognized token while still parsing the valid ones", () => {
        withSilencedLog((logSpy) => {
            expect(parse("bogus,promoted")).toEqual({ isPromoted: true });
            expect(logSpy).toHaveBeenCalledWith(
                "Unrecognized attribute definition token:", "bogus"
            );
        });
    });

    it("returns an empty definition for an empty value, and tolerates a trailing separator", () => {
        withSilencedLog(() => {
            // An empty string splits into a single empty token, which is unrecognized.
            expect(parse("")).toEqual({});
            expect(parse("promoted,")).toEqual({ isPromoted: true });
        });
    });
});

describe("promoted_attribute_definition_parser.serialize", () => {
    it("writes the promoted flag and its alias, the alias only when promoted", () => {
        expect(serialize({ isPromoted: true, promotedAlias: "Foo" }, "label"))
            .toBe("promoted,alias=Foo,single,text");

        // An alias is meaningless without the flag, so it is left out.
        expect(serialize({ promotedAlias: "Foo" }, "label")).toBe("single,text");
    });

    it("falls back to the multiplicity and label type the consumers assume", () => {
        expect(serialize({}, "label")).toBe("single,text");
        expect(serialize({}, "relation")).toBe("single");
        expect(serialize({ multiplicity: "multi", labelType: "boolean" }, "label"))
            .toBe("multi,boolean");
    });

    it("writes the precision only for a number with one set", () => {
        expect(serialize({ labelType: "number", numberPrecision: 2 }, "label"))
            .toBe("single,number,precision=2");
        expect(serialize({ labelType: "number" }, "label")).toBe("single,number");
        expect(serialize({ labelType: "text", numberPrecision: 2 }, "label")).toBe("single,text");
        // Zero digits is a precision like any other.
        expect(serialize({ labelType: "number", numberPrecision: 0 }, "label"))
            .toBe("single,number,precision=0");
    });

    it("writes the inverse relation for relations only, filtering invalid characters", () => {
        expect(serialize({ inverseRelation: "isChildOf" }, "relation"))
            .toBe("single,inverse=isChildOf");
        expect(serialize({ inverseRelation: "is child#Of!" }, "relation"))
            .toBe("single,inverse=ischildOf");

        // A blank name is dropped, and a label definition has no inverse to write.
        expect(serialize({ inverseRelation: "   " }, "relation")).toBe("single");
        expect(serialize({ inverseRelation: "isChildOf" }, "label")).toBe("single,text");
    });
});

describe("promoted_attribute_definition_parser round-trip", () => {
    it("serializes a parsed definition back to the same value", () => {
        const labelDefinition = "promoted,alias=Foo,multi,number,precision=2";
        expect(serialize(parse(labelDefinition), "label")).toBe(labelDefinition);

        const relationDefinition = "promoted,single,inverse=isChildOf";
        expect(serialize(parse(relationDefinition), "relation")).toBe(relationDefinition);
    });

    it("parses a serialized definition back to the same object, for every label type", () => {
        for (const labelType of LABEL_TYPES) {
            const definition = {
                isPromoted: true, promotedAlias: "Foo", multiplicity: "multi", labelType
            } as const;
            expect(parse(serialize(definition, "label"))).toEqual(definition);
        }
    });
});

describe("extractAttributeDefinitionTypeAndName", () => {
    it("extracts the label type and strips the prefix, keeping colons in the name", () => {
        expect(extractAttributeDefinitionTypeAndName("label:TEST:TEST1"))
            .toEqual([ "label", "TEST:TEST1" ]);
    });

    it("treats anything not starting with label: as a relation", () => {
        expect(extractAttributeDefinitionTypeAndName("relation:author"))
            .toEqual([ "relation", "author" ]);
    });
});
