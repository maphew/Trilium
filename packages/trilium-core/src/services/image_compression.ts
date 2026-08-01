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

import { type AttachmentRow, getImageAttachmentTitle, IMAGE_JPEG_HANDLINGS, IMAGE_PNG_HANDLINGS, type ImageCompressionItem, type ImageCompressionOptions, type ImageCompressionResponse, type ImageCompressionSkipReason } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import BAttachment from "../becca/entities/battachment.js";
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

/**
 * Where converting a lossless image starts, deliberately above {@link DEFAULT_QUALITY}: this is a
 * one-time transition away from a pristine original, so quality given up here is detail that was
 * genuinely there. Recompressing an image that has already been through an encoder is the opposite
 * trade — the loss is baked in, and spending quality on it buys back little.
 */
const DEFAULT_CONVERSION_QUALITY = 85;
/** A one-pixel bound is pointless but harmless; anything below it cannot be resized to. */
const MIN_MAX_WIDTH_HEIGHT = 1;

/** Compresses every image the given note holds: an image note's own content, or its attachments. */
export async function compressNoteImages(noteId: string, options?: ImageCompressionOptions): Promise<ImageCompressionResponse> {
    const note = becca.getNote(noteId);

    if (!note) {
        throw new NotFoundError(`Note '${noteId}' was not found.`);
    }

    return compressTargets(collectNoteTargets(note, resolveRecursive(options)), resolveCompressionRequest(options));
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
    const { resize, maxWidthHeight, jpegHandling, pngHandling, quality, conversionQuality } = options;

    requireQuality(quality, "quality");
    requireQuality(conversionQuality, "conversionQuality");
    requireBoolean(resize, "resize");
    requireOneOf(jpegHandling, IMAGE_JPEG_HANDLINGS, "jpegHandling");
    requireOneOf(pngHandling, IMAGE_PNG_HANDLINGS, "pngHandling");

    return {
        // Every step defaults to acting: a request that named none of them asked for the images to
        // be compressed, and narrowing that down is what the fields are for. For a PNG that means
        // being made smaller without ceasing to be one.
        resize: resize ?? true,
        maxWidthHeight: resolveMaxWidthHeight(maxWidthHeight),
        jpegHandling: jpegHandling ?? "compress",
        pngHandling: pngHandling ?? "optimize",
        quality: quality ?? defaultQuality(),
        conversionQuality: conversionQuality ?? DEFAULT_CONVERSION_QUALITY
    };
}

/**
 * The bound to measure images against, validated and filled in. Shared with the inventory, so what
 * it reports as oversized is oversized by exactly the rule a run would apply.
 */
export function resolveMaxWidthHeight(maxWidthHeight: number | undefined): number {
    if (maxWidthHeight === undefined) {
        return optionService.getOptionInt("imageMaxWidthHeight");
    }

    if (!Number.isInteger(maxWidthHeight) || maxWidthHeight < MIN_MAX_WIDTH_HEIGHT) {
        throw new ValidationError(`maxWidthHeight must be an integer of ${MIN_MAX_WIDTH_HEIGHT} or above.`);
    }

    return maxWidthHeight;
}

function requireBoolean(value: unknown, name: string) {
    if (value !== undefined && typeof value !== "boolean") {
        throw new ValidationError(`${name} must be a boolean.`);
    }
}

function requireOneOf<T extends string>(value: T | undefined, allowed: readonly T[], name: string) {
    if (value !== undefined && !allowed.includes(value)) {
        throw new ValidationError(`${name} must be one of: ${allowed.join(", ")}.`);
    }
}

function requireQuality(value: number | undefined, name: string) {
    if (value !== undefined && (!Number.isInteger(value) || value < MIN_QUALITY || value > MAX_QUALITY)) {
        throw new ValidationError(`${name} must be an integer between ${MIN_QUALITY} and ${MAX_QUALITY}.`);
    }
}

/**
 * Whether the run descends into the note's subtree. Read apart from {@link resolveCompressionRequest}
 * because it says nothing about how an image is compressed, only about which images are visited —
 * so the provider never sees it. The attachment endpoint has no use for it and does not read it.
 */
export function resolveRecursive(options: ImageCompressionOptions = {}): boolean {
    requireBoolean(options.recursive, "recursive");

    return options.recursive === true;
}

function defaultQuality(): number {
    const configured = optionService.getOptionInt("imageJpegQuality", 0);

    return configured >= MIN_QUALITY && configured <= MAX_QUALITY ? configured : DEFAULT_QUALITY;
}

