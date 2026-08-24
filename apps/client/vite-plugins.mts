import type { Plugin } from "vite";

/**
 * Drops the TeX hyphenation tables `@univerjs/engine-render` lazy-loads. Its bundled
 * `index.js` has exactly 77 relative imports and every one of them is a pattern table
 * (4.4 MB of chunks, Hungarian alone 747 kB); resolving them all to one empty module
 * collapses them into a single stub chunk. `Hyphen` reaches a table only for a
 * paragraph whose section sets `autoHyphenation`, a Univer Docs setting the
 * spreadsheet note type never turns on.
 *
 * Both the client and the standalone build bundle Univer, so both apply this.
 * `vite-plugins.spec.ts` checks the rule still matches the installed dependency.
 */
export function stripUniverHyphenationPatterns(): Plugin {
    return {
        name: "strip-univer-hyphenation-patterns",
        enforce: "pre",
        resolveId: resolveUniverHyphenationPattern
    };
}

/**
 * Returns the stub for a relative import made by `@univerjs/engine-render`'s entry,
 * and `null` for everything else so other resolvers keep their turn.
 */
export function resolveUniverHyphenationPattern(source: string, importer: string | undefined): string | null {
    if (!importer?.replace(/\\/g, "/").endsWith(ENGINE_RENDER_ENTRY)) {
        return null;
    }

    return source.startsWith("./") ? HYPHENATION_STUB : null;
}

export const ENGINE_RENDER_ENTRY = "@univerjs/engine-render/lib/es/index.js";

const HYPHENATION_STUB = new URL("./src/stubs/univer_hyphenation_pattern.ts", import.meta.url).pathname;
