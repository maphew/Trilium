import { describe, expect, it } from "vitest";

import { buildMessageDictionary, MESSAGE_KEY_PREFIX, slugify, translateMessage } from "./messages.js";

describe("slugify", () => {
    // The punctuation cases matter: `.` separates key paths in i18next, and `"`/`%0` would be
    // awkward in a catalog, so a message id must survive being written as natural English.
    it.each([
        [ "Admonition", "admonition" ],
        [ "Insert a table.", "insert-a-table" ],
        [ "Show all emoji...", "show-all-emoji" ],
        [ "No templates were found matching \"%0\".", "no-templates-were-found-matching-0" ],
        [ "Copy formatting", "copy-formatting" ]
    ])("derives the key for %j", (message, expected) => {
        expect(slugify(message)).toBe(expected);
    });
});

describe("buildMessageDictionary", () => {
    const ENGLISH = { admonition: "Admonition", warning: "Warning" };

    it("maps each English message to its translation", () => {
        const dictionary = buildMessageDictionary(ENGLISH, (key) => `translated:${key}`);

        expect(dictionary).toEqual({
            Admonition: `translated:${MESSAGE_KEY_PREFIX}admonition`,
            Warning: `translated:${MESSAGE_KEY_PREFIX}warning`
        });
    });

    // i18next echoes the key back when an entry is missing. Putting that in the dictionary would
    // render `text-editor.ck.admonition` at the user; skipping it lets CKEditor fall back to the
    // English message id instead.
    it("omits messages whose key the translator does not resolve", () => {
        expect(buildMessageDictionary(ENGLISH, (key) => key)).toEqual({});
        expect(buildMessageDictionary(ENGLISH, () => "")).toEqual({});
        expect(buildMessageDictionary({}, (key) => `translated:${key}`)).toEqual({});
    });
});

describe("translateMessage", () => {
    it("resolves a message id through the host translator", () => {
        expect(translateMessage((key) => `translated:${key}`, "Warning"))
            .toBe(`translated:${MESSAGE_KEY_PREFIX}warning`);
    });

    // The counterpart of `editor.t()`'s fallback, for the code that has no editor: an unresolved
    // key must render the English message id, never `text-editor.ck.…`.
    it("falls back to the English message id", () => {
        expect(translateMessage((key) => key, "Warning")).toBe("Warning");
        expect(translateMessage(() => "", "Warning")).toBe("Warning");
    });

    // `%0`-style placeholders are what CKEditor's own translation function substitutes, so a message
    // reads the same either way — including when it falls back to English.
    it("substitutes %0-style placeholders, in the translation and in the fallback alike", () => {
        expect(translateMessage(() => "Șablon „%0” (%1)", "Template \"%0\" (%1)", [ "Flowchart", "2" ]))
            .toBe("Șablon „Flowchart” (2)");
        expect(translateMessage((key) => key, "Insert %0", [ "Flowchart" ])).toBe("Insert Flowchart");
    });

    // A placeholder with no value is left alone rather than blanked, so a mismatched translation
    // shows the gap instead of silently dropping text.
    it("leaves a placeholder with no corresponding value untouched", () => {
        expect(translateMessage((key) => key, "Insert %0 into %1", [ "Flowchart" ]))
            .toBe("Insert Flowchart into %1");
    });
});
