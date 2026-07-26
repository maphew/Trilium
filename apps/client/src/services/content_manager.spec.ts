import { afterEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import attributeService from "./attributes";
import {
    buildCategoryQuery,
    CONTENT_CATEGORIES,
    type ContentCategory,
    findCategoryNotes,
    isCategoryEnabled,
    isUserContent,
    parseFilterTriggers,
    resolveProperties,
    setCategoryEnabled
} from "./content_manager";
import searchService from "./search";

afterEach(() => vi.restoreAllMocks());

function categoryById(id: string) {
    const category = CONTENT_CATEGORIES.find((candidate) => candidate.id === id);
    if (!category) throw new Error(`Unknown category '${id}'`);
    return category;
}

describe("buildCategoryQuery", () => {
    it("orders alphabetically by title, then by note ID", () => {
        expect(buildCategoryQuery("#appCss", "title")).toBe("#appCss orderBy note.title, note.noteId");
    });

    it("orders newest first by creation date, then by note ID", () => {
        expect(buildCategoryQuery("#appCss", "dateCreated")).toBe("#appCss orderBy note.dateCreated desc, note.noteId");
    });

    it("always breaks ties on note ID so the order never shifts between refreshes", () => {
        for (const sortOrder of [ "title", "dateCreated" ] as const) {
            expect(buildCategoryQuery("#appCss", sortOrder)).toMatch(/, note\.noteId$/);
        }
    });

    it("keeps the ordering clause at the top level of an OR chain", () => {
        // `orderBy` is rejected by the parser unless it sits on the top expression level, so the
        // filters must not be wrapped in parentheses.
        const query = buildCategoryQuery("#widget OR #disabled:widget", "title");

        expect(query).toBe("#widget OR #disabled:widget orderBy note.title, note.noteId");
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
            "templates",
            "snippets",
            "iconPacks",
            "themes",
            "customCss",
            "sharing",
            "frontendScripts",
            "widgets",
            "renderNotes",
            "eventHandlers",
            "endpoints",
            "backendScripts"
        ]);
    });
});

describe("parseFilterTriggers", () => {
    it("reads attribute names off a filter, ignoring values and the disabled: spelling", () => {
        expect(parseFilterTriggers("#run = hourly OR #disabled:run = hourly")).toEqual([
            { type: "label", name: "run" }
        ]);
    });

    it("distinguishes labels from relations", () => {
        expect(parseFilterTriggers("~renderNote OR ~disabled:renderNote OR #webViewSrc")).toEqual([
            { type: "relation", name: "renderNote" },
            { type: "label", name: "webViewSrc" }
        ]);
    });

    it("returns nothing for a filter naming no attributes", () => {
        expect(parseFilterTriggers("")).toEqual([]);
    });

    it("finds the triggers of every real category", () => {
        expect(parseFilterTriggers(categoryById("snippets").filter)).toEqual([
            { type: "label", name: "snippet" },
            { type: "label", name: "textSnippet" }
        ]);
        expect(parseFilterTriggers(categoryById("backendScripts").filter)).toEqual([
            { type: "label", name: "run" }
        ]);
    });
});

describe("isCategoryEnabled", () => {
    const scripts = categoryById("backendScripts");
    const widgets = categoryById("widgets");

    it("reports an enabled trigger as on and a disabled one as off", () => {
        expect(isCategoryEnabled(buildNote({ title: "Live", "#run": "hourly" }), scripts)).toBe(true);
        expect(isCategoryEnabled(buildNote({ title: "Paused", "#disabled:run": "hourly" }), scripts)).toBe(false);
    });

    it("only considers the triggers of the category asked about", () => {
        // The note is a live widget but a disabled backend script; each row answers for itself.
        const note = buildNote({ title: "Both", "#widget": "", "#disabled:run": "daily" });

        expect(isCategoryEnabled(note, widgets)).toBe(true);
        expect(isCategoryEnabled(note, scripts)).toBe(false);
    });

    it("is off for a note carrying none of the category's triggers", () => {
        expect(isCategoryEnabled(buildNote({ title: "Plain" }), scripts)).toBe(false);
    });

    it("counts the note as on while any one of its triggers is still live", () => {
        const note = buildNote({ title: "Mixed", "#run": "daily", "#disabled:customRequestHandler": "api/x" });

        expect(isCategoryEnabled(note, scripts)).toBe(true);
    });
});

