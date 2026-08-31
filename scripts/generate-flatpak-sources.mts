/**
 * Generates the sources file that lets `pnpm install --offline` run inside the
 * flatpak-builder sandbox, which has no network.
 *
 * flatpak-builder downloads every input up front from the manifest, so each of the
 * ~2500 packages in `pnpm-lock.yaml` has to be declared as its own pinned source.
 * `flatpak-node-generator` performs that translation and additionally emits the
 * script that rebuilds pnpm's content-addressable store from the tarballs.
 *
 * Usage:
 *
 *   node --experimental-strip-types ./scripts/generate-flatpak-sources.mts
 *
 * Requires `flatpak-node-generator` on PATH, from the `node` subdirectory of
 * https://github.com/flatpak/flatpak-builder-tools.
 */

import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const PACKAGE_JSON_PATH = join(ROOT, "package.json");
const LOCKFILE_PATH = join(ROOT, "pnpm-lock.yaml");
const OUTPUT_PATH = join(ROOT, "upload", "generated-sources.json");

const PNPM_MAJOR = 11;
// pnpm 11 reads its store from a v11 layout (a SQLite index.db); flatpak-node-generator
// defaults to v10 (per-package JSON index files), which pnpm 11 would not find.
const STORE_VERSION = "v11";

export function main() {
    checkPnpm(readFileSync(PACKAGE_JSON_PATH, "utf-8"));
    generateSources();
    console.log(`Wrote ${relative(ROOT, OUTPUT_PATH)}`);
}

export function checkPnpm(packageJson: string) {
    const { packageManager } = JSON.parse(packageJson);
    const major = /^pnpm@(\d+)\./.exec(packageManager ?? "")?.[1];
    if (Number(major) !== PNPM_MAJOR) {
        throw new Error(
            `Expected package.json to pin pnpm ${PNPM_MAJOR}, got "${packageManager}". `
            + `Point STORE_VERSION at the layout the new pnpm uses: generating against the wrong `
            + `one succeeds here and only fails later, inside the build sandbox.`
        );
    }
}

function generateSources() {
    mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
    try {
        execFileSync("flatpak-node-generator", [
            "pnpm", LOCKFILE_PATH,
            "--pnpm-store-version", STORE_VERSION,
            "-o", OUTPUT_PATH
        ], { stdio: "inherit" });
    } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") {
            throw new Error(
                "flatpak-node-generator is not on PATH. Install it with:\n"
                + "  pipx install 'git+https://github.com/flatpak/flatpak-builder-tools.git"
                + "#subdirectory=node'"
            );
        }
        throw err;
    }
}

// Only when run as a script — the pure helpers above are imported by the spec.
if (process.argv[1] === import.meta.filename) {
    try {
        main();
    } catch (err) {
        console.error(err instanceof Error ? err.message : err);
        process.exit(1);
    }
}
