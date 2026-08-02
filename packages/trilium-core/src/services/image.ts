/**
 * Image service for saving and updating images.
 * Uses ImageProvider for platform-specific processing (compression, format detection).
 */

import sanitizeFilename from "sanitize-filename";

import becca from "../becca/becca.js";
import { getContext } from "./context.js";
import { getLog } from "./log.js";
import { getImageProvider } from "./image_provider.js";
import noteService from "./notes.js";
import protectedSessionService from "./protected_session.js";
import { getSql } from "./sql/index.js";
import { sanitizeHtml } from "./sanitizer.js";

function getImageMimeFromExtension(ext: string): string {
    ext = ext.toLowerCase();
    return `image/${ext === "svg" ? "svg+xml" : ext}`;
}

/**
 * Image content that has been promised but not yet stored.
 *
 * Every function below writes its image in two steps: the note or attachment is created at once,
 * empty, and filled in when the compression it was handed to answers. That is what keeps an upload
 * from blocking on a decode — but between the two the entity exists holding nothing, and nothing
 * anywhere records that it is owed anything. An import of hundreds is minutes of that, and a
 * process stopped in the middle of it leaves those entities empty for good.
 *
 * So the debt is written down. {@link awaitPendingImageWrites} is what a caller waits on before
 * saying it is finished.
 */
const pendingWrites = new Set<PendingImageWrite>();

interface PendingImageWrite {
    /** The note or attachment the content is owed to, so one image can be waited for on its own. */
    entityId: string;
    stored: Promise<void>;
}

/**
 * Records one image write, and swallows its failure.
 *
 * Swallowed here rather than left to reject: the write is nobody's promise, so a rejection is an
 * unhandled one — and it would take the barrier down with it, turning one image that could not be
 * stored into an import reported as failed. The entity keeps the empty content it was created
 * with, which is what it would have had anyway, and the reason is in the log.
 */
function trackWrite(write: Promise<unknown>, entityId: string, describe: string) {
    const stored = write
        .then(() => {}, (e: unknown) => {
            getLog().error(`Failed to store image ${describe}: ${(e as Error)?.stack ?? e}`);
        })
        .finally(() => pendingWrites.delete(entry));
    const entry: PendingImageWrite = { entityId, stored };

    pendingWrites.add(entry);
}

/**
 * Waits until every image handed over so far has been stored.
 *
 * Drained rather than sampled: compressing one image can start another — an importer creates its
 * notes as it reads them — and a write begun while this was waiting on the last batch is still one
 * the caller owes. It ends when there is nothing left outstanding, which for a bounded piece of
 * work like an import is when that work is genuinely done. (A caller with an unbounded supply of
 * images would never see the set empty, which is why this is for imports and not for, say, a
 * long-lived request loop.)
 */
export async function awaitPendingImageWrites(): Promise<void> {
    while (pendingWrites.size > 0) {
        // Safe to await as a group: none of these can reject, see above.
        await Promise.all([ ...pendingWrites ].map((entry) => entry.stored));
    }
}

/**
 * Waits for the content of one image, and only that one.
 *
 * For the caller that hands a client a URL and expects it to be fetched immediately — a picture
 * pasted into the editor is requested by the browser the moment the upload answers, and an answer
 * that arrives before the bytes do is an answer to an empty attachment. That is a broken image in
 * the document, and it stays broken until something reloads it.
 *
 * One image rather than all of them, unlike {@link awaitPendingImageWrites}: a paste has no reason
 * to wait out an import that happens to be running, and would be waiting minutes if it did.
 */
export async function awaitImageWrite(entityId: string | undefined): Promise<void> {
    if (!entityId) {
        return;
    }

    await Promise.all([ ...pendingWrites ]
        .filter((entry) => entry.entityId === entityId)
        .map((entry) => entry.stored));
}

