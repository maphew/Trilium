import { readFile, stat,writeFile } from "fs/promises";
import { join } from "path";

const scriptDir = __dirname;

/** The Weblate components under https://hosted.weblate.org/projects/trilium/ that are gated. */
export type WeblateProject = "readme" | "client" | "website";

/** How long a `.language-stats-*.json` cache file is reused before Weblate is queried again. */
export const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export async function getLanguageStats(project: WeblateProject) {
    const cacheFile = join(scriptDir, `.language-stats-${project}.json`);

    // Try to read from the cache.
    try {
        const cacheStats = await stat(cacheFile);
        if (isCacheFresh(cacheStats.mtimeMs, Date.now())) {
            console.log("Reading language stats from cache.");
            return JSON.parse(await readFile(cacheFile, "utf-8"));
        }
    } catch (e) {
        if (!(e && typeof e === "object" && "code" in e && e.code === "ENOENT")) {
            throw e;
        }
    }

    // Make the request
    console.log("Reading language stats from Weblate API.");
    const request = await fetch(`https://hosted.weblate.org/api/components/trilium/${project}/translations/`);
    const stats = JSON.parse(await request.text());

    // Update the cache
    await writeFile(cacheFile, JSON.stringify(stats, null, 4));

    return stats;
}

/**
 * Determines whether a cache file written at `mtimeMs` can still be used at `nowMs`.
 *
 * A file stamped in the future is treated as stale, so a bad clock or a copied timestamp
 * cannot pin the cache to a snapshot that never expires.
 */
export function isCacheFresh(mtimeMs: number, nowMs: number) {
    const age = nowMs - mtimeMs;
    return age >= 0 && age < CACHE_MAX_AGE_MS;
}
