/**
 * Server-side image provider implementation.
 * Uses JIMP for image processing with full compression support.
 */

import { IMAGE_COMPRESSIBLE_FORMATS, type ImageCompressionSkipReason } from "@triliumnext/commons";
import { estimateJpegQuality, getLog, type InspectedImage, inspectImage, options as optionService } from "@triliumnext/core";
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
 * What one JPEG decode may allocate.
 *
 * jpeg-js budgets 512 MB and refuses outright to decode anything needing more, which a photograph
 * off a modern camera or a flatbed scan exceeds on its own — and those are exactly the images worth
 * compressing, so the default withholds the feature precisely where it was wanted. A decode holds
 * the coefficient blocks, the per-component planes and the RGBA bitmap at once, on the order of a
 * dozen bytes per pixel, so this reaches into the tens of megapixels.
 *
 * Raised rather than lifted: it is still what stops a malformed header claiming a size no machine
 * has, and images are decoded one at a time, so this is the peak rather than a budget shared out.
 */
const DECODE_MEMORY_MB = 1024;
const DECODE_OPTIONS = { "image/jpeg": { maxMemoryUsageInMB: DECODE_MEMORY_MB } };

/**
 * What a decode is taken to want, per pixel of the image.
 *
 * jpeg-js counts every allocation it makes and credits none of them back, so what it weighs against
 * its budget is the sum of all of them: the coefficient blocks it holds per component (4 bytes a
 * pixel each), the per-component planes (1 each), the interleaved component data (1 a component)
 * and the RGBA bitmap at the end (4). For an ordinary photograph, whose chroma planes are stored at
 * a quarter resolution, that comes to about 15.
 *
 * Rounded up from there, so the ceiling below sits inside the budget rather than exactly on it. An
 * image stored without chroma subsampling wants nearer 22 and can still exceed the budget while
 * under this ceiling; that decode fails as it always did, reported against the one image.
 */
const DECODE_BYTES_PER_PIXEL = 16;

/**
 * The most pixels an image may have and still be worth attempting.
 *
 * Derived from the budget rather than chosen beside it, so raising one raises the other. Applied to
 * PNG as well, which has no budget of its own at all: pngjs decodes whatever it is given until the
 * process runs out of memory, and a ceiling refused here is the only guard it gets.
 */
const MAX_DECODE_PIXELS = Math.floor((DECODE_MEMORY_MB * 1024 * 1024) / DECODE_BYTES_PER_PIXEL);

type CompressionPlan =
    | { verdict: "skip"; reason: ImageCompressionSkipReason }
    | { verdict: "proceed"; isLossless: boolean; worthReencoding: boolean };

/**
 * What is to become of an image, decided from as much of it as the caller had.
 *
 * Every question here is answered from the header, which is what lets the same reasoning serve a
 * run deciding whether an image is worth reading at all and the compression that follows once it
 * has been. Given only the front of a file it errs one way: a dimension it cannot reach leaves the
 * image to be read in full, never leaves it skipped on a reading that was never taken.
 */
function planFromBytes(
    format: ImageFormat | null,
    bytes: Uint8Array,
    request: ImageCompressionRequest
): CompressionPlan {
    if (!format || !COMPRESSIBLE_EXTENSIONS.has(format.ext)) {
        return { verdict: "skip", reason: "unsupported-format" };
    }

    /* v8 ignore start -- the same rare defensive guard as in processImage above: spec-compliant
       animated images already fail the format gate (file-type reports animated PNG as "apng"
       and animated GIF/WebP as gif/webp). Only a pathological PNG with 512+ chunks before its
       acTL chunk reaches here, and recompressing it would keep the first frame alone. */
    if (isAnimated(asBuffer(bytes))) {
        return { verdict: "skip", reason: "animated" };
    }
    /* v8 ignore stop */

    const isLossless = format.ext === "png";

    // Whether re-encoding alone is worth doing to *this* image, each kind answering for itself:
    // a lossy source when its handling asks for it, a lossless one when its handling asks for
    // anything at all — rewriting a PNG as the same PNG at its own size gains nothing.
    //
    // A PNG's transparency does not enter into it, though it decides *which* re-encoding happens:
    // an image `jpeg` cannot take is quantized instead, so either way there is one to do. That is
    // what lets this be answered before the image is decoded.
    const worthReencoding = isLossless ? request.pngHandling !== "keep" : request.jpegHandling === "compress";

    // Read off the header rather than from the pixels: deciding whether anything is going to happen
    // to an image should not cost more than doing it. Dimensions the header does not give up — past
    // the end of a prefix, or behind metadata — leave this open, and the decode settles it.
    const declared = inspectImage(bytes);
    const declaredEdge = Math.max(declared.width ?? 0, declared.height ?? 0);
    const mayNeedResize = request.resize && (declaredEdge === 0 || declaredEdge > request.maxWidthHeight);

    if (!mayNeedResize && !worthReencoding) {
        return { verdict: "skip", reason: "no-gain" };
    }

    if (exceedsDecodeCeiling(declared)) {
        getLog().info(`Image of ${declared.width}x${declared.height} is too large to decode; leaving it alone.`);

        return { verdict: "skip", reason: "too-large" };
    }

    return { verdict: "proceed", isLossless, worthReencoding };
}

