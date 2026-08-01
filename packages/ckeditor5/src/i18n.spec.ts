import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import getCkLocale from "./i18n.js";

describe("getCkLocale", () => {
    // "en" needs no translation at all, while "en_rtl" (a dev-only pseudo-locale) and "ga" have no
    // CKEditor translation to load — all three fall back to the editor's built-in English strings.
    it.each<DISPLAYABLE_LOCALE_IDS>([ "en", "en_rtl", "ga" ])("returns an empty config for '%s'", async (locale) => {
        expect(await getCkLocale(locale)).toEqual({});
    });

    // Without a host translator (a test, or a standalone editor) nothing is configured beyond
    // CKEditor's own translations: plugins fall back to the English message ids they pass to `t()`.
    it("adds no dictionary when no translator is given", async () => {
        const { translations } = await getCkLocale("de");

        // The merge seed plus CKEditor's own translations, and nothing of ours.
        expect(translations).toHaveLength(2);
    });

    it("appends the Trilium dictionary after the core translations", async () => {
        const { language, translations } = await getCkLocale("de", () => "Ermahnung");

        expect(language).toBe("de");
        if (!Array.isArray(translations)) throw new Error("expected an array of translations");
        // Seed, core translations, ours — ours last, so it wins for any message id both define.
        expect(translations).toHaveLength(3);
        expect(translations[0]).toEqual({});
        expect(translations[2]).toEqual({ de: { dictionary: { Admonition: "Ermahnung" } } });
    });

    // CKEditor merges the `translations` array in place via `reduce(merge)`, so a missing seed
    // would write our dictionary into the shared `ckeditor5/translations/<lang>.js` module object
    // and leak it into every other editor on the page.
    it("does not mutate the imported core translations", async () => {
        const before = await getCkLocale("de");
        if (!Array.isArray(before.translations)) throw new Error("expected an array of translations");
        const coreEntry = before.translations[1] as Record<string, { dictionary: Record<string, string> }>;

        await getCkLocale("de", () => "Ermahnung");

        expect(coreEntry.de.dictionary).not.toHaveProperty("Admonition");
    });

    // A locale with no CKEditor translation still needs the dictionary, since it also carries any
    // rewording of the editor's built-in English strings.
    it("supplies a dictionary keyed 'en' for locales with no core translation", async () => {
        const { language, translations } = await getCkLocale("ga", () => "Rabhadh");

        expect(language).toBeUndefined();
        expect(translations).toEqual([ {}, { en: { dictionary: { Admonition: "Rabhadh" } } } ]);
    });

    // An unresolved key yields an empty dictionary, which must not be pushed as a translations
    // entry — an empty dictionary for a locale would otherwise shadow nothing but still allocate.
    it("omits the dictionary when the translator resolves nothing", async () => {
        expect(await getCkLocale("ga", (key) => key)).toEqual({});
    });

    // The CKEditor language code often differs from Trilium's locale id, so pin the mapping for
    // every locale rather than only the ones that happen to match.
    it.each<[DISPLAYABLE_LOCALE_IDS, string]>([
        [ "en-GB", "en-GB" ],
        [ "ar", "ar" ],
        [ "cn", "zh" ],
        [ "cs", "cs" ],
        [ "de", "de" ],
        [ "es", "es" ],
        [ "fr", "fr" ],
        [ "id", "id" ],
        [ "it", "it" ],
        [ "hi", "hi" ],
        [ "ja", "ja" ],
        [ "ko", "ko" ],
        [ "pl", "pl" ],
        [ "pt", "pt" ],
        [ "pt_br", "pt-br" ],
        [ "ro", "ro" ],
        [ "tw", "zh-tw" ],
        [ "uk", "uk" ],
        [ "ru", "ru" ]
    ])("maps '%s' to CKEditor language '%s' and loads its translation", async (locale, languageCode) => {
        const result = await getCkLocale(locale);

        expect(result.language).toBe(languageCode);
        // The merge seed and the GPL core translations. The premium bundle used to add another
        // entry, but no premium plugin is loaded any more; this call passes no translator, so the
        // Trilium dictionary is absent too.
        const translations = result.translations;
        if (!Array.isArray(translations)) throw new Error("expected an array of translations");
        expect(translations).toHaveLength(2);
        expect(typeof translations[1]).toBe("object");
    });
});
