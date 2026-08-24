import type { UserFont } from "@triliumnext/commons";

import server from "./server.js";

/** The fonts the user offers to the font picker: the file notes labelled `#customFont`. */
export async function getCustomFonts() {
    return await server.get<UserFont[]>("options/user-fonts");
}

/**
 * Loads a font note's file and registers it with the document under `family`, so anything styled
 * with that family renders in it. The caller owns the returned face and must hand it to
 * `document.fonts.delete()` once it is done with it.
 *
 * The bytes are fetched and handed to `FontFace` rather than referenced by their API URL: a `url()`
 * source is loaded by the engine itself, outside the host document's service worker and Capacitor
 * request interceptors, which is where standalone and iOS answer an API request from (see
 * `loadIconPackFont`). `version` — a blobId — keeps a replaced file from being served from the
 * cache of the one it replaced.
 */
export async function registerFontNote(noteId: string, family: string, version: string) {
    // Resolved against the host document's base URL, which also covers Electron's `trilium-app://`.
    const url = new URL(`api/notes/${noteId}/open?v=${encodeURIComponent(version)}`, document.baseURI).href;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Font request failed with HTTP ${response.status}.`);
    }

    const face = await new FontFace(family, await response.arrayBuffer()).load();
    document.fonts.add(face);

    return face;
}
