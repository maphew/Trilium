import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { Essentials, Paragraph, SplitButtonView } from "ckeditor5";
import { describe, expect, it } from "vitest";

import { createTestEditor } from "../test/editor-kit.js";
import getCkLocale from "./i18n.js";
import { MESSAGE_KEY_PREFIX } from "./messages.js";
import Admonition from "./plugins/admonition/admonition.js";
import AdmonitionUI from "./plugins/admonition/admonition_ui.js";

/**
 * A translator that resolves only the admonition button, echoing every other key back the way
 * i18next does for a missing entry — so the assertions below pin one dictionary entry rather than
 * tracking the whole message list.
 */
function translateAdmonitionOnly(translation: string) {
    return (key: string) => (key === "text-editor.ck.admonition" ? translation : key);
}

interface AdmonitionDropdown {
    isOpen: boolean;
    buttonView: SplitButtonView;
    panelView: {
        children: {
            get(index: number): {
                items: { length: number; get(index: number): { children: { get(index: number): { label?: string } } } };
            } | null;
        };
    };
}

/**
 * Open the dropdown — `addListToDropdown` only populates the panel on first open — and read the
 * label of every admonition type entry.
 */
function readTypeLabels(dropdown: AdmonitionDropdown): string[] {
    dropdown.isOpen = true;
    const listView = dropdown.panelView.children.get(0);
    if (!listView) throw new Error("expected the type list to be populated");

    const labels: string[] = [];
    for (let index = 0; index < listView.items.length; index++) {
        labels.push(listView.items.get(index).children.get(0).label ?? "");
    }
    return labels;
}

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
        const { language, translations } = await getCkLocale("de", translateAdmonitionOnly("Ermahnung"));

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

        await getCkLocale("de", translateAdmonitionOnly("Ermahnung"));

        expect(coreEntry.de.dictionary).not.toHaveProperty("Admonition");
    });

    // A locale with no CKEditor translation still needs the dictionary, since it also carries any
    // rewording of the editor's built-in English strings.
    it("supplies a dictionary keyed 'en' for locales with no core translation", async () => {
        const { language, translations } = await getCkLocale("ga", translateAdmonitionOnly("Rabhadh"));

        expect(language).toBeUndefined();
        expect(translations).toEqual([ {}, { en: { dictionary: { Admonition: "Rabhadh" } } } ]);
    });

    // An unresolved key yields an empty dictionary, which must not be pushed as a translations
    // entry — an empty dictionary for a locale would otherwise shadow nothing but still allocate.
    it("omits the dictionary when the translator resolves nothing", async () => {
        expect(await getCkLocale("ga", (key) => key)).toEqual({});
    });

    // End-to-end over a real editor: `AdmonitionUI` localizes with plain `editor.t("Admonition")`,
    // knowing nothing about translation keys or the host, and the only thing that makes it Romanian
    // is the dictionary configured here.
    describe("applied to an editor", () => {
        const RO_MESSAGES: Record<string, string> = {
            admonition: "Casetă de avertizare",
            caution: "Atenție",
            important: "Important",
            note: "Notă",
            tip: "Sfat",
            warning: "Avertisment"
        };
        const translateToRomanian = (key: string) => RO_MESSAGES[key.replace(MESSAGE_KEY_PREFIX, "")] ?? key;

        async function createAdmonitionDropdown(localeConfig: Awaited<ReturnType<typeof getCkLocale>>) {
            const editor = await createTestEditor([ Essentials, Paragraph, Admonition, AdmonitionUI ], localeConfig);
            return editor.ui.componentFactory.create("admonition") as unknown as AdmonitionDropdown;
        }

        it("translates the button and every type entry through the host translator", async () => {
            const dropdown = await createAdmonitionDropdown(await getCkLocale("ro", translateToRomanian));

            expect(dropdown.buttonView.label).toBe("Casetă de avertizare");
            expect(readTypeLabels(dropdown)).toEqual([ "Notă", "Sfat", "Important", "Atenție", "Avertisment" ]);
        });

        // What makes the mechanism seamless: with no host attached the editor still renders correct
        // English, because the message id passed to `t()` *is* the English text. Same for a
        // configured translator that cannot resolve the key.
        it.each([
            [ "no translator is configured", undefined ],
            [ "the translation is missing", (key: string) => key ]
        ])("falls back to the English message ids when %s", async (_case, translate) => {
            const dropdown = await createAdmonitionDropdown(await getCkLocale("ro", translate));

            expect(dropdown.buttonView.label).toBe("Admonition");
            expect(readTypeLabels(dropdown)).toEqual([ "Note", "Tip", "Important", "Caution", "Warning" ]);
        });
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
