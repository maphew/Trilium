import { readFileSync } from "fs";
import { createRequire } from "module";
import { dirname, join } from "path";
import { describe, expect, it } from "vitest";

import { ENGINE_RENDER_ENTRY, resolveUniverHyphenationPattern } from "./vite-plugins.mjs";

const entryPath = createRequire(import.meta.url).resolve("@univerjs/engine-render/lib/es/index.js");
const entrySource = readFileSync(entryPath, "utf8");

/**
 * Canary for `stripUniverHyphenationPatterns`. The rule it applies — every relative
 * import made by `@univerjs/engine-render`'s entry is a hyphenation table — holds for
 * the installed version, but an upgrade could rename the entry, inline the tables, or
 * start importing a real sibling module. The first two turn the plugin into a no-op
 * that silently puts 4.4 MB back into the build; the third makes it stub out live code.
 */
describe("stripUniverHyphenationPatterns", () => {
    it("matches an entry that still lazy-loads a pattern table per locale", () => {
        expect(entryPath.replace(/\\/g, "/")).toContain(ENGINE_RENDER_ENTRY);
        expect(patternLoaders().length).toBeGreaterThan(50);
    });

    it("finds nothing relative in the entry beyond the tables, so the blanket rule stays safe", () => {
        const relativeImports = [...entrySource.matchAll(/\bimport\("(\.[^"]*)"\)/g)].map(([, source]) => source);

        expect(new Set(relativeImports)).toEqual(new Set(patternLoaders().map(({ source }) => source)));
        expect([...entrySource.matchAll(/\bfrom\s*"(\.[^"]*)"/g)]).toHaveLength(0);
    });

    it("intercepts every table the loader map points at", () => {
        for (const { locale, source } of patternLoaders()) {
            expect(resolveUniverHyphenationPattern(source, entryPath)).toContain("univer_hyphenation_pattern");

            // Each table exports its locale Pascal-cased (`de-ch-1901` -> `DeCh1901`),
            // which is also how `Hyphen.loadPattern()` reads it back off the namespace.
            const table = readFileSync(join(dirname(entryPath), source), "utf8");
            expect(table).toContain(`export { ${pascalCaseLocale(locale)} }`);
        }
    });

    it("declines a bare specifier and any importer outside the entry", () => {
        expect(resolveUniverHyphenationPattern("rxjs", entryPath)).toBeNull();
        expect(resolveUniverHyphenationPattern("./hu-DVk7Y_ka.js", "/app/src/services/froca.ts")).toBeNull();
        expect(resolveUniverHyphenationPattern("./hu-DVk7Y_ka.js", undefined)).toBeNull();
    });

    it("stubs a module that the pattern loader reads as an absent table", async () => {
        // `loadPattern()` takes the table off the namespace under its Pascal-cased locale
        // and returns early when it is missing, so nothing throws and `hasPattern()` stays
        // false — the hyphenating line breaker is never built.
        const stub: Record<string, unknown> = await import("./src/stubs/univer_hyphenation_pattern.js");

        expect(Array.isArray(stub)).toBe(false);
        for (const { locale } of patternLoaders()) {
            expect(stub[pascalCaseLocale(locale)]).toBeUndefined();
        }
    });
});

/** Reads the generated `PATTERN_LOADERS` map, whose keys are the locales Univer hyphenates. */
function patternLoaders(): { locale: string; source: string }[] {
    const entries = entrySource.matchAll(/\["([a-z0-9-]+)"\]\s*:\s*\(\)\s*=>\s*import\("(\.[^"]*)"\)/g);

    return [...entries].map(([, locale, source]) => ({ locale, source }));
}

function pascalCaseLocale(locale: string): string {
    return locale.split("-").filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
}
