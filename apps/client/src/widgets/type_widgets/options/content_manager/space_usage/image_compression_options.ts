import optionService from "../../../../../services/options";

/**
 * What the image compression tool is set to do. Persisted as JSON in the `imageCompressionToolOptions`
 * option, so the next run opens on the last answer rather than on a fresh set of defaults.
 *
 * The first three mirror the server's `ImageCompressionOptions`; {@link processChildNotes} is the
 * tool's own, the endpoint acting on one note at a time.
 */
export interface ImageCompressionToolOptions {
    /** Whether an image larger than {@link maxWidthHeight} is scaled down to fit. */
    resize: boolean;
    /** Longest edge in pixels. Only consulted when {@link resize} is on. */
    maxWidthHeight: number;
    /** Whether an already-lossy image (JPEG) is recompressed even when nothing needs scaling. */
    reencode: boolean;
    /** Whether a lossless image (PNG) may be re-encoded as JPEG. */
    convertLossless: boolean;
    /** JPEG quality, {@link MIN_QUALITY} to {@link MAX_QUALITY}, whenever the output is a JPEG. */
    quality: number;
    /** Whether the note's whole subtree is compressed, rather than the note on its own. */
    processChildNotes: boolean;
}

/**
 * Whether the settings amount to anything at all. With none of the three steps switched on, every
 * image would be visited and left exactly as it was, so the run is not one worth offering.
 */
export function hasWorkToDo(options: ImageCompressionToolOptions): boolean {
    return options.resize || options.reencode || options.convertLossless;
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
 * fallbacks the server applies to a request that omits them.
 *
 * All three steps start on, matching the server's own defaults. Converting in particular has to: it
 * is where nearly all the saving comes from, and with it off a note full of PNGs already inside the
 * bound would report almost nothing. Reaching into the subtree does not start on: that widens what
 * the run touches rather than how hard it compresses, and a descendant may be a clone shared with
 * notes the user did not have in mind.
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
        convertLossless: stored?.convertLossless ?? true,
        quality: isQuality(stored?.quality) ? Number(stored?.quality) : defaultQuality(),
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
