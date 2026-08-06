import { beforeEach, describe, expect, it, vi } from "vitest";

import { isContentRightToLeft, resolveContentLanguage } from "./content_language.js";

const optionsState = vi.hoisted(() => ({ map: {} as Record<string, string | undefined> }));

vi.mock("./options.js", () => ({
    default: {
        get: (name: string) => optionsState.map[name]
    }
}));

beforeEach(() => {
    optionsState.map = {};
});

describe("resolveContentLanguage", () => {
    it("prefers the note's own language over the configured default", () => {
        optionsState.map.defaultContentLanguage = "fr";
        optionsState.map.locale = "ru";

        expect(resolveContentLanguage("de")).toBe("de");
    });

    it("falls back to the default content language, then to the application's language", () => {
        optionsState.map.defaultContentLanguage = "fr";
        optionsState.map.locale = "ru";

        expect(resolveContentLanguage(null)).toBe("fr");
        expect(resolveContentLanguage(undefined)).toBe("fr");
        expect(resolveContentLanguage("")).toBe("fr");

        // An empty default is the "auto" entry, meaning follow the application's language rather
        // than meaning no language at all.
        optionsState.map.defaultContentLanguage = "";
        expect(resolveContentLanguage(null)).toBe("ru");
    });

    it("returns null only when nothing at all is configured", () => {
        expect(resolveContentLanguage(null)).toBeNull();
    });
});

describe("isContentRightToLeft", () => {
    it("follows the note's own language", () => {
        expect(isContentRightToLeft("he")).toBe(true);
        expect(isContentRightToLeft("de")).toBe(false);
    });

    it("applies the default to a note that has no language of its own", () => {
        optionsState.map.defaultContentLanguage = "ar";
        expect(isContentRightToLeft(null)).toBe(true);

        // ...and a note that does have one is not dragged along by it.
        expect(isContentRightToLeft("de")).toBe(false);
    });

    it("treats an unknown or missing language as left-to-right", () => {
        expect(isContentRightToLeft(null)).toBe(false);
        expect(isContentRightToLeft("not-a-locale")).toBe(false);
    });
});
