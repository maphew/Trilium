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
