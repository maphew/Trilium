import { describe, expect, it, vi } from "vitest";

import type FAttachment from "../../../entities/fattachment";
import AttachmentSaves from "./attachment_saves";

const drawing = {
    attachmentId: "drawing1",
    ownerId: "note1",
    role: "file",
    mime: "application/vnd.excalidraw+json",
    title: "Canvas.excalidraw"
} as FAttachment;

function setUp() {
    const scheduleUpdate = vi.fn();
    const saves = new AttachmentSaves(scheduleUpdate);
    saves.setNoteId("note1");
    return { saves, scheduleUpdate };
}

describe("AttachmentSaves", () => {
    it("edits only the attachments of the note it saves", () => {
        const { saves } = setUp();

        expect(saves.canEdit(drawing)).toBe(true);
        expect(saves.canEdit({ ...drawing, ownerId: "note2" } as FAttachment)).toBe(false);

        saves.setNoteId(undefined);
        expect(saves.canEdit(drawing)).toBe(false);
    });

    it("schedules a save and reads the content when the note saves", () => {
        const { saves, scheduleUpdate } = setUp();
        let content = "first";

        saves.scheduleSave(drawing, () => content);
        content = "second";

        expect(scheduleUpdate).toHaveBeenCalledOnce();
        expect(saves.getUnsavedContent("drawing1")).toBe("second");
        expect(saves.collect()).toStrictEqual([ {
            attachmentId: "drawing1",
            role: "file",
            mime: "application/vnd.excalidraw+json",
            title: "Canvas.excalidraw",
            content: "second"
        } ]);
    });

    it("keeps a change made while a save runs", () => {
        const { saves } = setUp();
        saves.scheduleSave(drawing, () => "saved");
        const sent = saves.collect();

        saves.scheduleSave(drawing, () => "changed meanwhile");
        saves.markSaved(sent);
        expect(saves.getUnsavedContent("drawing1")).toBe("changed meanwhile");

        saves.markSaved(saves.collect());
        expect(saves.getUnsavedContent("drawing1")).toBeUndefined();
        expect(saves.collect()).toStrictEqual([]);
    });

    it("ignores a save of other data", () => {
        const { saves } = setUp();
        saves.scheduleSave(drawing, () => "unsaved");

        saves.markSaved(undefined);
        saves.markSaved([ { role: "image", title: "x", mime: "image/png", content: "" } ]);

        expect(saves.getUnsavedContent("drawing1")).toBe("unsaved");
    });

    it("reads the content of a released editor once, and keeps it until the note saves", () => {
        const { saves } = setUp();
        const getContent = vi.fn(() => "last state");
        saves.scheduleSave(drawing, getContent);

        saves.release("drawing1");
        saves.release("unknown");

        expect(getContent).toHaveBeenCalledOnce();
        expect(saves.getUnsavedContent("drawing1")).toBe("last state");
        expect(saves.collect()[0].content).toBe("last state");
        expect(getContent).toHaveBeenCalledOnce();
    });

    it("drops the changes when it saves another note", () => {
        const { saves } = setUp();
        saves.scheduleSave(drawing, () => "unsaved");

        saves.setNoteId("note1");
        expect(saves.getUnsavedContent("drawing1")).toBe("unsaved");

        saves.setNoteId("note2");
        expect(saves.getUnsavedContent("drawing1")).toBeUndefined();
    });
});