describe("resolveProperties", () => {
    const triggers: ContentCategory = {
        id: "test",
        titleKey: "unused",
        filter: "#run OR #disabled:run",
        properties: [ {
            titleKey: "prop.trigger",
            values: [
                { titleKey: "value.hourly", condition: { label: "run", is: "hourly" } },
                { titleKey: "value.daily", condition: { label: "run", is: "daily" } },
                { titleKey: "value.other", condition: { label: "run", isNot: [ "hourly", "daily" ] } }
            ]
        } ]
    };

    it("returns each matching value, so several triggers read as a list", () => {
        const note = buildNote({ title: "Both", "#run": "hourly" });

        expect(resolveProperties(note, triggers)).toEqual([
            { titleKey: "prop.trigger", values: [ { titleKey: "value.hourly" } ] }
        ]);
    });

    it("still describes a disabled item, matching through the disabled: prefix", () => {
        // The detail explaining what an item does is most useful precisely when it is switched off.
        const note = buildNote({ title: "Paused", "#disabled:run": "daily" });

        expect(resolveProperties(note, triggers)).toEqual([
            { titleKey: "prop.trigger", values: [ { titleKey: "value.daily" } ] }
        ]);
    });

    it("honours isNot, and requires the label to be present at all", () => {
        const other = buildNote({ title: "Custom", "#run": "weekly" });
        const absent = buildNote({ title: "None" });

        expect(resolveProperties(other, triggers)).toEqual([
            { titleKey: "prop.trigger", values: [ { titleKey: "value.other" } ] }
        ]);
        expect(resolveProperties(absent, triggers)).toEqual([]);
    });

    it("reads a label's own value, skipping the property when it is missing or blank", () => {
        const category: ContentCategory = {
            id: "themes",
            titleKey: "unused",
            filter: "#appTheme",
            properties: [ { titleKey: "prop.base", values: [ { valueOfLabel: "appThemeBase" } ] } ]
        };

        expect(resolveProperties(buildNote({ title: "T", "#appThemeBase": "next-dark" }), category)).toEqual([
            { titleKey: "prop.base", values: [ { text: "next-dark" } ] }
        ]);
        expect(resolveProperties(buildNote({ title: "T", "#appThemeBase": "  " }), category)).toEqual([]);
        expect(resolveProperties(buildNote({ title: "T" }), category)).toEqual([]);
    });

    it("describes the instance restriction and the workspace scope of real categories", () => {
        const script = buildNote({ title: "S", "#run": "daily", "#runOnInstance": "main" });

        expect(resolveProperties(script, categoryById("backendScripts"))).toEqual([
            { titleKey: "content_manager.property_trigger", values: [ { titleKey: "content_manager.trigger_daily" } ] },
            { titleKey: "content_manager.property_instance", values: [ { text: "main" } ] }
        ]);

        // The bare `workspaceTemplate` condition is a presence test, so an unrestricted template
        // shows no scope at all.
        const workspace = buildNote({ title: "W", "#template": "", "#workspaceTemplate": "" });
        const plain = buildNote({ title: "P", "#template": "" });

        expect(resolveProperties(workspace, categoryById("templates"))).toEqual([
            { titleKey: "content_manager.property_scope", values: [ { titleKey: "content_manager.scope_workspace" } ] }
        ]);
        expect(resolveProperties(plain, categoryById("templates"))).toEqual([]);
    });

    it("matches relations, listing every event a note handles", () => {
        const note = buildNote({
            title: "Handler",
            "~runOnNoteCreation": "script1",
            "~disabled:runOnBranchDeletion": "script2"
        });

        expect(resolveProperties(note, categoryById("eventHandlers"))).toEqual([ {
            titleKey: "content_manager.property_event",
            values: [
                { titleKey: "content_manager.event_note_creation" },
                { titleKey: "content_manager.event_branch_deletion" }
            ]
        } ]);
    });

    it("does not confuse a label with a relation of the same name", () => {
        // `widget` exists as both; a relation condition must not be satisfied by the label.
        const category: ContentCategory = {
            id: "test",
            titleKey: "unused",
            filter: "~widget",
            properties: [ { titleKey: "prop.k", values: [ { titleKey: "v.rel", condition: { relation: "widget" } } ] } ]
        };

        expect(resolveProperties(buildNote({ title: "L", "#widget": "" }), category)).toEqual([]);
        expect(resolveProperties(buildNote({ title: "R", "~widget": "abc" }), category)).toEqual([
            { titleKey: "prop.k", values: [ { titleKey: "v.rel" } ] }
        ]);
    });

    it("shows an endpoint's kind and its path pattern", () => {
        const note = buildNote({ title: "API", "#customRequestHandler": "api/my-handler/([a-z]+)" });

        expect(resolveProperties(note, categoryById("endpoints"))).toEqual([
            { titleKey: "content_manager.property_kind", values: [ { titleKey: "content_manager.endpoint_request_handler" } ] },
            { titleKey: "content_manager.property_path", values: [ { text: "api/my-handler/([a-z]+)" } ] }
        ]);
    });

    it("skips a value whose condition names neither a label nor a relation", () => {
        const category: ContentCategory = {
            id: "test",
            titleKey: "unused",
            filter: "#anything",
            properties: [ { titleKey: "prop.k", values: [ { titleKey: "v", condition: {} } ] } ]
        };

        expect(resolveProperties(buildNote({ title: "X", "#anything": "" }), category)).toEqual([]);
    });

    it("ignores a value that specifies neither a title nor a label to read", () => {
        const category: ContentCategory = {
            id: "test",
            titleKey: "unused",
            filter: "#anything",
            properties: [ { titleKey: "prop.k", values: [ {} ] } ]
        };

        expect(resolveProperties(buildNote({ title: "X", "#anything": "" }), category)).toEqual([]);
    });

    it("returns nothing for a category that declares no properties", () => {
        expect(resolveProperties(buildNote({ title: "X", "#appCss": "" }), categoryById("customCss"))).toEqual([]);
    });
});

