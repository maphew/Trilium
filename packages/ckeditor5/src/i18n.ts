import { DISPLAYABLE_LOCALE_IDS } from "@triliumnext/commons";
import { EditorConfig, Translations } from "ckeditor5";

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

export default async function getCkLocale(locale: DISPLAYABLE_LOCALE_IDS): Promise<Pick<EditorConfig, "language" | "translations">> {
    const mapping = LOCALE_MAPPINGS[locale];
    if (!mapping) return {};

    const coreTranslation = (await (mapping.coreTranslation())).default;
    return {
        language: mapping.languageCode,
        translations: [ coreTranslation ]
    };
}
