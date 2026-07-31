import optionService from "../../../../../services/options";

/**
 * What the image compression tool is set to do. Persisted as JSON in the `imageCompressionToolOptions`
 * option, so the next run opens on the last answer rather than on a fresh set of defaults.
 *
 * The first three mirror the server's `ImageCompressionOptions`; {@link processChildNotes} is the
 * tool's own, the endpoint acting on one note at a time.
 */
export interface ImageCompressionToolOptions {
    /** Longest edge in pixels: a larger image is scaled down to fit, a smaller one left alone. */
    maxWidthHeight: number;
    /** JPEG quality, {@link MIN_QUALITY} to {@link MAX_QUALITY}. */
    quality: number;
    /**
     * Whether a lossless source (PNG) may be re-encoded as JPEG. Off unless asked for: it trades
     * away quality permanently, where scaling down alone does not.
     */
    convertLossless: boolean;
    /** Whether the note's whole subtree is compressed, rather than the note on its own. */
    processChildNotes: boolean;
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
 * The two numbers fall back to the image options rather than to constants of their own, so a tool
 * that has never been run opens on what automatic compression is already configured to do — the same
 * fallbacks the server applies to a request that omits them. Neither toggle is ever assumed: a
 * conversion that costs quality, and a run that reaches beyond the note it was invoked on, are both
 * things to be asked for.
 */
export function readImageCompressionOptions(
    stored: Partial<ImageCompressionToolOptions> | null | undefined
): ImageCompressionToolOptions {
    return {
        maxWidthHeight: isPositiveInteger(stored?.maxWidthHeight)
            ? Number(stored?.maxWidthHeight)
            : defaultMaxWidthHeight(),
        quality: isQuality(stored?.quality) ? Number(stored?.quality) : defaultQuality(),
        convertLossless: stored?.convertLossless === true,
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

function isPositiveInteger(value: unknown): boolean {
    return Number.isInteger(value) && Number(value) >= MIN_MAX_WIDTH_HEIGHT;
}

function isQuality(value: unknown): boolean {
    return Number.isInteger(value) && Number(value) >= MIN_QUALITY && Number(value) <= MAX_QUALITY;
}
