/**
 * What the geo map writes when something is put on it or taken off it (see api.ts): the note a
 * placement click creates, the note a searched place is kept as, the note a GPX file is brought in
 * as, and what becomes of a marker the reader is done with. All go through the ordinary note
 * services; what is checked here is what they are asked for.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import attributes from "../../../services/attributes";
import dialog from "../../../services/dialog";
import note_create from "../../../services/note_create";
import { deleteNoteOrBranch } from "../../../services/note_deletion";
import { buildNote } from "../../../test/easy-froca";
import { createNewNote, createNoteForPlace, importGpxTrack, moveMarker, removeFromMap } from "./api";

vi.mock("../../../services/note_create", () => ({
    default: { createNote: vi.fn(async () => ({ note: { noteId: "created" }, branch: null })) }
}));

// i18next is not initialized under test, so t() returns nothing. The key stands in for the text,
// which is enough to tell the stock name from a name the place brought with it.
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

vi.mock("../../../services/attributes", () => ({ default: { setLabel: vi.fn(async () => {}) } }));
vi.mock("../../../services/note_deletion", () => ({ deleteNoteOrBranch: vi.fn(async () => {}) }));
vi.mock("../../../services/dialog", () => ({
    default: { confirmDeleteNoteBoxWithNote: vi.fn() }
}));

const createNote = vi.mocked(note_create.createNote);
const setLabel = vi.mocked(attributes.setLabel);
const confirmDelete = vi.mocked(dialog.confirmDeleteNoteBoxWithNote);

// What each of these asks for is what is checked, so what an earlier one asked for is noise.
beforeEach(() => vi.clearAllMocks());

describe("geo map api", () => {
    it("creates a placed note under the stock name, located where the click landed", async () => {
        const parent = buildNote({ title: "The map" });

        const created = await createNewNote(parent, {
            latlng: { lat: 48.85, lng: 2.36 },
            originalEvent: new MouseEvent("click"),
            point: { x: 0, y: 0 } as never
        });

        // Handed back for the pane to open on (see createNoteAt in index.tsx).
        expect(created).toEqual({ noteId: "created" });
        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            type: "text",
            // Nothing is asked first — the name is typed over in the pane, not answered in a modal.
            title: "relation_map.default_new_note_title",
            activate: false,
            attributes: expect.arrayContaining([
                { type: "label", name: "geolocation", value: "48.85,2.36" },
                { type: "label", name: "iconClass", value: "bx bx-pin" }
            ])
        }));
    });

    it("names a note for a searched place as the place is named, and stands it there", async () => {
        const parent = buildNote({ title: "The map" });

        const created = await createNoteForPlace(parent, { name: "Jumbo", lat: 45.796, lng: 24.147 });

        expect(created).toEqual({ noteId: "created" });
        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            // Named already, unlike a note dropped by clicking: the geocoder named the place.
            title: "Jumbo",
            type: "text",
            activate: false,
            attributes: expect.arrayContaining([
                { type: "label", name: "geolocation", value: "45.796,24.147" },
                { type: "label", name: "iconClass", value: "bx bx-pin" }
            ])
        }));
    });

    it("gives a note kept from a bare point the name a placed marker gets", async () => {
        const parent = buildNote({ title: "The map" });

        // A point read out of the search bar is called by its own coordinates, which is no title.
        const created = await createNoteForPlace(
            parent, { name: "45.796, 24.147", lat: 45.796, lng: 24.147, unnamed: true });

        expect(created).toEqual({ noteId: "created" });
        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            title: "relation_map.default_new_note_title",
            attributes: expect.arrayContaining([
                { type: "label", name: "geolocation", value: "45.796,24.147" }
            ])
        }));
    });

    it("brings a GPX file in as a file note the map draws tracks by", async () => {
        const parent = buildNote({ title: "The map" });
        const file = new File([ "<gpx><trk/></gpx>" ], "sunday-ride.gpx");

        const created = await importGpxTrack(parent, file);

        expect(created).toEqual({ noteId: "created" });
        expect(createNote).toHaveBeenCalledWith(parent.noteId, expect.objectContaining({
            // Titled without the extension, as an imported file is; the whole name stays on the label.
            title: "sunday-ride",
            content: "<gpx><trk/></gpx>",
            type: "file",
            // Pinned rather than read off the file: a browser reports no type for a .gpx, and this
            // is the one mime the map recognises a track by (see NoteGpxTrackWrapper).
            mime: "application/gpx+xml",
            activate: false,
            attributes: [ { type: "label", name: "originalFileName", value: "sunday-ride.gpx" } ]
        }));
    });

    it("writes a marker's location, and empties it to take the marker off the map", async () => {
        await moveMarker("note1", { lat: 45.796, lng: 24.147 });
        expect(setLabel).toHaveBeenLastCalledWith("note1", "geolocation", "45.796,24.147");

        // An empty value is what leaves the note in place with no marker standing for it.
        await moveMarker("note1", null);
        expect(setLabel).toHaveBeenLastCalledWith("note1", "geolocation", "");
    });

    describe("taking a marker off the map", () => {
        it("deletes the note where that is what the reader agreed to", async () => {
            const map = buildNote({ title: "The map" });
            const note = buildNote({ title: "A place" });
            confirmDelete.mockResolvedValue({ confirmed: true, isDeleteNoteChecked: true });

            await removeFromMap(note, map);

            expect(deleteNoteOrBranch).toHaveBeenCalledWith(note.noteId, null);
            expect(setLabel).not.toHaveBeenCalledWith(note.noteId, "geolocation", "");
        });

        it("keeps the note and clears its location where the reader only wanted it off the map", async () => {
            const map = buildNote({ title: "The map" });
            const note = buildNote({ title: "A place" });
            confirmDelete.mockResolvedValue({ confirmed: true, isDeleteNoteChecked: false });

            await removeFromMap(note, map);

            expect(setLabel).toHaveBeenLastCalledWith(note.noteId, "geolocation", "");
        });

        it("leaves the marker alone where the reader changed their mind", async () => {
            const map = buildNote({ title: "The map" });
            const note = buildNote({ title: "A place" });
            confirmDelete.mockResolvedValue({ confirmed: false, isDeleteNoteChecked: false });

            await removeFromMap(note, map);

            expect(deleteNoteOrBranch).not.toHaveBeenCalled();
            expect(setLabel).not.toHaveBeenCalled();
        });
    });
});
