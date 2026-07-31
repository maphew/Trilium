/**
 * On-demand image compression: shrinks the images a note already holds, when the user asks for it.
 *
 * The `compressImages` option shrinks images as they come in, and is usually left off because it
 * costs quality on every image regardless. This service is the other half of that trade: nothing
 * happens automatically, but a single note (or a single image) whose attachments have grown out of
 * hand can be shrunk deliberately, accepting the quality loss for that one note alone. It therefore
 * runs whether or not the option is enabled.
 *
 * What it decides is *which* images to visit and what to write back; how a single image is actually
 * recompressed belongs to the platform's {@link ImageProvider}.
 */

import { getImageAttachmentTitle, type ImageCompressionItem, type ImageCompressionOptions, type ImageCompressionResponse, type ImageCompressionSkipReason } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import type BAttachment from "../becca/entities/battachment.js";
import type BNote from "../becca/entities/bnote.js";
import { NotFoundError, ValidationError } from "../errors.js";
import { getImageProvider, type ImageCompressionRequest } from "./image_provider.js";
import { getLog } from "./log.js";
import optionService from "./options.js";
import { getSql } from "./sql/index.js";
import { wrapStringOrBuffer } from "./utils/binary.js";

/** Quality bounds shared with the automatic shrinking, so the two cannot drift apart. */
const MIN_QUALITY = 10;
const MAX_QUALITY = 100;
const DEFAULT_QUALITY = 75;
/** A one-pixel bound is pointless but harmless; anything below it cannot be resized to. */
const MIN_MAX_WIDTH_HEIGHT = 1;

/** Compresses every image the given note holds: an image note's own content, or its attachments. */
export async function compressNoteImages(noteId: string, options?: ImageCompressionOptions): Promise<ImageCompressionResponse> {
    const note = becca.getNote(noteId);

    if (!note) {
        throw new NotFoundError(`Note '${noteId}' was not found.`);
    }

    return compressTargets(collectNoteTargets(note), resolveCompressionRequest(options));
}

/** Compresses one image attachment, under exactly the rules a whole-note run would apply to it. */
export async function compressAttachmentImage(attachmentId: string, options?: ImageCompressionOptions): Promise<ImageCompressionResponse> {
    const attachment = becca.getAttachment(attachmentId);

    if (!attachment) {
        throw new NotFoundError(`Attachment '${attachmentId}' was not found.`);
    }

    if (attachment.role !== "image") {
        throw new ValidationError(`Attachment '${attachmentId}' has role '${attachment.role}', but 'image' was expected.`);
    }

    return compressTargets([ attachmentTarget(attachment) ], resolveCompressionRequest(options));
}

/**
 * Fills in what the request left out and rejects what it got wrong, so a provider always receives
 * complete, sane parameters. An out-of-range stored option falls back to the default rather than
 * failing the request — the caller did not choose that value and cannot fix it from here.
 */
export function resolveCompressionRequest(options: ImageCompressionOptions = {}): ImageCompressionRequest {
    const { maxWidthHeight, quality, convertLossless } = options;

    if (maxWidthHeight !== undefined && (!Number.isInteger(maxWidthHeight) || maxWidthHeight < MIN_MAX_WIDTH_HEIGHT)) {
        throw new ValidationError(`maxWidthHeight must be an integer of ${MIN_MAX_WIDTH_HEIGHT} or above.`);
    }

    if (quality !== undefined && (!Number.isInteger(quality) || quality < MIN_QUALITY || quality > MAX_QUALITY)) {
        throw new ValidationError(`quality must be an integer between ${MIN_QUALITY} and ${MAX_QUALITY}.`);
    }

    if (convertLossless !== undefined && typeof convertLossless !== "boolean") {
        throw new ValidationError("convertLossless must be a boolean.");
    }

    return {
        maxWidthHeight: maxWidthHeight ?? optionService.getOptionInt("imageMaxWidthHeight"),
        quality: quality ?? defaultQuality(),
        convertLossless: convertLossless ?? false
    };
}

function defaultQuality(): number {
    const configured = optionService.getOptionInt("imageJpegQuality", 0);

    return configured >= MIN_QUALITY && configured <= MAX_QUALITY ? configured : DEFAULT_QUALITY;
}

/**
 * One image the run can act on, hiding whether it lives in a note's content or in an attachment.
 *
 * Neither kind is renamed when its format changes: an attachment's title is a reference elsewhere
 * (a canvas addresses its images by the Excalidraw file id stored as the title), and download and
 * export filenames already derive their extension from the mime when the title disagrees.
 */
interface CompressionTarget {
    entityType: "note" | "attachment";
    entityId: string;
    title: string;
    mime: string;
    /** Set when the target must be left alone for a reason known before reading its content. */
    skip?: ImageCompressionSkipReason;
    getContent(): Uint8Array;
    save(buffer: Uint8Array, mime: string): void;
}

