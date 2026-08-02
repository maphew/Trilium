import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import getCkLocale from "./i18n.js";

describe("getCkLocale", () => {
    // "en" needs no translation at all, while "en_rtl" (a dev-only pseudo-locale) and "ga" have no
    // CKEditor translation to load — all three fall back to the editor's built-in English strings.
    it.each<DISPLAYABLE_LOCALE_IDS>([ "en", "en_rtl", "ga" ])("returns an empty config for '%s'", async (locale) => {
        expect(await getCkLocale(locale)).toEqual({});
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
        // A single entry: the GPL core translations. The premium bundle used to add a second one,
        // but no premium plugin is loaded any more.
        const translations = result.translations;
        if (!Array.isArray(translations)) throw new Error("expected an array of translations");
        expect(translations).toHaveLength(1);
        expect(typeof translations[0]).toBe("object");
    });
});
