import type { TextTypingTransformationDescription } from "@triliumnext/ckeditor5";

import { escapeRegExp } from "../../../services/utils.js";

/** One replacement the user wrote: the text they type, and what it becomes. */
export interface CustomReplacement {
    from: string;
    to: string;
}

/**
 * Reads the stored replacements, tolerating anything the option is not.
 *
 * It is user-entered content that syncs between devices, so a value that is malformed — hand-edited,
 * written by an older version, corrupted in transit — must degrade to "no custom replacements"
 * rather than break the editor it is read by.
 */
export function parseCustomReplacements(json: string | null | undefined): CustomReplacement[] {
    if (!json) return [];

    let parsed: unknown;
    try {
        parsed = JSON.parse(json);
    } catch {
        return [];
    }

    if (!Array.isArray(parsed)) return [];
    return parsed
        .filter((entry): entry is CustomReplacement =>
            !!entry && typeof entry === "object"
            && typeof (entry as CustomReplacement).from === "string"
            && typeof (entry as CustomReplacement).to === "string");
}

/**
 * Compiles the replacements into the transformations CKEditor's `typing.transformations.extra` takes.
 *
 * Two things are decided here rather than left to the user:
 *
 * The pattern is built from the typed text as a literal — never taken as a regular expression. It is
 * `.test()`-ed against the text before the caret on every keystroke and syncs to every device, so one
 * catastrophically backtracking pattern would hang the editor everywhere. There is no user demand
 * this would serve that plain text does not.
 *
 * And it matches a whole word: the text has to start the line or follow a space, and be followed by
 * one. Passing a bare string to CKEditor compiles to `/(text)$/`, which fires mid-word — a `TN`
 * replacement would rewrite the tail of `BTN` — and firing on the closing space rather than on the
 * last letter is what lets `TNT` still be typed. It is the same shape upstream gives its en dash,
 * and the behaviour every office suite's autocorrect has taught people to expect.
 *
 * A half-written row (either side still blank) compiles to nothing, so a replacement being typed in
 * the settings does not act until it is finished.
 */
export function buildCustomTransformations(replacements: CustomReplacement[]): TextTypingTransformationDescription[] {
    return replacements
        .filter(({ from, to }) => from.trim().length > 0 && to.trim().length > 0)
        .map(({ from, to }) => ({
            from: new RegExp(`(^|\\s)(${escapeRegExp(from)})(\\s)$`),
            to: [null, to, null]
        }));
}