describe("setCategoryEnabled", () => {
    function spyOnToggle() {
        return vi.spyOn(attributeService, "toggleDangerousAttribute").mockResolvedValue(undefined);
    }

    it("renames only the triggers of the category, leaving the note's other capabilities alone", async () => {
        // The whole point of toggling per category: this note is both a widget and a backend script.
        const toggle = spyOnToggle();
        const note = buildNote({ title: "Both", "#widget": "", "#run": "daily" });

        await setCategoryEnabled(note, categoryById("widgets"), false);

        expect(toggle).toHaveBeenCalledTimes(1);
        expect(toggle).toHaveBeenCalledWith(note, "label", "widget", false);
    });

    it("toggles relation triggers as relations", async () => {
        const toggle = spyOnToggle();
        const note = buildNote({ title: "Render", "~renderNote": "abc123" });

        await setCategoryEnabled(note, categoryById("renderNotes"), false);

        expect(toggle).toHaveBeenCalledWith(note, "relation", "renderNote", false);
    });

    it("writes back the canonical name when re-enabling a disabled trigger", async () => {
        const toggle = spyOnToggle();
        const note = buildNote({ title: "Paused", "#disabled:widget": "" });

        await setCategoryEnabled(note, categoryById("widgets"), true);

        expect(toggle).toHaveBeenCalledWith(note, "label", "widget", true);
    });

    it("toggles each distinct trigger once, even with several attributes of the same name", async () => {
        const toggle = spyOnToggle();
        const note = buildNote({ title: "Two triggers", "#run": "hourly" });

        await setCategoryEnabled(note, categoryById("backendScripts"), false);

        expect(toggle).toHaveBeenCalledTimes(1);
    });

    it("does nothing when the note carries none of the category's triggers", async () => {
        const toggle = spyOnToggle();

        await setCategoryEnabled(buildNote({ title: "Plain" }), categoryById("widgets"), false);

        expect(toggle).not.toHaveBeenCalled();
    });
});

describe("findCategoryNotes", () => {
    it("runs the category's ordered query and drops built-in notes", async () => {
        const mine = buildNote({ id: "mine123", title: "My theme" });
        const builtIn = buildNote({ id: "_builtInTheme", title: "Built-in" });
        const search = vi.spyOn(searchService, "searchForNotes").mockResolvedValue([ mine, builtIn ]);
        const category = categoryById("themes");

        const notes = await findCategoryNotes(category, "title");

        expect(search).toHaveBeenCalledWith(buildCategoryQuery(category.filter, "title"));
        expect(notes).toEqual([ mine ]);
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
