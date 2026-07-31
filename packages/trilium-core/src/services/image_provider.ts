/**
 * Interface for platform-specific image processing.
 * Server uses JIMP with full compression support.
 * Standalone uses simple format detection without compression.
 */

import type { ImageCompressionSkipReason } from "@triliumnext/commons";

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
    /** Longest edge in pixels; a larger image is scaled down to fit. */
    maxWidthHeight: number;
    /** JPEG quality, 10 to 100. */
    quality: number;
    /** Whether a lossless source (PNG) may be re-encoded as JPEG. */
    convertLossless: boolean;
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
