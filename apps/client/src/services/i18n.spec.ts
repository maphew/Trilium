import { MESSAGE_KEY_PREFIX, MESSAGE_OVERRIDES, slugify } from "@triliumnext/ckeditor5";
import { dayjs, findDuplicateJsonKeys, findPluralKeyConflicts, LOCALES } from "@triliumnext/commons";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it, vi } from "vitest";

// Mock the http backend so i18next.init() never hits the network. The real
// backend would try to fetch translation JSON over HTTP and the awaited init()
// would hang until the connection fails. Our fake backend resolves read()
// synchronously with an empty resource bundle.
vi.mock("i18next-http-backend", () => {
    class FakeBackend {
        static type = "backend" as const;
        type = "backend" as const;
        init() {
            // No configuration needed.
        }
        read(_language: string, _namespace: string, callback: (err: unknown, data: unknown) => void) {
            callback(null, {});
        }
    }
    return { default: FakeBackend };
});

const { getAvailableLocales, getCurrentLanguage, getLocaleById, initLocale, translationsInitializedPromise } = await import("./i18n");

/** Resolve a dotted i18next key against a parsed catalog. */
function resolveKey(translations: unknown, key: string): unknown {
    return key.split(".").reduce<unknown>(
        (node, segment) => (node && typeof node === "object" ? (node as Record<string, unknown>)[segment] : undefined),
        translations
    );
}