/** What an image weighs, and enough of its front to say what it is. */
export interface TargetPeek {
    /** The stored image's size in bytes — the whole of it, not of {@link header}. */
    size: number;
    header: Uint8Array;
}

/**
 * How much of an image is read to identify it.
 *
 * A PNG states its dimensions within the first thirty-odd bytes, but a JPEG states them after
 * whatever metadata precedes them, and a camera's EXIF thumbnail or an embedded colour profile can
 * run to tens of kilobytes. This is picked to clear those: past it the reading simply comes back
 * without dimensions, and the image is read in full as it was before — slower, never wrong.
 */
export const HEADER_BYTES = 64 * 1024;

/**
 * One image the run can act on, hiding whether it lives in a note's content or in an attachment.
 *
 * Neither kind is renamed when its format changes: an attachment's title is a reference elsewhere
 * (a canvas addresses its images by the Excalidraw file id stored as the title), and download and
 * export filenames already derive their extension from the mime when the title disagrees.
 */
export interface CompressionTarget {
    entityType: "note" | "attachment";
    entityId: string;
    title: string;
    mime: string;
    /** Set when the target must be left alone for a reason known before reading its content. */
    skip?: ImageCompressionSkipReason;
    getContent(): Uint8Array;
    /**
     * The image's size and its opening bytes, taken from the database without loading the rest.
     *
     * What decides an image's fate is almost entirely in its header, and reading a whole photograph
     * to look at thirty bytes of it is most of what a run over a large tree spends its time on.
     *
     * Null where the bytes in the database are not the bytes of the image — protected content is
     * stored encrypted, and a header read off the ciphertext describes nothing. The caller falls
     * back to reading it in full, which is what decrypts it.
     */
    peek(): TargetPeek | null;
    /** Names the content {@link getContent} returns — a hash of those exact bytes. */
    blobId(): string | undefined;
    /**
     * Writes the compressed image back, but only over the content it was derived from: re-encoding
     * is slow enough for the image to be replaced meanwhile, and this result describes the picture
     * that was there before. Answers whether the write happened.
     */
    save(buffer: Uint8Array, mime: string, sourceBlobId: string | undefined): boolean;
}

/**
 * The images the run will visit, in the order it visits them.
 *
 * Child notes are followed only when asked for: a descendant can be a clone shared with other
 * notes, so reaching into the subtree degrades images the caller may not have had in mind.
 * `getSubtree` visits each note once however many placements it has, leaves the hidden subtree out
 * and does not resolve search notes — the run follows the tree, not what a query happens to match.
 */
export function collectNoteTargets(note: BNote, recursive: boolean): CompressionTarget[] {
    return collectNoteImages(note, recursive).targets;
}

/**
 * The same images, with the notes they were gathered from — for a caller that has to say how far
 * the reading reached. One walk answers both; asking the subtree twice would not.
 */
export function collectNoteImages(note: BNote, recursive: boolean): { notes: BNote[]; targets: CompressionTarget[] } {
    const notes = recursive ? note.getSubtree().notes : [ note ];
    // An image note *is* its image and stands alone, so it is never asked what it has attached.
    const attachments = imageAttachmentsOf(notes.filter((candidate) => candidate.type !== "image"));

    // Note by note, in the order the subtree gave them, each note's own images in position order —
    // the order a run reports on and the user reads back.
    const targets = notes.flatMap((candidate) => candidate.type === "image"
        ? [ noteTarget(candidate) ]
        : (attachments.get(candidate.noteId) ?? []).map((attachment) => attachmentTarget(attachment)));

    return { notes, targets };
}

/**
 * Every image attachment the given notes own, gathered in one query and grouped by owner.
 *
 * Asked note by note this was a round trip each: cheap on its own, and ten thousand of them for a
 * subtree of that many notes. Once the images themselves stopped being read to decide their fate,
 * that was most of what collecting them cost.
 */
function imageAttachmentsOf(notes: BNote[]): Map<string, BAttachment[]> {
    const byOwner = new Map<string, BAttachment[]>();

    if (!notes.length) {
        return byOwner;
    }

    const sql = getSql();
    // Through the parameter table rather than an `IN` list: a subtree runs to more note ids than a
    // statement is allowed parameters, and this is how the rest of core asks the same kind of
    // question.
    sql.fillParamList(notes.map((candidate) => candidate.noteId));

    const rows = sql.getRows<AttachmentRow>(/*sql*/`
        SELECT attachments.*
        FROM attachments
        JOIN param_list ON param_list.paramId = attachments.ownerId
        WHERE attachments.role = 'image'
          AND attachments.isDeleted = 0
        ORDER BY attachments.ownerId, attachments.position`);

    for (const row of rows) {
        const owned = byOwner.get(row.ownerId);
        const attachment = new BAttachment(row);

        if (owned) {
            owned.push(attachment);
        } else {
            byOwner.set(row.ownerId, [ attachment ]);
        }
    }

    return byOwner;
}


