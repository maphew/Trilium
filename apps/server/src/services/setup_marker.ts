import { SETUP_MARKER_FILE_NAME, type SetupMarker } from "@triliumnext/commons";
import { getLog, parseSetupMarker, type SetupMarkerStore } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import dataDirs from "./data_dir.js";

/**
 * The `setup.json` marker on a filesystem, for the server and the desktop.
 *
 * Reading it is separate from everything else here because of when it happens: before the database
 * is opened and before core exists, since what it says is whether to open the database at all. See
 * `setup_mode` in core for what it is for.
 *
 * @module
 */

function markerPath(): string {
    return path.join(dataDirs.TRILIUM_DATA_DIR, SETUP_MARKER_FILE_NAME);
}

/**
 * Reads the marker this start was left, and deletes it.
 *
 * Deleted on read rather than when the wizard is done with it: a marker that outlives its purpose
 * puts the instance in setup with no way out, which is worse than the reload it protects against.
 * What it asked for lives on in memory for this process, so a page reloaded mid-wizard still comes
 * back to the same screen, while a genuine restart comes back to the app.
 *
 * Never throws. A marker that cannot be read is one the instance is better off without.
 */
export function consumeSetupMarker(): SetupMarker | null {
    const filePath = markerPath();

    let raw: string;
    try {
        raw = fs.readFileSync(filePath, "utf8");
    } catch {
        // Overwhelmingly: there is no marker, which is what an ordinary start looks like.
        return null;
    }

    try {
        fs.rmSync(filePath, { force: true });
    } catch (e) {
        // Left behind, it would send the next start into setup as well. Worth saying out loud.
        getLog().error(`Could not remove the setup marker: ${e instanceof Error ? e.message : String(e)}`);
    }

    const marker = parseSetupMarker(raw);
    if (!marker) {
        getLog().error("The setup marker could not be read and was ignored.");
    }

    return marker;
}

/** How this platform writes the marker, for the route that asks the next start to be the wizard. */
export const setupMarkerStore: SetupMarkerStore = {
    async write(marker: SetupMarker) {
        fs.writeFileSync(markerPath(), JSON.stringify(marker, null, 4), "utf8");
    },

    async remove() {
        fs.rmSync(markerPath(), { force: true });
    }
};
