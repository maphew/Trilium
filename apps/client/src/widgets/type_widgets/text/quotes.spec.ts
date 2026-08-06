import { describe, expect, it } from "vitest";

import { buildQuoteTransformations, type QuoteStyle, resolveQuoteStyle } from "./quotes.js";

/**
 * Applies a transformation the way CKEditor's `TextTransformation` does: match the text before the
 * caret, then swap in every group the `to` array names, leaving the `null` ones alone. Lets the
 * regex and the replacement array be asserted together, which is where a quote pair actually breaks.
 */
function transform(transformation: ReturnType<typeof buildQuoteTransformations>[number], text: string) {
    const from = transformation.from;
    if (!(from instanceof RegExp) || !Array.isArray(transformation.to)) {
        throw new Error("the quote transformations are built as a RegExp plus a replacement array");
    }

    const matches = from.exec(text);
    if (!matches) return null;

    let result = text.slice(0, matches.index);
    for (let i = 1; i < matches.length; i++) {
        result += transformation.to[i - 1] ?? matches[i];
    }
    return result + text.slice(matches.index + matches[0].length);
}

/** The primary (double-quote) and secondary (single-quote) transformation for a locale. */
function transformationsFor(locale: string) {
    const style = resolveQuoteStyle(locale);
    if (!style) throw new Error(`expected ${locale} to resolve to a quote style`);
    const [primary, secondary] = buildQuoteTransformations(style);
    return { primary, secondary };
}

describe("resolveQuoteStyle", () => {
    it("takes the first candidate that maps, skipping empty ones", () => {
        const de: QuoteStyle = { primary: ["„", "“"], secondary: ["‚", "‘"] };

        expect(resolveQuoteStyle("de", "fr", "en")).toEqual(de);
        // The note has no `#language`, so the formatting locale decides.
        expect(resolveQuoteStyle(null, "de", "en")).toEqual(de);
        expect(resolveQuoteStyle(undefined, "", "de")).toEqual(de);
        // An unmapped candidate does not stop the search.
        expect(resolveQuoteStyle("ar", "de")).toEqual(de);
    });

    it("returns null when nothing maps, leaving CKEditor's defaults in place", () => {
        expect(resolveQuoteStyle()).toBeNull();
        expect(resolveQuoteStyle(null, undefined, "")).toBeNull();
        // The right-to-left content locales are deliberately unmapped.
        for (const locale of ["ar", "he", "ku", "fa", "ug"]) {
            expect(resolveQuoteStyle(locale)).toBeNull();
        }
    });

    it("falls back from a region to its base language, but not past a mapped region", () => {
        expect(resolveQuoteStyle("de-DE")).toEqual(resolveQuoteStyle("de"));
        expect(resolveQuoteStyle("de-AT")).toEqual(resolveQuoteStyle("de"));
        expect(resolveQuoteStyle("fr-CA")).toEqual(resolveQuoteStyle("fr"));

        // en-GB inverts the levels, so it must not collapse into `en`.
        expect(resolveQuoteStyle("en-GB")).toEqual({ primary: ["‘", "’"], secondary: ["“", "”"] });
        expect(resolveQuoteStyle("en-US")).toEqual({ primary: ["“", "”"], secondary: ["‘", "’"] });
        expect(resolveQuoteStyle("en-GB")).not.toEqual(resolveQuoteStyle("en"));
    });

    it("normalizes the locale ids Trilium stores, matching the date and number formatters", () => {
        // Underscored and case-varied forms reach the same entry.
        expect(resolveQuoteStyle("pt_br")).toEqual(resolveQuoteStyle("pt-BR"));
        // Brazilian usage differs from European Portuguese, so it must not collapse into `pt`.
        expect(resolveQuoteStyle("pt_br")).not.toEqual(resolveQuoteStyle("pt"));
        expect(resolveQuoteStyle("pt")).toEqual({ primary: ["«", "»"], secondary: ["“", "”"] });

        // `cn`/`tw` are Trilium ids that normalize to zh-CN/zh-TW; only traditional uses brackets.
        expect(resolveQuoteStyle("cn")).toEqual({ primary: ["“", "”"], secondary: ["‘", "’"] });
        expect(resolveQuoteStyle("tw")).toEqual({ primary: ["「", "」"], secondary: ["『", "』"] });
    });
});

/** U+202F, the narrow no-break space French sets inside its guillemets. Named so the assertions
 * below do not carry an invisible character that reads as stray whitespace. */
const NNBSP = "\u202F";

describe("buildQuoteTransformations", () => {
    it("replaces both marks of a quoted run, leaving the text between them alone", () => {
        const { primary, secondary } = transformationsFor("en");

        expect(transform(primary, `he said "hello there"`)).toBe(`he said “hello there”`);
        expect(transform(secondary, `he said 'hello there'`)).toBe(`he said ‘hello there’`);
        // Opening at the very start of the line is matched too.
        expect(transform(primary, `"hello"`)).toBe(`“hello”`);
    });

    it("only fires once the run is closed, and not on a quote mid-word", () => {
        const { primary, secondary } = transformationsFor("en");

        // Still typing inside the quotes.
        expect(transform(primary, `he said "hello`)).toBeNull();
        // The opening mark has to start the line or follow a space, so an apostrophe is safe.
        expect(transform(secondary, `it's fine`)).toBeNull();
        expect(transform(secondary, `don't say it's fine`)).toBeNull();
    });

    it("uses the asymmetric marks of locales that do not mirror them", () => {
        // German closes with the raised mark rather than a mirror of the opening one.
        expect(transform(transformationsFor("de").primary, `er sagte "hallo"`)).toBe(`er sagte „hallo“`);
        expect(transform(transformationsFor("de").secondary, `er sagte 'hallo'`)).toBe(`er sagte ‚hallo‘`);
        // Polish opens low and closes high.
        expect(transform(transformationsFor("pl").primary, `on rzekł "cześć"`)).toBe(`on rzekł „cześć”`);
        // Russian sets guillemets outermost.
        expect(transform(transformationsFor("ru").primary, `он сказал "привет"`)).toBe(`он сказал «привет»`);
    });

    it("keeps the narrow no-break spaces French sets inside its guillemets", () => {
        expect(transform(transformationsFor("fr").primary, `il a dit "bonjour"`)).toBe(`il a dit «${NNBSP}bonjour${NNBSP}»`);
        // The nested level takes plain double quotes, without the spacing.
        expect(transform(transformationsFor("fr").secondary, `il a dit 'bonjour'`)).toBe(`il a dit “bonjour”`);
    });

    it("uses corner brackets for Japanese", () => {
        expect(transform(transformationsFor("ja").primary, `彼は "こんにちは"`)).toBe(`彼は 「こんにちは」`);
    });
});