/**
 * The images a note holds. An image note *is* its image, so it stands alone; for anything else the
 * images are the attachments it owns — which is where a text note's pictures live, and where the
 * weight the user is trying to shed actually sits.
 *
 * Child notes are deliberately not followed: a child can be a clone shared with other notes, and
 * shrinking a note should not silently degrade an image somewhere else.
 */
function collectNoteTargets(note: BNote): CompressionTarget[] {
    if (note.type === "image") {
        return [ noteTarget(note) ];
    }

    return note.getAttachmentsByRole("image").map((attachment) => attachmentTarget(attachment));
}

function noteTarget(note: BNote): CompressionTarget {
    return {
        entityType: "note",
        entityId: note.noteId,
        title: note.title,
        mime: note.mime,
        skip: note.isContentAvailable() ? undefined : "protected",
        getContent: () => wrapStringOrBuffer(note.getContent()),
        save(buffer, mime) {
            note.mime = mime;
            note.save();
            note.setContent(buffer, { forceSave: true });
        }
    };
}

function attachmentTarget(attachment: BAttachment): CompressionTarget {
    return {
        entityType: "attachment",
        entityId: attachment.attachmentId ?? "",
        title: attachment.title,
        mime: attachment.mime,
        skip: resolveAttachmentSkip(attachment),
        getContent: () => wrapStringOrBuffer(attachment.getContent()),
        save(buffer, mime) {
            attachment.mime = mime;
            attachment.setContent(buffer, { forceSave: true });
        }
    };
}

/**
 * A canvas, mermaid, mind map or spreadsheet note carries its rendered picture in an attachment of
 * a fixed title. Those are regenerated whenever the note is saved, so compressing one buys nothing
 * and lasts until the next save; worse, the route serving the spreadsheet's picture declares it
 * `image/png` unconditionally, so converting it to JPEG would serve bytes under the wrong type.
 */
function resolveAttachmentSkip(attachment: BAttachment): ImageCompressionSkipReason | undefined {
    if (!attachment.isContentAvailable()) {
        return "protected";
    }

    const ownerNote = attachment.getNote();

    if (ownerNote && attachment.title === getImageAttachmentTitle(ownerNote.type)) {
        return "generated";
    }

    return undefined;
}

async function compressTargets(targets: CompressionTarget[], request: ImageCompressionRequest): Promise<ImageCompressionResponse> {
    const items: ImageCompressionItem[] = [];

    for (const target of targets) {
        items.push(await compressTarget(target, request));
    }

    return summarize(items);
}

async function compressTarget(target: CompressionTarget, request: ImageCompressionRequest): Promise<ImageCompressionItem> {
    const skipped = (originalSize: number, skipReason: ImageCompressionSkipReason): ImageCompressionItem => ({
        entityType: target.entityType,
        entityId: target.entityId,
        title: target.title,
        mime: target.mime,
        originalSize,
        newSize: originalSize,
        compressed: false,
        skipReason
    });

    // Protected content cannot even be read without a session, so it is the one skip decided
    // without a size to report; every other one still reports what the image weighs.
    if (target.skip === "protected") {
        return skipped(0, "protected");
    }

    // One image failing is reported as that image's own skip and nothing more: the images after it
    // in the same run are still worth compressing.
    let content: Uint8Array | undefined;

    try {
        content = target.getContent();

        if (target.skip) {
            return skipped(content.byteLength, target.skip);
        }

        const outcome = await getImageProvider().compressImage(content, request);

        if (!outcome.compressed) {
            return skipped(content.byteLength, outcome.reason);
        }

        // The compression itself is asynchronous, so the write is a separate transaction of its
        // own rather than one held open across it.
        getSql().transactional(() => target.save(outcome.buffer, outcome.format.mime));

        getLog().info(
            `Compressed ${target.entityType} '${target.entityId}' from ${content.byteLength} to ${outcome.buffer.byteLength} bytes.`
        );

        return {
            entityType: target.entityType,
            entityId: target.entityId,
            title: target.title,
            mime: outcome.format.mime,
            originalSize: content.byteLength,
            newSize: outcome.buffer.byteLength,
            compressed: true
        };
    } catch (e: unknown) {
        logFailure(target, e);
        return skipped(content?.byteLength ?? 0, "error");
    }
}

function logFailure(target: CompressionTarget, e: unknown) {
    const error = e as Error;

    getLog().error(`Failed to compress ${target.entityType} '${target.entityId}': ${error?.stack ?? error}`);
}

function summarize(items: ImageCompressionItem[]): ImageCompressionResponse {
    const originalSize = items.reduce((total, item) => total + item.originalSize, 0);
    const newSize = items.reduce((total, item) => total + item.newSize, 0);

    return {
        items,
        compressedCount: items.filter((item) => item.compressed).length,
        skippedCount: items.filter((item) => !item.compressed).length,
        originalSize,
        newSize,
        savedSize: originalSize - newSize
    };
}

export default {
    compressNoteImages,
    compressAttachmentImage,
    resolveCompressionRequest
};
