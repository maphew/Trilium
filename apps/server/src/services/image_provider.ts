/**
 * Server-side image provider implementation.
 * Uses JIMP for image processing with full compression support.
 */

import { IMAGE_COMPRESSIBLE_FORMATS } from "@triliumnext/commons";
import { estimateJpegQuality, getLog, options as optionService } from "@triliumnext/core";
import type { ImageCompressionOutcome, ImageCompressionRequest, ImageFormat, ImageProvider, ProcessedImage } from "@triliumnext/core/src/services/image_provider.js";
import imageType from "image-type";
import isAnimated from "is-animated";
import isSvg from "is-svg";
import { Jimp } from "jimp";
import * as UPNG from "upng-js";

const JPEG_FORMAT: ImageFormat = { ext: "jpg", mime: "image/jpeg" };
const PNG_FORMAT: ImageFormat = { ext: "png", mime: "image/png" };

/** The only formats JIMP can both decode and re-encode here; everything else is left untouched. */
const COMPRESSIBLE_EXTENSIONS = new Set<string>(IMAGE_COMPRESSIBLE_FORMATS);

/**
 * How large a palette the PNG quantizer may keep — deliberately the largest an indexed PNG can
 * hold, which makes this the gentlest lossy setting there is while still doing the work.
 *
 * The saving comes from storing one index per pixel rather than 24-bit colour, so a screenshot or
 * a diagram — what most PNGs in a note actually are — typically loses half its weight or better
 * with nothing visible to show for it. Going lower (64, 128) starts to band across gradients, and
 * encoding losslessly instead (0) rarely reaches a fifth. Neither extreme is the trade this tool
 * is for.
 */
const PNG_PALETTE_COLORS = 256;

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
        const needsResize = request.resize && Math.max(width, height) > request.maxWidthHeight;
        const isLossless = format.ext === "png";

        // Only consulted where it changes the answer. JPEG has no alpha channel, so a transparent
        // image cannot be converted — it is optimized instead, that being the best still available
        // to it. The check reads the decoded pixels, so it is exact rather than a guess from the
        // header, and it is skipped entirely where nothing is going to be converted anyway.
        const convertible = isLossless && request.pngHandling === "jpeg" && !hasTransparency(image);

        // What the image will be written back as. A JPEG can only ever be written back as one.
        const toJpeg = !isLossless || convertible;
        // A PNG that is staying a PNG is quantized unless it was to be left alone outright — which
        // covers both `optimize` and a transparent image that `jpeg` could not take.
        const quantize = isLossless && !toJpeg && request.pngHandling !== "keep";

        // Whether re-encoding alone is worth doing to *this* image, each kind answering for itself:
        // a lossy source when its handling asks for it, a lossless one when its handling asks for
        // anything at all — rewriting a PNG as the same PNG at its own size gains nothing.
        const worthReencoding = isLossless ? (toJpeg || quantize) : request.jpegHandling === "compress";

        if (!needsResize && !worthReencoding) {
            return { compressed: false, reason: "no-gain" };
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
            // Reached either by conversion, which has already established there is no transparency
            // to lose, or by a JPEG source, which never had any to begin with.
            image.background = 0xffffffff;
            result = await image.getBuffer("image/jpeg", { quality: jpegQualityFor(request, isLossless, buffer) });
        } else if (quantize) {
            result = quantizePng(image, buffer.byteLength);
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

/**
 * Which quality a JPEG about to be written is owed. Converting a pristine original and recompressing
 * an already-lossy one are different trades, so each has a setting of its own.
 *
 * The third case has neither: a JPEG only being scaled, its handling left on `keep`. It has to be
 * re-encoded all the same — there is no way to write scaled pixels without one — so it goes out at
 * whatever quality it was already stored at, read off its own quantization table. Anything fixed
 * would be wrong in both directions: below the source it degrades an image nobody asked to degrade,
 * and above it the bytes-per-pixel rise can outweigh the pixels removed, leaving a modest resize
 * *larger* than it started and rejected by the size guard — the resize silently undone.
 */
function jpegQualityFor(request: ImageCompressionRequest, isLossless: boolean, source: Uint8Array): number {
    if (isLossless) {
        return request.conversionQuality;
    }

    if (request.jpegHandling === "compress") {
        return request.quality;
    }

    return estimateJpegQuality(source) ?? FALLBACK_RESIZE_QUALITY;
}

/**
 * Stands in when a JPEG's own quality cannot be read — an unusual table, or an encoder that scales
 * the standard one its own way. High enough that "keep" is not quietly made to mean "degrade",
 * accepting that a mild resize of a heavily compressed original may then not pay for itself.
 */
const FALLBACK_RESIZE_QUALITY = 92;

/**
 * Rewrites the image as a palette PNG, which is where a PNG's weight actually goes: the saving
 * comes from storing an index per pixel instead of 24-bit colour, not from discarding detail. The
 * alpha channel survives it, so this is the only step that can shrink a transparent image at all.
 *
 * @param originalByteLength the source file, for the ratio in the log line. After a resize the two
 *                           are not measuring the same picture, which is the reading that matters
 *                           anyway — how much smaller the stored image ends up.
 */
function quantizePng(image: Awaited<ReturnType<typeof Jimp.read>>, originalByteLength: number): Uint8Array {
    const start = Date.now();
    const { width, height, data } = image.bitmap;
    // A tightly packed copy: UPNG reads the whole ArrayBuffer, so a view carrying a byte offset or
    // slack past the pixels would be read as image data.
    const rgba = new Uint8Array(data);
    const encoded = new Uint8Array(UPNG.encode([ rgba.buffer ], width, height, PNG_PALETTE_COLORS));
    const saved = Math.round((1 - encoded.byteLength / originalByteLength) * 100);

    getLog().info(
        `PNG optimization of ${width}x${height} to ${PNG_PALETTE_COLORS} colors: `
        + `${originalByteLength} -> ${encoded.byteLength} bytes (${saved}% smaller) in ${Date.now() - start}ms`
    );

    return encoded;
}

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