function updateImage(noteId: string, uploadBuffer: Uint8Array, originalName: string): void {
    getLog().info(`Updating image ${noteId}: ${originalName}`);

    originalName = sanitizeHtml(originalName);

    const note = becca.getNote(noteId);
    if (!note) {
        throw new Error("Unable to find note.");
    }

    note.saveRevision();
    note.setLabel("originalFileName", originalName);

    // Process image asynchronously
    trackWrite(getImageProvider().processImage(uploadBuffer, originalName, true).then(({ buffer, format }) => {
        getContext().init(() => {
            getSql().transactional(() => {
                note.mime = getImageMimeFromExtension(format.ext);
                note.save();
                note.setContent(buffer);
            });
        });
    }), noteId, `note '${noteId}'`);
}

function saveImage(
    parentNoteId: string,
    uploadBuffer: Uint8Array,
    originalName: string,
    shrinkImageSwitch: boolean,
    trimFilename = false
): { fileName: string; note: ReturnType<typeof noteService.createNewNote>["note"]; noteId: string; url: string } {
    getLog().info(`Saving image ${originalName} into parent ${parentNoteId}`);

    if (trimFilename && originalName.length > 40) {
        originalName = "image";
    }

    const fileName = sanitizeFilename(originalName);
    const parentNote = becca.getNote(parentNoteId);
    if (!parentNote) {
        throw new Error("Unable to find parent note.");
    }

    const { note } = noteService.createNewNote({
        parentNoteId,
        title: fileName,
        type: "image",
        mime: "unknown",
        content: "",
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
    });

    note.addLabel("originalFileName", originalName);

    // Process image asynchronously
    trackWrite(getImageProvider().processImage(uploadBuffer, originalName, shrinkImageSwitch).then(({ buffer, format }) => {
        getContext().init(() => {
            getSql().transactional(() => {
                note.mime = getImageMimeFromExtension(format.ext);

                if (!originalName.includes(".")) {
                    originalName += `.${format.ext}`;
                    note.setLabel("originalFileName", originalName);
                    note.title = sanitizeFilename(originalName);
                }

                note.setContent(buffer, { forceSave: true });
            });
        });
    }), note.noteId, `note '${note.noteId}'`);

    return {
        fileName,
        note,
        noteId: note.noteId,
        url: `api/images/${note.noteId}/${encodeURIComponent(fileName)}`
    };
}

function saveImageToAttachment(
    noteId: string,
    uploadBuffer: Uint8Array,
    originalName: string,
    shrinkImageSwitch?: boolean,
    trimFilename = false
): { attachmentId: string | undefined; title: string } {
    getLog().info(`Saving image '${originalName}' as attachment into note '${noteId}'`);

    if (trimFilename && originalName.length > 40) {
        originalName = "image";
    }

    const fileName = sanitizeFilename(originalName);
    const note = becca.getNoteOrThrow(noteId);

    let attachment = note.saveAttachment({
        role: "image",
        mime: "unknown",
        title: fileName
    });

    // Schedule post-processing to mark unused attachments
    setTimeout(() => {
        getContext().init(() => {
            getSql().transactional(() => {
                const note = becca.getNoteOrThrow(noteId);
                noteService.asyncPostProcessContent(note, note.getContent());
            });
        });
    }, 5000);

    // Process image asynchronously
    const attachmentId = attachment.attachmentId;
    trackWrite(getImageProvider().processImage(uploadBuffer, originalName, !!shrinkImageSwitch).then(({ buffer, format }) => {
        getContext().init(() => {
            getSql().transactional(() => {
                if (!attachmentId) {
                    throw new Error("Missing attachment ID.");
                }
                attachment = becca.getAttachmentOrThrow(attachmentId);

                attachment.mime = getImageMimeFromExtension(format.ext);

                if (!originalName.includes(".")) {
                    originalName += `.${format.ext}`;
                    attachment.title = sanitizeFilename(originalName);
                }

                attachment.setContent(buffer, { forceSave: true });
            });
        });
    }), attachmentId ?? "", `attachment '${attachmentId}'`);

    return attachment;
}

export default {
    awaitImageWrite,
    awaitPendingImageWrites,
    saveImage,
    saveImageToAttachment,
    updateImage
};
