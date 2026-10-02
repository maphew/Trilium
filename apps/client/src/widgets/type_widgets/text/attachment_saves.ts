import type FAttachment from "../../../entities/fattachment";
import type { AttachmentEditor } from "../../../services/content_renderer";
import type { SavedData } from "../../react/hooks";

type SavedAttachments = NonNullable<SavedData["attachments"]>;

interface PendingSave {
    attachment: FAttachment;
    /** Reads the content from the mounted editor. */
    getContent?: () => string;
    /** The content read when the editor went away. */
    content?: string;
    /** Counts the changes, so that a save keeps the changes made while it ran. */
    revision: number;
}

/**
 * The attachment changes that embedded content, such as a canvas drawing, makes inside a text note.
 * The text note saves them together with its own content.
 */
export default class AttachmentSaves implements AttachmentEditor {
    private noteId: string | undefined;
    private pending = new Map<string, PendingSave>();
    private sentRevisions = new WeakMap<SavedAttachments, Map<string, number>>();

    /** @param scheduleUpdate schedules a save of the text note. */
    constructor(private scheduleUpdate: () => void) {}

    /** Sets the note whose attachments can change, and drops the changes to any other note. */
    setNoteId(noteId: string | undefined) {
        if (noteId !== this.noteId) {
            this.pending.clear();
        }
        this.noteId = noteId;
    }

    canEdit(attachment: FAttachment) {
        return !!this.noteId && attachment.ownerId === this.noteId;
    }

    getUnsavedContent(attachmentId: string) {
        const save = this.pending.get(attachmentId);
        return save ? readContent(save) : undefined;
    }

    scheduleSave(attachment: FAttachment, getContent: () => string) {
        const revision = (this.pending.get(attachment.attachmentId)?.revision ?? 0) + 1;
        this.pending.set(attachment.attachmentId, { attachment, getContent, revision });
        this.scheduleUpdate();
    }

    release(attachmentId: string) {
        const save = this.pending.get(attachmentId);
        if (save?.getContent) {
            save.content = save.getContent();
            save.getContent = undefined;
        }
    }

    /** The attachments to save with the note, read at the time of the call. */
    collect(): SavedAttachments {
        const attachments: SavedAttachments = [];
        const revisions = new Map<string, number>();
        for (const [ attachmentId, save ] of this.pending) {
            const { role, mime, title } = save.attachment;
            attachments.push({ attachmentId, role, mime, title, content: readContent(save) });
            revisions.set(attachmentId, save.revision);
        }

        this.sentRevisions.set(attachments, revisions);
        return attachments;
    }

    /** Drops the changes that `attachments`, as returned by `collect()`, saved. */
    markSaved(attachments: SavedAttachments | undefined) {
        const revisions = attachments && this.sentRevisions.get(attachments);
        if (!revisions) {
            return;
        }

        for (const [ attachmentId, revision ] of revisions) {
            if (this.pending.get(attachmentId)?.revision === revision) {
                this.pending.delete(attachmentId);
            }
        }
    }
}

function readContent(save: PendingSave) {
    return save.getContent ? save.getContent() : save.content ?? "";
}
