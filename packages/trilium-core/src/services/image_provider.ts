/**
 * Interface for platform-specific image processing.
 * Server uses JIMP with full compression support.
 * Standalone uses simple format detection without compression.
 */

import type { ImageCompressionSkipReason, ImageJpegHandling, ImagePngHandling } from "@triliumnext/commons";

export interface ImageFormat {
    ext: string;
    mime: string;
}

export interface ProcessedImage {
    buffer: Uint8Array;
    format: ImageFormat;
}

/**
 * A fully resolved {@link ImageCompressionOptions} — every fallback already applied, so a provider
 * never has to reach for an option itself.
 */
export interface ImageCompressionRequest {
    /** Whether an image larger than {@link maxWidthHeight} is scaled down to fit. */
    resize: boolean;
    /** Longest edge in pixels. Only consulted when {@link resize} is on. */
    maxWidthHeight: number;
    /** What becomes of an already-lossy image (JPEG): left as encoded, or recompressed. */
    jpegHandling: ImageJpegHandling;
    /** What becomes of a lossless image (PNG): left alone, quantized in place, or converted. */
    pngHandling: ImagePngHandling;
    /** JPEG quality, 10 to 100, for recompressing an already-lossy image. */
    quality: number;
    /** JPEG quality, 10 to 100, for converting a lossless image. */
    conversionQuality: number;
}

export type ImageCompressionOutcome =
    | { compressed: true; buffer: Uint8Array; format: ImageFormat }
    | { compressed: false; reason: ImageCompressionSkipReason };

export interface ImageProvider {
    /**
     * Detect image format from buffer.
     */
    getImageType(buffer: Uint8Array): ImageFormat | null;

    /**
     * Process image - may resize/compress depending on implementation.
     * @param buffer - Raw image data
     * @param originalName - Original filename for logging
     * @param shrink - Whether to attempt shrinking the image
     * @returns Processed image buffer and detected format
     */
    processImage(buffer: Uint8Array, originalName: string, shrink: boolean): Promise<ProcessedImage>;

    /**
     * Recompress an image the user has explicitly asked to shrink, ignoring the `compressImages`
     * option — that option governs automatic shrinking on import, and this is a deliberate act.
     *
     * Implementations decide nothing about *which* images to visit; they only answer for the one
     * buffer handed to them, and say why when they leave it alone. The buffer is returned only when
     * it genuinely came out smaller, so a caller can always replace the original with it.
     *
     * @param buffer - Raw image data
     * @param request - Fully resolved compression parameters
     */
    compressImage(buffer: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionOutcome>;

    /**
     * Why an image with this header would be left alone, decided without the rest of it.
     *
     * The point is to answer for images a run will not touch without paying to read them: an
     * unsupported format, one already within the bound with nothing asked of its encoding, one too
     * large to decode. Over a tree those are most of the images there are, and the difference is
     * between reading a database's worth of pictures and reading the front of each.
     *
     * Answers only what the header settles. Anything it leaves open — dimensions past the end of
     * the given bytes, a question that needs the pixels — comes back `null`, meaning the image has
     * to be read in full and put through {@link compressImage}, which decides for itself either
     * way. A reason given here is therefore always one that would be given there.
     *
     * @param header - The opening bytes of the image; may be the whole of it.
     * @param request - Fully resolved compression parameters
     */
    planCompression(header: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionSkipReason | null>;
}

let imageProvider: ImageProvider | null = null;

export function initImageProvider(provider: ImageProvider) {
    imageProvider = provider;
}

export function getImageProvider(): ImageProvider {
    if (!imageProvider) {
        throw new Error("Image provider not initialized");
    }
    return imageProvider;
}