function noteTarget(note: BNote): CompressionTarget {
    return {
        entityType: "note",
        entityId: note.noteId,
        title: note.title,
        mime: note.mime,
        skip: note.isContentAvailable() ? undefined : "protected",
        getContent: () => wrapStringOrBuffer(note.getContent()),
        peek: () => peekBlob(note.blobId, note.isProtected),
        blobId: () => note.blobId,
        save(buffer, mime, sourceBlobId) {
            const current = becca.getNote(note.noteId);

            if (!current || current.blobId !== sourceBlobId) {
                return false;
            }

            current.mime = mime;
            current.save();
            current.setContent(buffer, { forceSave: true });

            return true;
        }
    };
}

function attachmentTarget(attachment: BAttachment): CompressionTarget {
    const attachmentId = attachment.attachmentId ?? "";

    return {
        entityType: "attachment",
        entityId: attachmentId,
        title: attachment.title,
        mime: attachment.mime,
        skip: resolveAttachmentSkip(attachment),
        getContent: () => wrapStringOrBuffer(attachment.getContent()),
        peek: () => peekBlob(attachment.blobId, attachment.isProtected),
        blobId: () => attachment.blobId,
        // Written through a freshly read attachment rather than the one collected at the start of
        // the run: that one is a detached copy of its row, and `forceSave` writes the whole row
        // back, which would undo a title or position changed since — a subtree run is long.
        save(buffer, mime, sourceBlobId) {
            const current = becca.getAttachment(attachmentId);

            if (!current || current.blobId !== sourceBlobId) {
                return false;
            }

            current.mime = mime;
            current.setContent(buffer, { forceSave: true });

            return true;
        }
    };
}

/**
 * Reads an image's weight and its opening bytes straight out of the blob, leaving the body of it in
 * the database. One statement answers both, so the saving is a smaller read rather than a second
 * round trip.
 *
 * `CAST` on both: a blob column can hold text for other kinds of content, where `LENGTH` would
 * count characters and `substr` would cut on them. Bytes are what an image header is measured in.
 */
function peekBlob(blobId: string | undefined, isProtected: boolean | undefined): TargetPeek | null {
    if (!blobId || isProtected) {
        return null;
    }

    const row = getSql().getRow<{ size: number | null; header: string | Uint8Array | null }>(/*sql*/`
        SELECT LENGTH(CAST(content AS BLOB)) AS size,
               substr(CAST(content AS BLOB), 1, ?) AS header
        FROM blobs WHERE blobId = ?`, [ HEADER_BYTES, blobId ]);

    if (!row || row.size === null || row.header === null) {
        return null;
    }

    return { size: row.size, header: wrapStringOrBuffer(row.header) };
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
        // The front of the image and what it weighs, without the body of it. Most images a run
        // visits are settled from this alone, and never read any further.
        const peeked = target.peek();

        if (target.skip) {
            return skipped(peeked?.size ?? target.getContent().byteLength, target.skip);
        }

        if (peeked) {
            const foreseen = await getImageProvider().planCompression(peeked.header, request);

            if (foreseen) {
                return skipped(peeked.size, foreseen);
            }
        }

        content = target.getContent();
        // Read in the same turn as the content itself, so it names exactly the bytes just read.
        const sourceBlobId = target.blobId();

        const outcome = await getImageProvider().compressImage(content, request);

        if (!outcome.compressed) {
            return skipped(content.byteLength, outcome.reason);
        }

        // The compression itself is asynchronous, so the write is a separate transaction of its
        // own rather than one held open across it. Long enough, in fact, for the image to have been
        // replaced meanwhile — by another request, or by an incoming synchronisation update — and
        // these bytes are a smaller copy of the picture that replacement got rid of. Nothing here
        // is worth putting that back, so the newer image wins and this one is reported as skipped.
        const saved = getSql().transactional(() => target.save(outcome.buffer, outcome.format.mime, sourceBlobId));

        if (!saved) {
            getLog().info(
                `Left ${target.entityType} '${target.entityId}' alone: its content changed while it was being compressed.`
            );

            return skipped(content.byteLength, "changed");
        }

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
    resolveCompressionRequest,
    resolveRecursive
};
