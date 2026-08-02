/**
 * Server-side image provider implementation.
 *
 * The compression itself lives in {@link image_codec}, which knows nothing about Trilium so that a
 * worker can run it. What is left here is everything that does: the options the automatic shrinking
 * reads, the logger the codec has no way to reach, and the platform interface core calls through.
 */

import { getLog, options as optionService } from "@triliumnext/core";
import type { ImageCompressionOutcome, ImageCompressionPlan, ImageCompressionRequest, ImageFormat, ImageProvider, ProcessedImage } from "@triliumnext/core/src/services/image_provider.js";
import isAnimated from "is-animated";

import { compressInWorker, compressionConcurrency } from "./image_worker_pool.js";

import {
    asBuffer,
    DECODE_MEMORY_MB,
    compressImageBytes,
    decodeCostOf,
    decodeImage,
    detectSvg,
    getImageTypeFromBuffer,
    planFromBytes
} from "./image_codec.js";

/**
 * Lines the codec produced, written where the rest of the server's logging goes.
 *
 * Per-image detail is dropped unless it was asked for. The backend log is a note the client reads,
 * and re-reads as it grows: a line an image over several hundred images is most of that file, and
 * serving it back is work this process does instead of compressing. Set
 * `TRILIUM_IMAGE_WORKER_DEBUG` to keep them.
 */
const toBackendLog = (message: string, detail?: boolean) => {
    if (!detail || process.env.TRILIUM_IMAGE_WORKER_DEBUG) {
        getLog().info(message);
    }
};

async function shrinkImage(buffer: Uint8Array, originalName: string): Promise<Uint8Array> {
    let jpegQuality = optionService.getOptionInt("imageJpegQuality", 0);

    if (jpegQuality < 10 || jpegQuality > 100) {
        jpegQuality = 75;
    }

    let finalImageBuffer: Uint8Array;
    try {
        finalImageBuffer = await resize(buffer, jpegQuality);
    } catch (e: unknown) {
        const error = e as Error;
        getLog().error(`Failed to resize image '${originalName}', stack: ${error.stack}`);
        finalImageBuffer = buffer;
    }

    // If resizing did not help with size, then save the original
    if (finalImageBuffer.byteLength >= buffer.byteLength) {
        finalImageBuffer = buffer;
    }

    return finalImageBuffer;
}

async function resize(buffer: Uint8Array, quality: number): Promise<Uint8Array> {
    const imageMaxWidthHeight = optionService.getOptionInt("imageMaxWidthHeight");

    const start = Date.now();

    const image = await decodeImage(buffer);

    if (image.bitmap.width > image.bitmap.height && image.bitmap.width > imageMaxWidthHeight) {
        image.resize({ w: imageMaxWidthHeight });
    } else if (image.bitmap.height > imageMaxWidthHeight) {
        image.resize({ h: imageMaxWidthHeight });
    }

    // When converting PNG to JPG, we lose the alpha channel - replace with white
    image.background = 0xffffffff;

    const resultBuffer = await image.getBuffer("image/jpeg", { quality });

    getLog().info(`Resizing image of ${resultBuffer.byteLength} took ${Date.now() - start}ms`);

    return resultBuffer;
}

export const serverImageProvider: ImageProvider = {
    getImageType(buffer: Uint8Array): ImageFormat | null {
        // SVG is the only format identifiable without reading a magic number asynchronously; the
        // rest are left to processImage. Guarded like the async path, so a buffer that cannot be a
        // document is answered from its first byte rather than from a string built out of all of it.
        return detectSvg(buffer);
    },

    async processImage(buffer: Uint8Array, originalName: string, shrink: boolean): Promise<ProcessedImage> {
        const compressImages = optionService.getOptionBool("compressImages");
        const origImageFormat = await getImageTypeFromBuffer(buffer);

        let shouldShrink = shrink;

        if (!origImageFormat || !["jpg", "png"].includes(origImageFormat.ext)) {
            shouldShrink = false;
        /* v8 ignore start -- rare defensive guard: spec-compliant animated images are
           already excluded above (file-type reports animated PNG as "apng" and animated
           GIF/WebP as gif/webp). Only a pathological PNG with 512+ chunks before its acTL
           chunk slips through (file-type bails to "png" at its chunk-scan limit while
           is-animated still flags it), so this guard correctly skips recompressing it. */
        } else if (isAnimated(asBuffer(buffer))) {
            // Recompression of animated images would make them static.
            shouldShrink = false;
        }
        /* v8 ignore stop */

        let finalBuffer: Uint8Array;
        let format: ImageFormat;

        if (compressImages && shouldShrink) {
            finalBuffer = await shrinkImage(buffer, originalName);
            /* v8 ignore next -- the "jpg" fallback is unreachable: shrinkImage returns
               either a detectable JPEG or the (jpg/png-detectable) original buffer. */
            format = (await getImageTypeFromBuffer(finalBuffer)) || { ext: "jpg", mime: "image/jpeg" };
        } else {
            finalBuffer = buffer;
            format = origImageFormat || { ext: "dat", mime: "application/octet-stream" };
        }

        return { buffer: finalBuffer, format };
    },

    async planCompression(header: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionPlan> {
        const plan = planFromBytes(await getImageTypeFromBuffer(header), header, request, toBackendLog);

        return plan.verdict === "skip"
            ? { skip: plan.reason, decodeCost: null }
            : { decodeCost: decodeCostOf(plan.declared) };
    },

    /**
     * Compresses off-thread where there are threads to do it on, and here where there are not.
     *
     * The distinction matters more than it looks. "No workers at all" is a property of the
     * installation — nothing was found to run, or nothing would start — and doing the work here is
     * then the only way to do it, exactly as before there were workers. "A worker failed on this
     * image" is a different thing entirely, and answering it by decoding here is a cure worse than
     * the illness: a decode does not yield, so the thread that serves the application stops serving
     * it for as long as it takes, several times over if several workers are failing. That is the
     * application freezing in order to save one image.
     *
     * So a failed worker fails its image. The run carries on, the image is reported untouched, and
     * running the tool again picks it up — none of which requires the application to stop.
     */
    async compressImage(buffer: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionOutcome> {
        const offThread = await compressInWorker(buffer, request, DECODE_MEMORY_MB);

        return offThread ?? compressImageBytes(buffer, request, toBackendLog);
    },

    compressionConcurrency
};
