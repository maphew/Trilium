import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { EditorConfig, Translations } from "ckeditor5";

import { buildMessageDictionary } from "./messages.js";

interface LocaleMapping {
    languageCode: string;
    coreTranslation: () => Promise<{ default: Translations }>;
}

const LOCALE_MAPPINGS: Record<DISPLAYABLE_LOCALE_IDS, LocaleMapping | null> = {
    en: null,
    en_rtl: null,
    "en-GB": {
        languageCode: "en-GB",
        coreTranslation: () => import("ckeditor5/translations/en-gb.js"),
    },
    ar: {
        languageCode: "ar",
        coreTranslation: () => import("ckeditor5/translations/ar.js"),
    },
    cn: {
        languageCode: "zh",
        coreTranslation: () => import("ckeditor5/translations/zh-cn.js"),
    },
    cs: {
        languageCode: "cs",
        coreTranslation: () => import("ckeditor5/translations/cs.js"),
    },
    de: {
        languageCode: "de",
        coreTranslation: () => import("ckeditor5/translations/de.js"),
    },
    es: {
        languageCode: "es",
        coreTranslation: () => import("ckeditor5/translations/es.js"),
    },
    fr: {
        languageCode: "fr",
        coreTranslation: () => import("ckeditor5/translations/fr.js"),
    },
    ga: null,
    id: {
        languageCode: "id",
        coreTranslation: () => import("ckeditor5/translations/id.js"),
    },
    it: {
        languageCode: "it",
        coreTranslation: () => import("ckeditor5/translations/it.js"),
    },
    hi: {
        languageCode: "hi",
        coreTranslation: () => import("ckeditor5/translations/hi.js"),
    },
    ja: {
        languageCode: "ja",
        coreTranslation: () => import("ckeditor5/translations/ja.js"),
    },
    ko: {
        languageCode: "ko",
        coreTranslation: () => import("ckeditor5/translations/ko.js"),
    },
    pl: {
        languageCode: "pl",
        coreTranslation: () => import("ckeditor5/translations/pl.js"),
    },
    pt: {
        languageCode: "pt",
        coreTranslation: () => import("ckeditor5/translations/pt.js"),
    },
    pt_br: {
        languageCode: "pt-br",
        coreTranslation: () => import("ckeditor5/translations/pt-br.js"),
    },
    ro: {
        languageCode: "ro",
        coreTranslation: () => import("ckeditor5/translations/ro.js"),
    },
    tw: {
        languageCode: "zh-tw",
        coreTranslation: () => import("ckeditor5/translations/zh.js"),
    },
    uk: {
        languageCode: "uk",
        coreTranslation: () => import("ckeditor5/translations/uk.js"),
    },
    ru: {
        languageCode: "ru",
        coreTranslation: () => import("ckeditor5/translations/ru.js"),
    },
};

/**
 * Build the editor's language configuration: CKEditor's own translations for the locale, plus the
 * dictionary of Trilium-authored strings (see `messages.ts`).
 *
 * The two are separate entries in the `translations` array, and CKEditor merges them in order, so
 * ours wins where both define a message id — which is how an upstream string can be reworded per
 * locale.
 *
 * @param locale the Trilium locale to configure the editor for.
 * @param messages the host's English message catalog (the `text-editor.ck` section) paired with its
 *                 translator. Omit it — a test, a standalone editor — and every Trilium string
 *                 falls back to the English message id passed to `editor.t()`.
 */
export default async function getCkLocale(
    locale: DISPLAYABLE_LOCALE_IDS,
    messages?: { englishMessages: Record<string, string>; translate: (key: string) => string }
): Promise<Pick<EditorConfig, "language" | "translations">> {
    const mapping = LOCALE_MAPPINGS[locale];
    const translations: Translations[] = [];

    // `en`, the `en_rtl` pseudo-locale and `ga` have no CKEditor translation to load; they still get
    // our dictionary, since it also carries any rewording of CKEditor's built-in English strings.
    if (mapping) {
        translations.push((await mapping.coreTranslation()).default);
    }

    if (messages) {
        const dictionary = buildMessageDictionary(messages.englishMessages, messages.translate);
        if (Object.keys(dictionary).length > 0) {
            // Keyed by the language CKEditor will resolve messages under, which is the editor's
            // default (`en`) whenever we pass no `language` below.
            translations.push({ [mapping?.languageCode ?? "en"]: { dictionary } });
        }
    }

    return {
        ...(mapping ? { language: mapping.languageCode } : {}),
        // The empty leading entry is load-bearing. CKEditor merges `translations` with
        // `array.reduce(merge)` and no initial value, so the *first* entry is mutated in place —
        // without the seed our dictionary would be written into the imported
        // `ckeditor5/translations/<lang>.js` module object, which is shared by every editor on the
        // page and would keep applying to editors built with no dictionary at all.
        ...(translations.length > 0 ? { translations: [ {}, ...translations ] } : {})
    };
}
