/**
 * Trilium-authored editor strings, and the bridge that gets them translated.
 *
 * Plugins localize with CKEditor's own `editor.t("English text")` — no host configuration, no
 * translation keys in plugin code. When nothing supplies a dictionary (a test, a standalone
 * editor), `t()` falls back to the message id itself, which *is* the English text, so the UI is
 * always correct rather than showing a raw key.
 *
 * To actually translate those strings, the host hands {@link buildMessageDictionary} a translator
 * (the client passes i18next's `t`) and the resulting dictionary is appended to the editor's
 * `translations` config in `i18n.ts`. The i18next key is *derived* from the English text by
 * {@link slugify}, so there is no message-id-to-key mapping to maintain: every string is written
 * once, at the call site.
 *
 * The same mechanism can reword CKEditor's own strings — listing an upstream message id here
 * overrides the built-in translation for every locale, because our dictionary is merged after the
 * core one.
 */

/** Prefix for the i18next keys this package's messages resolve to. */
export const MESSAGE_KEY_PREFIX = "text-editor.ck.";

/**
 * Every English message id the editor package owns, i.e. each distinct string passed to
 * `editor.t()` by a Trilium plugin (plus any upstream string we deliberately reword).
 *
 * Draft scope: only the admonition button. The remaining plugins still localize through the older
 * `config.translate` bridge and are migrated separately.
 */
export const MESSAGES = [
    "Admonition"
] as const;

/**
 * Derive the i18next key for a message id: lowercase, with every run of non-alphanumeric
 * characters collapsed into a single dash. Punctuation that would otherwise be significant in an
 * i18next key (`.` separates key paths) or awkward in a catalog (`"`, `%0`) disappears, so message
 * ids can be written as natural English.
 *
 * `"Insert a table."` becomes `text-editor.ck.insert-a-table`.
 */
export function slugify(message: string): string {
    return message
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}

/**
 * Build the CKEditor dictionary for {@link MESSAGES} using the host's translator.
 *
 * A message is only included when the translator actually resolves its key. i18next echoes the key
 * back for a missing entry, so an unresolved message would otherwise put `text-editor.ck.…` in the
 * dictionary and render that key at the user; skipping it instead lets CKEditor fall back to the
 * English message id.
 */
export function buildMessageDictionary(translate: (key: string) => string): Record<string, string> {
    const dictionary: Record<string, string> = {};

    for (const message of MESSAGES) {
        const key = MESSAGE_KEY_PREFIX + slugify(message);
        const translated = translate(key);
        if (translated && translated !== key) {
            dictionary[message] = translated;
        }
    }

    return dictionary;
}
