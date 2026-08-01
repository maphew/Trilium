/**
 * Reads what an image is and how large it is, from its header alone.
 *
 * Deliberately never decodes: an inventory has to walk every image a note holds, and decoding them
 * to count them would cost more than compressing them. Pure byte inspection also means this works
 * on every runtime, including the one with no image library at all.
 */

export interface InspectedImage {
    /** "jpg", "png", "gif", "webp", "bmp", "svg", or {@link UNKNOWN_FORMAT}. */
    format: string;
    mime: string;
    /**
     * Pixel dimensions, or `null` where they were not read.
     *
     * Only read for the formats a compression run can act on, those being the only ones a size
     * bound is ever measured against. Everything else is identified but not measured.
     */
    width: number | null;
    height: number | null;
}

export const UNKNOWN_FORMAT = "unknown";

/** Identifies `buffer`, and measures it where that is worth doing. */
export function inspectImage(buffer: Uint8Array): InspectedImage {
    const format = detectFormat(buffer);
    const dimensions = format === "png" ? readPngDimensions(buffer)
        : format === "jpg" ? readJpegDimensions(buffer)
            : null;

    return {
        format,
        mime: FORMAT_MIMES[format] ?? FORMAT_MIMES[UNKNOWN_FORMAT],
        width: dimensions?.width ?? null,
        height: dimensions?.height ?? null
    };
}

/** The magic bytes each format opens with; SVG being text, it is recognised by its markup instead. */
function detectFormat(buffer: Uint8Array): string {
    // Shorter than any header worth reading, so nothing can be told from it.
    if (buffer.length < 12) {
        return UNKNOWN_FORMAT;
    }

    if (isSvg(buffer)) {
        return "svg";
    }

    if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
        return "jpg";
    }

    if (startsWith(buffer, [ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ])) {
        return "png";
    }

    if (startsWith(buffer, [ 0x47, 0x49, 0x46 ])) {
        return "gif";
    }

    // RIFF....WEBP: the four-byte tag sits past the chunk size.
    if (startsWith(buffer, [ 0x52, 0x49, 0x46, 0x46 ])
        && buffer[8] === 0x57 && buffer[9] === 0x45 && buffer[10] === 0x42 && buffer[11] === 0x50) {
        return "webp";
    }

    return startsWith(buffer, [ 0x42, 0x4d ]) ? "bmp" : UNKNOWN_FORMAT;
}

/** The IHDR chunk is required to come first, so both figures sit at a fixed offset. */
function readPngDimensions(buffer: Uint8Array): { width: number; height: number } | null {
    if (buffer.length < 24) {
        return null;
    }

    return { width: readUint32(buffer, 16), height: readUint32(buffer, 20) };
}

/**
 * Walks the segment structure to the frame header, which is where a JPEG states its size — and
 * which sits after any EXIF or thumbnail the file happens to carry, so it has to be walked to
 * rather than searched for.
 */
function readJpegDimensions(buffer: Uint8Array): { width: number; height: number } | null {
    let offset = 2;

    while (offset + 3 < buffer.length) {
        if (buffer[offset] !== 0xff) {
            // Out of step with the segments; nothing further can be read with any confidence.
            return null;
        }

        const marker = buffer[offset + 1];

        if (marker === 0xff) {
            // Fill bytes are allowed to pad ahead of a marker.
            offset++;
            continue;
        }

        if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
            // Standalone markers carry no length to skip by.
            offset += 2;
            continue;
        }

        const length = (buffer[offset + 2] << 8) | buffer[offset + 3];

        if (length < 2 || offset + 2 + length > buffer.length) {
            return null;
        }

        if (isFrameHeader(marker)) {
            // Precision, then height, then width.
            return offset + 9 <= buffer.length
                ? { width: (buffer[offset + 7] << 8) | buffer[offset + 8], height: (buffer[offset + 5] << 8) | buffer[offset + 6] }
                : null;
        }

        offset += 2 + length;
    }

    return null;
}

/**
 * Every SOFn marker states the frame's size, whichever coding it introduces — so all of C0..CF
 * count except the three that are not frame headers at all: DHT, JPG and DAC.
 */
function isFrameHeader(marker: number): boolean {
    return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

/** Recognises SVG by its opening markup, allowing for an XML declaration ahead of it. */
function isSvg(buffer: Uint8Array): boolean {
    let text = "";

    for (let index = 0; index < Math.min(buffer.length, SVG_SNIFF_BYTES); index++) {
        text += String.fromCharCode(buffer[index]);
    }

    const trimmed = text.trim().toLowerCase();

    return trimmed.startsWith("<svg") || (trimmed.startsWith("<?xml") && trimmed.includes("<svg"));
}

function startsWith(buffer: Uint8Array, signature: number[]): boolean {
    return signature.every((byte, index) => buffer[index] === byte);
}

function readUint32(buffer: Uint8Array, offset: number): number {
    return ((buffer[offset] << 24) | (buffer[offset + 1] << 16) | (buffer[offset + 2] << 8) | buffer[offset + 3]) >>> 0;
}

/** Far enough into the file to clear an XML declaration and any comments before the root element. */
const SVG_SNIFF_BYTES = 1000;

const FORMAT_MIMES: Record<string, string> = {
    jpg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
    bmp: "image/bmp",
    svg: "image/svg+xml",
    [UNKNOWN_FORMAT]: "application/octet-stream"
};
