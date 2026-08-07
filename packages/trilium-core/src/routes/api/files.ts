import { Request, Response } from "express";
import becca from "../../becca/becca";
import type BAttachment from "../../becca/entities/battachment";
import type BNote from "../../becca/entities/bnote";
import { convertOfficeToHtml } from "../../services/office_preview.js";
import protected_session from "../../services/protected_session";
import { downloadData, downloadNoteInt } from "../helpers";
import { serveContentWithRanges } from "../partial_content";

const downloadFile = (req: Request<{ noteId: string }>, res: Response) => downloadNoteInt(req.params.noteId, res, true);
const openFile = (req: Request<{ noteId: string }>, res: Response) => downloadNoteInt(req.params.noteId, res, false);

const downloadAttachment = (req: Request<{ attachmentId: string }>, res: Response) => downloadAttachmentInt(req.params.attachmentId, res, true);
const openAttachment = (req: Request<{ attachmentId: string }>, res: Response) => downloadAttachmentInt(req.params.attachmentId, res, false);

/**
 * Serves a note's content with byte-range support, which is what an `<audio>`/`<video>` element
 * streams from: it seeks by asking for the range it needs instead of downloading the whole file.
 */
function openPartialFile(req: Request<{ noteId: string }>, res: Response) {
    const note = becca.getNote(req.params.noteId);

    if (!note) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Note '${req.params.noteId}' doesn't exist.`);
    }

    return openPartialInt(note, req, res);
}

/** The attachment counterpart of {@link openPartialFile}. */
function openPartialAttachment(req: Request<{ attachmentId: string }>, res: Response) {
    const attachment = becca.getAttachment(req.params.attachmentId);

    if (!attachment) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Attachment '${req.params.attachmentId}' doesn't exist.`);
    }

    return openPartialInt(attachment, req, res);
}

/**
 * Converts an office document note/attachment to an embeddable HTML fragment for the
 * inline preview shown by the client. The returned HTML is unsanitized — the client
 * sanitizes it before injecting it into the DOM.
 */
async function getNoteOfficePreview(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    return { html: await convertOfficeToHtml(note.getContent(), note.mime) };
}

async function getAttachmentOfficePreview(req: Request<{ attachmentId: string }>) {
    const attachment = becca.getAttachmentOrThrow(req.params.attachmentId);

    return { html: await convertOfficeToHtml(attachment.getContent(), attachment.mime) };
}

function openPartialInt(noteOrAttachment: BNote | BAttachment, req: Request, res: Response) {
    if (noteOrAttachment.isProtected && !protected_session.isProtectedSessionAvailable()) {
        return res.status(401).send("Protected session not available");
    }

    return serveContentWithRanges(req, res, {
        content: noteOrAttachment.getContent(),
        fileName: noteOrAttachment.getFileName(),
        mimeType: noteOrAttachment.mime,
        // blobId is a content hash, so it is a stable ETag that changes only when the content does.
        etag: noteOrAttachment.blobId
    });
}

function downloadAttachmentInt(attachmentId: string, res: Response, contentDisposition = true) {
    const attachment = becca.getAttachment(attachmentId);

    if (!attachment) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Attachment '${attachmentId}' doesn't exist.`);
    }

    return downloadData(attachment, res, contentDisposition);
}

export default {
    openFile,
    downloadFile,
    openPartialFile,
    openPartialAttachment,
    openAttachment,
    downloadAttachment,
    getNoteOfficePreview,
    getAttachmentOfficePreview,
}
