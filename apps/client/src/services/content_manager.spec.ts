import { describe, expect, it } from "vitest";

import { buildNote } from "../test/easy-froca";
import { buildCategoryQuery, CONTENT_CATEGORIES, isUserContent } from "./content_manager";

describe("buildCategoryQuery", () => {
    it("orders alphabetically by title", () => {
        expect(buildCategoryQuery("#appCss", "title")).toBe("#appCss orderBy note.title");
    });

    it("orders newest first by creation date", () => {
        expect(buildCategoryQuery("#appCss", "dateCreated")).toBe("#appCss orderBy note.dateCreated desc");
    });

    it("keeps the ordering clause at the top level of an OR chain", () => {
        // `orderBy` is rejected by the parser unless it sits on the top expression level, so the
        // filters must not be wrapped in parentheses.
        const query = buildCategoryQuery("#widget OR #disabled:widget", "title");

        expect(query).toBe("#widget OR #disabled:widget orderBy note.title");
        expect(query).not.toContain("(");
    });
});

describe("CONTENT_CATEGORIES", () => {
    it("asks for the disabled counterpart of every attribute it filters on", () => {
        for (const { id, filter } of CONTENT_CATEGORIES) {
            const attributes = filter.match(/[#~](?!disabled:)[\w:]+/g) ?? [];

            expect(attributes.length, `${id} filters on at least one attribute`).toBeGreaterThan(0);

            for (const attribute of attributes) {
                const sigil = attribute[0];
                const disabled = `${sigil}disabled:${attribute.slice(1)}`;

                expect(filter, `${id} also matches ${disabled}`).toContain(disabled);
            }
        }
    });

    it("uses unique ids and distinct filters", () => {
        const ids = CONTENT_CATEGORIES.map((category) => category.id);
        const filters = CONTENT_CATEGORIES.map((category) => category.filter);

        expect(new Set(ids).size).toBe(ids.length);
        expect(new Set(filters).size).toBe(filters.length);
    });

    it("covers the categories the manager is expected to list", () => {
        expect(CONTENT_CATEGORIES.map((category) => category.id)).toEqual([
            "backendScripts",
            "frontendScripts",
            "widgets",
            "renderNotes",
            "themes",
            "customCss",
            "iconPacks",
            "templates",
            "snippets"
        ]);
    });
});

describe("isUserContent", () => {
    it("accepts notes the user created", () => {
        expect(isUserContent(buildNote({ id: "abc123", title: "My script" }))).toBe(true);
    });

    it("rejects built-in notes from the hidden subtree", () => {
        // Their attributes are re-enforced on every startup, so changes made here would be reverted.
        expect(isUserContent(buildNote({ id: "_template_text_snippet", title: "Text Snippet" }))).toBe(false);
        expect(isUserContent(buildNote({ id: "_optionsAppearance", title: "Appearance" }))).toBe(false);
    });
});