describe("i18n", () => {
    it("translations are valid JSON with no duplicate keys", () => {
        for (const locale of LOCALES) {
            if (locale.contentOnly || locale.id === "en_rtl") {
                continue;
            }

            const translationPath = join(__dirname, "..", "translations", locale.id, "translation.json");
            const translationFile = readFileSync(translationPath, { encoding: "utf-8" });
            expect(() => JSON.parse(translationFile), `JSON error while parsing locale '${locale.id}' at "${translationPath}"`)
                .not.toThrow();

            const duplicates = findDuplicateJsonKeys(translationFile);
            expect(
                duplicates,
                `Duplicate keys in locale '${locale.id}' at "${translationPath}":\n${
                    duplicates.map((d) => `  - "${d.key}" (line ${d.line})`).join("\n")}`
            ).toEqual([]);

            // Weblate reads these files as i18next JSON v4, where a `_one`/`_other`/… suffix
            // marks a plural form. A section named that way is combined with the key before it
            // into a multistring and breaks the import of the whole file.
            const pluralConflicts = findPluralKeyConflicts(JSON.parse(translationFile));
            expect(
                pluralConflicts,
                `Keys in locale '${locale.id}' at "${translationPath}" that Weblate would read as plural forms but that are not translated strings:\n${
                    pluralConflicts.map((c) => `  - "${c.path}" (plural form '_${c.suffix}')`).join("\n")}`
            ).toEqual([]);
        }
    });

    // The text editor localizes by passing the English text itself to the editor's translation
    // function, and that text resolves to `text-editor.ck.<slug>`. A string with no entry there
    // silently renders its English id in every locale — it is invisible to Weblate, so no
    // translator can ever supply it.
    //
    // Nothing here is declared by hand: the messages are gathered from the editor package's own
    // source, so a translation call added anywhere in any plugin is covered the moment it is
    // written. The check runs in both directions, so a stale or misspelled entry fails too.
    describe("editor messages", () => {
        const translationPath = join(__dirname, "..", "translations", "en", "translation.json");
        const editorSourcePath = join(__dirname, "..", "..", "..", "..", "packages", "ckeditor5", "src");

        // Matches `t("…")` however it is reached — bare, `editor.t(…)`, `this.t(…)`. `\bt\(` only
        // fires where `t` starts a word, so `insert(`, `expect(` and `_t(` are not mistaken for
        // translation calls. The first group captures the opening quote for the backreference.
        const TRANSLATION_CALL = /\bt\(\s*(["'`])((?:\\.|(?!\1).)*)\1/g;

        // A dotted lowercase identifier is a key for the older host-translator bridge, which
        // resolves it against the app catalog directly rather than through a message dictionary.
        // Transitional: this can go once every plugin has moved over.
        const BRIDGE_KEY = /^[a-z0-9_-]+(\.[a-z0-9_-]+)+$/;

        /** Every message id the editor package asks its translation function for. */
        function gatherEditorMessages(): string[] {
            const messages = new Set<string>();

            for (const entry of readdirSync(editorSourcePath, { recursive: true, withFileTypes: true })) {
                if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".spec.ts")) continue;

                const source = readFileSync(join(entry.parentPath, entry.name), { encoding: "utf-8" });
                for (const [ , , body ] of source.matchAll(TRANSLATION_CALL)) {
                    // Un-escape what the source had to escape to sit inside its quotes, so the
                    // result is the message id as the translation function receives it.
                    const message = body.replace(/\\(.)/g, "$1");
                    if (!BRIDGE_KEY.test(message)) {
                        messages.add(message);
                    }
                }
            }

            // Renames of CKEditor's own strings are declared rather than called, and the wording we
            // substitute needs an English entry like any other message.
            for (const replacement of Object.values(MESSAGE_OVERRIDES)) {
                messages.add(replacement);
            }

            return [ ...messages ];
        }

        /**
         * Message ids CKEditor already translates itself. Ours is merged after the core catalog, so
         * an entry for one of these would *override* the upstream translation in every locale —
         * which is a thing we do deliberately (`Bookmark` → `Anchor`), but never by accident. They
         * are recognized rather than listed: a message the German core catalog knows is upstream.
         */
        async function loadUpstreamMessages(): Promise<Set<string>> {
            const core = (await import("ckeditor5/translations/de.js")).default;
            return new Set(Object.keys(core.de.dictionary));
        }

        it("has an English entry for every message the plugins ask for", async () => {
            const translations = JSON.parse(readFileSync(translationPath, { encoding: "utf-8" }));
            const upstream = await loadUpstreamMessages();

            const missing = gatherEditorMessages()
                .filter((message) => !upstream.has(message))
                .map((message) => ({ message, key: MESSAGE_KEY_PREFIX + slugify(message) }))
                .filter(({ key }) => typeof resolveKey(translations, key) !== "string");

            expect(
                missing,
                `Editor messages with no entry in "${translationPath}":\n${
                    missing.map(({ message, key }) => `  - "${message}" → add "${key}"`).join("\n")}`
            ).toEqual([]);
        });

        it("has no English entry that no plugin asks for", () => {
            const translations = JSON.parse(readFileSync(translationPath, { encoding: "utf-8" }));
            const declared = (resolveKey(translations, "text-editor.ck") ?? {}) as Record<string, string>;
            const asked = new Set(gatherEditorMessages());

            const orphaned = Object.entries(declared)
                .filter(([ , english ]) => !asked.has(english))
                .map(([ key, english ]) => `  - "${MESSAGE_KEY_PREFIX}${key}" ("${english}")`);

            expect(
                orphaned,
                `Entries under "${MESSAGE_KEY_PREFIX}" that no editor string uses — the message was renamed or removed:\n${
                    orphaned.join("\n")}`
            ).toEqual([]);
        });
    });

    describe("getAvailableLocales", () => {
        it("returns the full LOCALES list", () => {
            expect(getAvailableLocales()).toBe(LOCALES);
        });
    });

    describe("getLocaleById", () => {
        it("returns null for falsy locale ids", () => {
            expect(getLocaleById(null)).toBeNull();
            expect(getLocaleById(undefined)).toBeNull();
            expect(getLocaleById("")).toBeNull();
        });

        it("returns the matching locale for a known id", () => {
            const locale = getLocaleById("en");
            expect(locale).not.toBeNull();
            expect(locale?.id).toBe("en");
        });

        it("returns null for an unknown id", () => {
            expect(getLocaleById("does-not-exist")).toBeNull();
        });
    });

    describe("initLocale", () => {
        it("initializes i18next with an explicit locale, sets dayjs and resolves the deferred", async () => {
            (window as any).glob = { ...(window as any).glob, assetPath: "/assets" };

            await initLocale("de");

            expect(getCurrentLanguage()).toBe("de");
            // The second responsibility of initLocale is `await setDayjsLocale(locale)`, which
            // switches the global dayjs locale. Assert the observable side effect so removing or
            // mis-passing the locale to setDayjsLocale would be caught.
            expect(dayjs.locale()).toBe("de");
            // The deferred resolves once translations are ready.
            await expect(translationsInitializedPromise).resolves.toBeUndefined();
        });

        it("uses the default 'en' locale when called without arguments", async () => {
            await initLocale();
            expect(getCurrentLanguage()).toBe("en");
        });
    });

    describe("getCurrentLanguage", () => {
        it("reflects the language i18next was last initialized with", async () => {
            await initLocale("en");
            expect(getCurrentLanguage()).toBe("en");
        });
    });
});
