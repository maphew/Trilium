import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import type { GeoMouseEvent } from "./map";
import { LOCATION_ATTRIBUTE } from "./Markers";

/** The icon a note created on the map is given, and so what the ghost pin previews for one. */
export const CHILD_NOTE_ICON = "bx bx-pin";

export async function moveMarker(noteId: string, latLng: { lat: number; lng: number } | null) {
    const value = latLng ? [latLng.lat, latLng.lng].join(",") : "";
    await attributes.setLabel(noteId, LOCATION_ATTRIBUTE, value);
}

/**
 * Creates a note where the click landed, and hands it back for the pane to open on.
 *
 * No title is asked for first. A modal between the click and the note was the wrong way round: it
 * blocked the map to ask for the one thing the detail pane is made for editing. The note is created
 * under the stock name instead, and the caller opens the pane on it with that name selected — naming
 * the place is typing over it (see index.tsx).
 */
/**
 * Brings a GPX file onto the map as a child note, and hands the note back.
 *
 * Created directly rather than sent through the import pipeline: an import's success is announced
 * app-wide and navigates the active tab to what it made, which here would carry the user off the
 * very map the track was added to. The note a track lives in is simple enough to make in place — a
 * file note whose content is the file's text.
 *
 * The mime is pinned to what the map draws tracks by (see NoteGpxTrackWrapper in index.tsx) rather
 * than read off the file: a browser reports no type at all for a `.gpx`, and an import that guessed
 * wrong left the user hunting the File-type field for why their track never appeared — the user
 * guide has a step for exactly that.
 */
export async function importGpxTrack(parentNote: FNote, file: File) {
    const { note } = await note_create.createNote(parentNote.noteId, {
        title: file.name,
        content: await file.text(),
        type: "file",
        mime: "application/gpx+xml",
        activate: false,
        isProtected: parentNote.isProtected,
        attributes: [
            { type: "label", name: "originalFileName", value: file.name }
        ]
    });

    return note;
}

export async function createNewNote(parentNote: FNote, e: GeoMouseEvent) {
    const { note } = await note_create.createNote(parentNote.noteId, {
        title: t("relation_map.default_new_note_title"),
        content: "",
        type: "text",
        activate: false,
        isProtected: parentNote.isProtected,
        attributes: [
            { type: "label", name: LOCATION_ATTRIBUTE, value: [e.latlng.lat, e.latlng.lng].join(",") },
            { type: "label", name: "iconClass", value: CHILD_NOTE_ICON }
        ]
    });

    return note;
}
