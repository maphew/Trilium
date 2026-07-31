import type { ImageCompressionResponse } from "@triliumnext/commons";

import { t } from "../../../../../services/i18n";
import server from "../../../../../services/server";
import { formatSize } from "../../../../../services/utils";
import type { ImageCompressionToolOptions } from "./image_compression_options";

/**
 * What a compression run acts on: a whole note — its own image, or the images its attachments hold
 * — or a single attachment picked out on its own.
 */
export type ImageCompressionTarget =
    | { type: "note"; noteId: string }
    | { type: "attachment"; attachmentId: string };

/** Shared by every stage of a run, so the message is swapped in place rather than stacked. */
export const IMAGE_COMPRESSION_TOAST_ID = "image-compression";

/**
 * Decoding and re-encoding is measured in seconds per image, and a subtree run can hold thousands
 * of them. The default minute would not stop the server working — it would only lose the answer and
 * report a failure for something that went on to succeed.
 */
const COMPRESSION_TIMEOUT_MS = 60 * 60 * 1000;

/** Compresses the target's images and reports what that did, image by image and in total. */
export function runImageCompression(
    target: ImageCompressionTarget,
    options: ImageCompressionToolOptions
): Promise<ImageCompressionResponse> {
    const url = target.type === "note"
        ? `notes/${target.noteId}/compress-images`
        : `attachments/${target.attachmentId}/compress-image`;

    return server.postWithTimeout<ImageCompressionResponse>(url, COMPRESSION_TIMEOUT_MS, {
        maxWidthHeight: options.maxWidthHeight,
        quality: options.quality,
        convertLossless: options.convertLossless,
        // Left out entirely for an attachment, which has no subtree to descend into — the endpoint
        // does not read it, and sending it would suggest it does.
        ...(target.type === "note" ? { recursive: options.processChildNotes } : {})
    });
}

/**
 * What the run is told to have done. Every image it visited is counted, skipped ones included, so
 * the count and the two sizes are all measured over the same set and read as one sentence.
 *
 * A run that saved nothing says so rather than quoting a size that did not move: "from 45 MiB to
 * 45 MiB" reads as a failure to report, where it is in fact a complete and correct answer — the
 * images were already as small as these settings can make them.
 */
export function compressionResultMessage(result: ImageCompressionResponse): string {
    const count = result.items.length;

    if (count === 0) {
        return t("space_usage.compress_result_none");
    }

    if (result.savedSize <= 0) {
        return t("space_usage.compress_result_no_gain", { count });
    }

    return t("space_usage.compress_result", {
        count,
        before: formatSize(result.originalSize),
        after: formatSize(result.newSize)
    });
}