/**
 * Whether the header claims more pixels than {@link MAX_DECODE_PIXELS} allows.
 *
 * A header that says nothing about its dimensions is not evidence of anything, so it is allowed
 * through: the decoder's own budget is still there to stop it, and refusing on a reading that was
 * never taken would withhold the feature from images that are perfectly ordinary.
 */
function exceedsDecodeCeiling({ width, height }: InspectedImage): boolean {
    return width !== null && height !== null && width * height > MAX_DECODE_PIXELS;
}

/**
 * Decodes an image with {@link DECODE_OPTIONS} applied.
 *
 * Not `Jimp.read`: it takes decode options in its signature and then calls `fromBuffer` without
 * them, so passing a memory budget there reads as correct and does nothing at all.
 */
function decodeImage(buffer: Uint8Array) {
    return Jimp.fromBuffer(asBuffer(buffer), DECODE_OPTIONS);
}

/**
 * The same bytes as a `Buffer`, over the same memory.
 *
 * `Buffer.from(uint8Array)` duplicates what it is given, and the libraries below each want one —
 * so an image was being copied whole several times on its way through, for readers that only ever
 * read. On a run over a tree that is a second copy of every photograph in it, allocated and thrown
 * away again, which costs more in collection than the copying does outright.
 */
function asBuffer(bytes: Uint8Array): Buffer {
    return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** What {@link decodeImage} hands back, for the helpers that work on a decoded image. */
type DecodedImage = Awaited<ReturnType<typeof decodeImage>>;

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

/**
 * What the buffer holds, read from its bytes.
 *
 * The binary formats are asked first, being identifiable from the few bytes of a magic number. SVG
 * has none — it is text, and the only way to recognise it is to read it — so it is asked last, of
 * whatever nothing else claimed, and only once the opening bytes suggest markup at all.
 *
 * That order is the whole point. `isSvg` validates the document it is given, so it needs the file
 * as a string in full; building one out of a photograph costs hundreds of milliseconds an image and
 * answers "no" every time. Asked in this order, no image ever pays for it.
 */
async function getImageTypeFromBuffer(buffer: Uint8Array): Promise<ImageFormat | null> {
    const detected = await imageType(buffer);

    if (detected) {
        return { ext: detected.ext, mime: detected.mime };
    }

    return detectSvg(buffer);
}

/**
 * SVG, or nothing. Guarded by a look at the opening bytes: `isSvg` takes a string, and turning a
 * buffer into one is the expensive part, so it is only worth doing for a buffer that begins the way
 * a document does.
 *
 * The guard is deliberately about the bytes rather than the content — anything opening with `<`,
 * declaration or comment or root element alike, goes through to `isSvg` and is judged there exactly
 * as it always was.
 */
function detectSvg(buffer: Uint8Array): ImageFormat | null {
    if (!opensLikeMarkup(buffer) || !isSvg(asBuffer(buffer).toString())) {
        return null;
    }

    return { ext: "svg", mime: "image/svg+xml" };
}

/** How far in to look for the first meaningful character; a document declares itself well inside this. */
const MARKUP_PROBE_BYTES = 64;

function opensLikeMarkup(buffer: Uint8Array): boolean {
    // A byte-order mark, which an editor may have written ahead of the declaration.
    let index = buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
    const limit = Math.min(buffer.byteLength, MARKUP_PROBE_BYTES);

    for (; index < limit; index++) {
        const byte = buffer[index];

        // Space, tab, line feed, carriage return: leading whitespace `isSvg` would trim anyway.
        if (byte === 0x20 || byte === 0x09 || byte === 0x0a || byte === 0x0d) {
            continue;
        }

        return byte === 0x3c;
    }

    return false;
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

    async planCompression(header: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionSkipReason | null> {
        const plan = planFromBytes(await getImageTypeFromBuffer(header), header, request);

        return plan.verdict === "skip" ? plan.reason : null;
    },

    async compressImage(buffer: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionOutcome> {
        // Asked again of the whole image, whatever a header was already judged on: the caller may
        // have skipped that step entirely, and where it did not, this is the reading that had the
        // bytes the other one was missing.
        const plan = planFromBytes(await getImageTypeFromBuffer(buffer), buffer, request);

        if (plan.verdict === "skip") {
            return { compressed: false, reason: plan.reason };
        }

        const { isLossless, worthReencoding } = plan;
        const start = Date.now();
        const image = await decodeImage(buffer);
        const { width, height } = image.bitmap;
        const needsResize = request.resize && Math.max(width, height) > request.maxWidthHeight;

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

        // Reached only where the header would not say how large the image was: everything else was
        // settled above without decoding.
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
function quantizePng(image: DecodedImage, originalByteLength: number): Uint8Array {
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
function hasTransparency(image: DecodedImage): boolean {
    const { data } = image.bitmap;

    for (let i = 3; i < data.length; i += 4) {
        if (data[i] !== 255) {
            return true;
        }
    }

    return false;
}
