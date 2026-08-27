import { customFontFamily, customFontNoteId, type UserFont } from "@triliumnext/commons";

import froca from "./froca.js";
import options from "./options.js";
import server from "./server.js";
import { logError } from "./ws.js";

/** The font options that can name one of the user's own fonts. */
const FONT_FAMILY_OPTIONS = [ "mainFontFamily", "treeFontFamily", "detailFontFamily", "monospaceFontFamily" ] as const;

/** The faces registered for the fonts the options currently name, by the note each is stored in. */
const registeredFonts = new Map<string, FontFace>();

/**
 * Registers the user's own fonts that the font options name, so the families the fonts stylesheet
 * declares (see `getFontCss`) resolve to the files those notes hold. Fonts no longer named by any
 * option are unregistered.
 *
 * Lives here rather than beside the stylesheet in `font.ts` because that module is loaded by
 * `index.ts` before jQuery is: froca and the options reach i18next through their imports, which
 * touches `$` as it loads.
 */
export async function applyCustomFontsFromOptions() {
    const wanted = new Set(FONT_FAMILY_OPTIONS
        .map((optionName) => customFontNoteId(options.get(optionName)))
        .filter((noteId) => noteId !== null));

    for (const [ noteId, face ] of registeredFonts) {
        if (!wanted.has(noteId)) {
            document.fonts.delete(face);
            registeredFonts.delete(noteId);
        }
    }

    await Promise.all([ ...wanted ].map(async (noteId) => {
        if (registeredFonts.has(noteId)) return;

        const note = await froca.getNote(noteId);
        if (!note) return;

        try {
            const face = await registerFontNote(noteId, customFontFamily(noteId), note.blobId ?? "");
            // A concurrent call may have registered the same note, or the option may have moved on
            // while the bytes were being fetched; either way this face is one too many.
            if (registeredFonts.has(noteId)) {
                document.fonts.delete(face);
            } else {
                registeredFonts.set(noteId, face);
            }
        } catch (e) {
            logError(`Could not load the font stored in note '${noteId}': ${e}`);
        }
    }));
}

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
