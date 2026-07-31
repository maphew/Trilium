/**
 * Server-side image provider implementation.
 * Uses JIMP for image processing with full compression support.
 */

import { getLog, options as optionService } from "@triliumnext/core";
import type { ImageCompressionOutcome, ImageCompressionRequest, ImageFormat, ImageProvider, ProcessedImage } from "@triliumnext/core/src/services/image_provider.js";
import imageType from "image-type";
import isAnimated from "is-animated";
import isSvg from "is-svg";
import { Jimp } from "jimp";

const JPEG_FORMAT: ImageFormat = { ext: "jpg", mime: "image/jpeg" };
const PNG_FORMAT: ImageFormat = { ext: "png", mime: "image/png" };

/** The only formats JIMP can both decode and re-encode here; everything else is left untouched. */
const COMPRESSIBLE_EXTENSIONS = new Set([ "jpg", "png" ]);

async function getImageTypeFromBuffer(buffer: Uint8Array): Promise<ImageFormat | null> {
    // Check for SVG first (text-based)
    if (isSvg(Buffer.from(buffer).toString())) {
        return { ext: "svg", mime: "image/svg+xml" };
    }

    const detected = await imageType(buffer);
    if (detected) {
        return { ext: detected.ext, mime: detected.mime };
    }

    return null;
}

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

    const image = await Jimp.read(Buffer.from(buffer));

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
        // Synchronous check for SVG
        if (isSvg(Buffer.from(buffer).toString())) {
            return { ext: "svg", mime: "image/svg+xml" };
        }

        // For other formats, we need async detection but interface is sync
        // Return null and let processImage handle the async detection
        return null;
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
        } else if (isAnimated(Buffer.from(buffer))) {
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

    async compressImage(buffer: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionOutcome> {
        const format = await getImageTypeFromBuffer(buffer);

        if (!format || !COMPRESSIBLE_EXTENSIONS.has(format.ext)) {
            return { compressed: false, reason: "unsupported-format" };
        }

        /* v8 ignore start -- the same rare defensive guard as in processImage above: spec-compliant
           animated images already fail the format gate (file-type reports animated PNG as "apng"
           and animated GIF/WebP as gif/webp). Only a pathological PNG with 512+ chunks before its
           acTL chunk reaches here, and recompressing it would keep the first frame alone. */
        if (isAnimated(Buffer.from(buffer))) {
            return { compressed: false, reason: "animated" };
        }
        /* v8 ignore stop */

        const start = Date.now();
        const image = await Jimp.read(Buffer.from(buffer));
        const { width, height } = image.bitmap;
        const needsResize = Math.max(width, height) > request.maxWidthHeight;
        const isLossless = format.ext === "png";

        // JPEG has no alpha channel, so a transparent PNG would come back with its transparency
        // filled in — the one conversion that visibly damages an image rather than degrading it.
        // The check reads the decoded pixels, so it is exact rather than a guess from the header.
        const toJpeg = !isLossless || (request.convertLossless && !hasTransparency(image));

        if (!toJpeg && !needsResize) {
            // Nothing left to do: re-encoding a PNG at its own size is lossless and pointless.
            return { compressed: false, reason: isLossless && request.convertLossless ? "transparent" : "no-gain" };
        }

        if (needsResize) {
            if (width >= height) {
                image.resize({ w: request.maxWidthHeight });
            } else {
                image.resize({ h: request.maxWidthHeight });
            }
        }

        let result: Uint8Array;

        if (toJpeg) {
            // Whatever transparency survives here is known to be absent or deliberately discarded.
            image.background = 0xffffffff;
            result = await image.getBuffer("image/jpeg", { quality: request.quality });
        } else {
            result = await image.getBuffer("image/png");
        }

        getLog().info(`Compressing image of ${buffer.byteLength} bytes took ${Date.now() - start}ms`);

        if (result.byteLength >= buffer.byteLength) {
            // A small or already well-compressed image can grow; the original stays.
            return { compressed: false, reason: "no-gain" };
        }

        return { compressed: true, buffer: result, format: toJpeg ? JPEG_FORMAT : PNG_FORMAT };
    }
};

/** True when any pixel is less than fully opaque, read off the decoded RGBA bitmap. */
function hasTransparency(image: Awaited<ReturnType<typeof Jimp.read>>): boolean {
    const { data } = image.bitmap;

    for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) {
            return true;
        }
    }

    return false;
}
