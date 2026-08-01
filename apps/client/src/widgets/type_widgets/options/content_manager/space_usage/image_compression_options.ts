import { IMAGE_PNG_HANDLINGS, type ImagePngHandling } from "@triliumnext/commons";

import optionService from "../../../../../services/options";

/**
 * What the image compression tool is set to do. Persisted as JSON in the `imageCompressionToolOptions`
 * option, so the next run opens on the last answer rather than on a fresh set of defaults.
 *
 * All but the last mirror the server's `ImageCompressionOptions`; {@link processChildNotes} is the
 * tool's own, the endpoint acting on one note at a time.
 */
export interface ImageCompressionToolOptions {
    /** Whether an image larger than {@link maxWidthHeight} is scaled down to fit. */
    resize: boolean;
    /** Longest edge in pixels. Only consulted when {@link resize} is on. */
    maxWidthHeight: number;
    /** Whether an already-lossy image (JPEG) is recompressed even when nothing needs scaling. */
    reencode: boolean;
    /** What becomes of a lossless image (PNG): left alone, quantized in place, or converted. */
    pngHandling: ImagePngHandling;
    /** JPEG quality, {@link MIN_QUALITY} to {@link MAX_QUALITY}, for an already-lossy image. */
    quality: number;
    /** JPEG quality, {@link MIN_QUALITY} to {@link MAX_QUALITY}, for converting a lossless one. */
    conversionQuality: number;
    /** Whether the note's whole subtree is compressed, rather than the note on its own. */
    processChildNotes: boolean;
}

/**
 * Whether the settings amount to anything at all. With nothing asked of either kind of image, every
 * one of them would be visited and left exactly as it was, so the run is not one worth offering.
 */
export function hasWorkToDo(options: ImageCompressionToolOptions): boolean {
    return options.resize || options.reencode || options.pngHandling !== "keep";
}

/** The bounds the server validates against; the controls here never offer a value it would reject. */
export const MIN_QUALITY = 10;
export const MAX_QUALITY = 100;
export const QUALITY_STEP = 5;
export const DEFAULT_QUALITY = 75;
export const MIN_MAX_WIDTH_HEIGHT = 1;

/**
 * Fills a stored setting out into the full set the dialog works with.
 *
 * The dimension bound and the recompression quality fall back to the image options rather than to
 * constants of their own, so a tool that has never been run opens on what automatic compression is
 * already configured to do — the same fallbacks the server applies to a request that omits them.
 *
 * PNGs start on optimizing, matching the server: it makes an image smaller without changing what it
 * is, which is the least surprising thing to do by default. Reaching into the subtree does not start
 * on: that widens what the run touches rather than how hard it compresses, and a descendant may be a
 * clone shared with notes the user did not have in mind.
 */
export function readImageCompressionOptions(
    stored: Partial<ImageCompressionToolOptions> | null | undefined
): ImageCompressionToolOptions {
    return {
        resize: stored?.resize ?? true,
        maxWidthHeight: isPositiveInteger(stored?.maxWidthHeight)
            ? Number(stored?.maxWidthHeight)
            : defaultMaxWidthHeight(),
        reencode: stored?.reencode ?? true,
        pngHandling: readPngHandling(stored?.pngHandling),
        quality: isQuality(stored?.quality) ? Number(stored?.quality) : defaultQuality(),
        conversionQuality: isQuality(stored?.conversionQuality)
            ? Number(stored?.conversionQuality)
            : DEFAULT_CONVERSION_QUALITY,
        processChildNotes: stored?.processChildNotes === true
    };
}

/** Where the dimension field starts: whatever automatic compression resizes to. */
export function defaultMaxWidthHeight(): number {
    const configured = optionService.getInt("imageMaxWidthHeight");

    return isPositiveInteger(configured) ? Number(configured) : FALLBACK_MAX_WIDTH_HEIGHT;
}

/** Where the quality slider starts: whatever automatic compression encodes at. */
export function defaultQuality(): number {
    const configured = optionService.getInt("imageJpegQuality");

    return isQuality(configured) ? Number(configured) : DEFAULT_QUALITY;
}

/**
 * Stands in when the image option itself is unreadable or nonsensical — the same figure it ships
 * with, so the field opens on a bound that resizes something rather than on one that resizes nothing.
 */
const FALLBACK_MAX_WIDTH_HEIGHT = 2000;

/**
 * Where converting starts, above {@link DEFAULT_QUALITY} and matching the server's own default:
 * converting a lossless original gives up detail that was genuinely there, where recompressing an
 * already-lossy image works on detail that is long gone.
 */
export const DEFAULT_CONVERSION_QUALITY = 85;

/** Anything unrecognised falls back to optimizing, the choice that changes an image least. */
function readPngHandling(value: unknown): ImagePngHandling {
    return IMAGE_PNG_HANDLINGS.includes(value as ImagePngHandling) ? value as ImagePngHandling : "optimize";
}

function isPositiveInteger(value: unknown): boolean {
    return Number.isInteger(value) && Number(value) >= MIN_MAX_WIDTH_HEIGHT;
}

function isQuality(value: unknown): boolean {
    return Number.isInteger(value) && Number(value) >= MIN_QUALITY && Number(value) <= MAX_QUALITY;
}
