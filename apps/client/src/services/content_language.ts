import { getLocaleById } from "./i18n.js";
import options from "./options.js";

/**
 * The language a note is written in.
 *
 * A note carries its own language as a `#language` label, set from the Basic Properties ribbon, but
 * the label is opt-in and the picker that sets it stays empty until content languages are enabled —
 * so in practice almost no note has one. The `defaultContentLanguage` option answers for all of
 * them, and an empty value there means "follow the application's language" rather than "none".
 *
 * Callers should route the raw label through this rather than reading it directly, so that what the
 * setting promises to affect — text direction, typographic quotes — actually follows it everywhere.
 */
export function resolveContentLanguage(noteLanguage: string | null | undefined): string | null {
    return noteLanguage || options.get("defaultContentLanguage") || options.get("locale") || null;
}

/** Whether a note's resolved language is written right-to-left. */
export function isContentRightToLeft(noteLanguage: string | null | undefined): boolean {
    return getLocaleById(resolveContentLanguage(noteLanguage))?.rtl ?? false;
}
