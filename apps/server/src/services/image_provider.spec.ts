import { cls, type ImageCompressionRequest, options } from '@triliumnext/core';
import { Jimp } from 'jimp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { serverImageProvider } from './image_provider.js';

// is-svg / image-type / is-animated / jimp are all loaded by spec/setup.ts (which
// imports serverImageProvider to initialise core), so they cannot be re-mocked
// reliably. Instead we exercise the real implementations end-to-end with real
// image buffers and drive behaviour through the real (in-memory DB) options.

function setOptions(values: Record<string, string>) {
    cls.init(() => {
        for (const [name, value] of Object.entries(values)) {
            options.setOption(name as Parameters<typeof options.setOption>[0], value);
        }
    });
}

// Real, deterministic image buffers built once.
let tallPng: Uint8Array; // 200x600 -> resized by height
let smallPng: Uint8Array; // 8x8 -> within bounds, jpeg ends up larger
let noisyPng: Uint8Array; // large noisy image where jpeg compression helps
let corruptPng: Uint8Array; // valid PNG signature but unreadable by jimp
let transparentPng: Uint8Array; // 600x400 noisy, every pixel half-transparent
let noisyJpeg: Uint8Array; // 600x400 noisy jpeg stored at high quality
let tinyJpeg: Uint8Array; // 8x8 jpeg that cannot get any smaller
const svgBuffer = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const garbageBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const staticGif = Uint8Array.from(
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
);
const animatedGif = Uint8Array.from(
    Buffer.from(
        'R0lGODlhAQABAPABAP///wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgABACwAA' +
        'AAAAQABAAACAkQBACH5BAUKAAEALAAAAAABAAEAAAICRAEAOw==',
        'base64'
    )
);

function makeImage(width: number, height: number, { noisy = false, alpha = 0xff } = {}): InstanceType<typeof Jimp> {
    const image = new Jimp({ width, height, color: (0x3366cc00 | alpha) >>> 0 });
    if (noisy) {
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const r = (x * 31 + y * 17) % 256;
                const g = (x * 13 + y * 7) % 256;
                const b = (x * 5 + y * 23) % 256;
                const color = (((r << 24) | (g << 16) | (b << 8) | alpha) >>> 0);
                image.setPixelColor(color, x, y);
            }
        }
    }
    return image;
}

async function makePng(width: number, height: number, noisy = false): Promise<Uint8Array> {
    return new Uint8Array(await makeImage(width, height, { noisy }).getBuffer('image/png'));
}

beforeAll(async () => {
    tallPng = await makePng(200, 600);
    smallPng = await makePng(8, 8);
    noisyPng = await makePng(600, 400, true);
    const valid = await makePng(8, 8);
    corruptPng = new Uint8Array(
        Buffer.concat([Buffer.from(valid.slice(0, 50)), Buffer.alloc(valid.length, 0xab)])
    );
    transparentPng = new Uint8Array(
        await makeImage(600, 400, { noisy: true, alpha: 0x80 }).getBuffer('image/png')
    );
    noisyJpeg = new Uint8Array(
        await makeImage(600, 400, { noisy: true }).getBuffer('image/jpeg', { quality: 100 })
    );
    tinyJpeg = new Uint8Array(await makeImage(8, 8).getBuffer('image/jpeg', { quality: 10 }));
}, 30000);

afterEach(() => {
    setOptions({ compressImages: 'true', imageJpegQuality: '75', imageMaxWidthHeight: '2000' });
});

describe('serverImageProvider.getImageType', () => {
    it('returns the SVG format for SVG buffers', () => {
        expect(serverImageProvider.getImageType(svgBuffer)).toEqual({
            ext: 'svg',
            mime: 'image/svg+xml'
        });
    });

    it('returns null for non-SVG buffers (async detection handled elsewhere)', () => {
        expect(serverImageProvider.getImageType(smallPng)).toBeNull();
    });
});

describe('serverImageProvider.processImage', () => {
    it('returns the original buffer and detected format when compression is disabled', async () => {
        setOptions({ compressImages: 'false' });

        const result = await serverImageProvider.processImage(smallPng, 'a.png', true);

        expect(result.buffer).toBe(smallPng);
        expect(result.format).toEqual({ ext: 'png', mime: 'image/png' });
    });

    it('uses the octet-stream fallback format when the type cannot be detected', async () => {
        setOptions({ compressImages: 'false' });

        const result = await serverImageProvider.processImage(garbageBuffer, 'unknown.bin', true);

        expect(result.format).toEqual({ ext: 'dat', mime: 'application/octet-stream' });
    });

    it('detects SVG content via getImageTypeFromBuffer', async () => {
        setOptions({ compressImages: 'false' });

        const result = await serverImageProvider.processImage(svgBuffer, 'a.svg', false);

        expect(result.format).toEqual({ ext: 'svg', mime: 'image/svg+xml' });
        expect(result.buffer).toBe(svgBuffer);
    });

    it('does not shrink unsupported (non jpg/png) formats even when shrink is requested', async () => {
        const result = await serverImageProvider.processImage(staticGif, 'a.gif', true);

        expect(result.buffer).toBe(staticGif);
        expect(result.format).toEqual({ ext: 'gif', mime: 'image/gif' });
    });

    it('leaves an animated GIF untouched (skipped at the non-jpg/png format gate)', async () => {
        // image-type classifies an animated GIF as { ext: "gif" }, so it is excluded
        // by the format check BEFORE the isAnimated() guard is ever consulted — the
        // buffer and detected format must be returned unchanged.
        const result = await serverImageProvider.processImage(animatedGif, 'a.gif', true);

        expect(result.buffer).toBe(animatedGif);
        expect(result.format).toEqual({ ext: 'gif', mime: 'image/gif' });
    });

    it('does not shrink when shrink is not requested', async () => {
        const result = await serverImageProvider.processImage(smallPng, 'a.png', false);

        expect(result.buffer).toBe(smallPng);
    });

    it('shrinks a wide image by width', async () => {
        setOptions({ imageMaxWidthHeight: '100' });

        const result = await serverImageProvider.processImage(noisyPng, 'wide.png', true);

        // Noisy 600x400 -> resized to width 100, re-encoded as JPEG (smaller).
        expect(result.buffer.byteLength).toBeLessThan(noisyPng.byteLength);
        expect(result.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    });

    it('resizes a tall image by height', async () => {
        setOptions({ imageMaxWidthHeight: '100' });

        // tallPng (200x600) is taller than wide, so the height-resize branch runs.
        const result = await serverImageProvider.processImage(tallPng, 'tall.png', true);

        expect(result.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
        expect(result.buffer.byteLength).toBeLessThan(tallPng.byteLength);
    });

    it('keeps the original buffer when shrinking does not reduce the size', async () => {
        setOptions({ imageMaxWidthHeight: '2000' });

        // A small solid-colour PNG re-encodes to a larger JPEG, so the original wins.
        const result = await serverImageProvider.processImage(smallPng, 'small.png', true);

        expect(result.buffer).toBe(smallPng);
        expect(result.format).toEqual({ ext: 'png', mime: 'image/png' });
    });

    it('falls back to the original buffer when resizing throws', async () => {
        setOptions({ imageMaxWidthHeight: '100' });

        // corruptPng passes image-type detection as PNG but Jimp cannot decode it,
        // so resize() throws and shrinkImage() falls back to the original buffer.
        const result = await serverImageProvider.processImage(corruptPng, 'broken.png', true);

        expect(result.buffer).toBe(corruptPng);
        expect(result.format).toEqual({ ext: 'png', mime: 'image/png' });
    });

    async function shrunkSize(jpegQuality: string): Promise<number> {
        setOptions({ imageMaxWidthHeight: '100', imageJpegQuality: jpegQuality });
        const result = await serverImageProvider.processImage(noisyPng, 'wide.png', true);
        expect(result.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
        return result.buffer.byteLength;
    }

    it('clamps out-of-range JPEG quality to the default (75)', async () => {
        // An out-of-range quality must produce byte-identical output to an explicit
        // quality of 75, and differ from a valid in-range quality — proving the clamp
        // actually ran (and the bad value was not passed through).
        const at75 = await shrunkSize('75');
        const valid = await shrunkSize('30');
        const tooLow = await shrunkSize('5');
        const tooHigh = await shrunkSize('150');

        expect(tooLow).toBe(at75);
        expect(tooHigh).toBe(at75);
        expect(valid).not.toBe(at75);
    });

    it('bakes EXIF orientation into the pixels when shrinking a rotated photo (#4254)', async () => {
        setOptions({ compressImages: 'true', imageMaxWidthHeight: '100' });

        // A 600x400 landscape JPEG tagged "rotate 90 CW" (orientation 6) is how a portrait photo
        // shot on a rotated camera is stored. Shrinking re-encodes to JPEG and drops the EXIF tag,
        // so the rotation must be baked into the pixels — otherwise the saved image is displayed
        // sideways (the original bug). Re-decoding the shrunk output must therefore be portrait.
        const oriented = await makeOrientedJpeg(600, 400, 6);
        const result = await serverImageProvider.processImage(oriented, 'portrait.jpg', true);

        expect(result.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
        // Smaller than the original proves the resize/re-encode path actually ran (where the bug lived).
        expect(result.buffer.byteLength).toBeLessThan(oriented.byteLength);

        const decoded = await Jimp.read(Buffer.from(result.buffer));
        expect(decoded.bitmap.height).toBeGreaterThan(decoded.bitmap.width);
    });

    it('leaves a genuinely landscape photo landscape after shrinking (#4254 control)', async () => {
        setOptions({ compressImages: 'true', imageMaxWidthHeight: '100' });

        // Identical pixels with a normal orientation tag (1) must stay landscape — proving the
        // portrait result above comes from honouring EXIF, not an unconditional rotation.
        const landscape = await makeOrientedJpeg(600, 400, 1);
        const result = await serverImageProvider.processImage(landscape, 'landscape.jpg', true);

        const decoded = await Jimp.read(Buffer.from(result.buffer));
        expect(decoded.bitmap.width).toBeGreaterThan(decoded.bitmap.height);
    });
});

describe('serverImageProvider.compressImage', () => {
    /** Every parameter is explicit, so nothing here depends on the stored options. */
    function request(overrides: Partial<ImageCompressionRequest> = {}): ImageCompressionRequest {
        return {
            resize: true, maxWidthHeight: 2000, reencode: true, convertLossless: true, quality: 75, ...overrides
        };
    }

    it.each([
        ['an SVG', () => svgBuffer],
        ['a GIF', () => staticGif],
        ['an animated GIF', () => animatedGif],
        ['an unrecognisable buffer', () => garbageBuffer]
    ])('leaves %s alone as an unsupported format', async (_label, getBuffer) => {
        const outcome = await serverImageProvider.compressImage(getBuffer(), request());

        expect(outcome).toEqual({ compressed: false, reason: 'unsupported-format' });
    });

    it('ignores the compressImages option, which only governs automatic shrinking', async () => {
        setOptions({ compressImages: 'false' });

        const outcome = await serverImageProvider.compressImage(noisyPng, request({ maxWidthHeight: 100 }));

        expect(outcome.compressed).toBe(true);
    });

    describe('the re-encoding switches, each answering for its own kind', () => {
        it('converts an opaque PNG without needing anything to scale', async () => {
            const outcome = await serverImageProvider.compressImage(noisyPng, request());

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'jpg', mime: 'image/jpeg' } });
            if (!outcome.compressed) return;
            expect(outcome.buffer.byteLength).toBeLessThan(noisyPng.byteLength);

            // Still 600x400: converting is the step that reaches an image already within bounds.
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([600, 400]);
        });

        it('recompresses a JPEG on the lossy switch alone, converting switched off', async () => {
            const outcome = await serverImageProvider.compressImage(
                noisyJpeg, request({ convertLossless: false, quality: 40 }));

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'jpg', mime: 'image/jpeg' } });
        });

        it('leaves a PNG alone on the lossy switch, which is not about lossless images', async () => {
            // The switch above recompresses JPEGs; a PNG within the bound is none of its business,
            // and rewriting one as a PNG at its own size is lossless and pointless besides.
            const outcome = await serverImageProvider.compressImage(
                noisyPng, request({ convertLossless: false }));

            expect(outcome).toEqual({ compressed: false, reason: 'no-gain' });
        });

        it('leaves a JPEG alone on the converting switch, which is not about lossy images', async () => {
            const outcome = await serverImageProvider.compressImage(
                noisyJpeg, request({ reencode: false }));

            expect(outcome).toEqual({ compressed: false, reason: 'no-gain' });
        });

        it('scales an oversized PNG down but keeps it a PNG once converting is off', async () => {
            const outcome = await serverImageProvider.compressImage(
                noisyPng,
                request({ maxWidthHeight: 100, convertLossless: false })
            );

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'png', mime: 'image/png' } });
            if (!outcome.compressed) return;

            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([100, 67]);
        });

        it('re-encodes an oversized image at its own size once scaling is off', async () => {
            const outcome = await serverImageProvider.compressImage(
                noisyPng,
                request({ resize: false, maxWidthHeight: 100 })
            );

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'jpg', mime: 'image/jpeg' } });
            if (!outcome.compressed) return;

            // The bound is quoted and never measured against: nothing asked for it to be.
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([600, 400]);
        });

        it('writes a scaled JPEG at the requested quality with every re-encoding switch off', async () => {
            // Scaling has to write a JPEG back whatever the switches say, so the quality governs
            // this too — which is why it qualifies neither switch on its own.
            const off = { reencode: false, convertLossless: false, maxWidthHeight: 300 };
            const coarse = await serverImageProvider.compressImage(noisyJpeg, request({ ...off, quality: 20 }));
            const fine = await serverImageProvider.compressImage(noisyJpeg, request({ ...off, quality: 80 }));

            if (!coarse.compressed || !fine.compressed) throw new Error('expected both to compress');
            expect(coarse.buffer.byteLength).toBeLessThan(fine.buffer.byteLength);
        });

        it.each([
            [ 'a PNG', () => noisyPng ],
            [ 'a JPEG', () => noisyJpeg ]
        ])('changes nothing about %s when every step is off', async (_label, getBuffer) => {
            const outcome = await serverImageProvider.compressImage(
                getBuffer(),
                request({ resize: false, reencode: false, convertLossless: false, maxWidthHeight: 10 })
            );

            expect(outcome).toEqual({ compressed: false, reason: 'no-gain' });
        });
    });

    describe('transparency', () => {
        it('refuses to convert a transparent PNG, which JPEG cannot represent', async () => {
            const outcome = await serverImageProvider.compressImage(transparentPng, request());

            expect(outcome).toEqual({ compressed: false, reason: 'transparent' });
        });

        it('still scales a transparent PNG down, keeping both the format and the alpha channel', async () => {
            const outcome = await serverImageProvider.compressImage(
                transparentPng,
                request({ maxWidthHeight: 100 })
            );

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'png', mime: 'image/png' } });
            if (!outcome.compressed) return;

            // The point of the refusal above: the transparency has to survive the resize intact.
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect(decoded.bitmap.width).toBe(100);
            expect(decoded.bitmap.data.some((byte, i) => i % 4 === 3 && byte !== 255)).toBe(true);
        });

        it('converts a PNG whose alpha channel is fully opaque', async () => {
            // Detection reads the decoded pixels, so an alpha channel that happens to be all-255
            // is correctly treated as no transparency at all rather than assumed dangerous.
            const opaqueWithAlpha = new Uint8Array(
                await makeImage(600, 400, { noisy: true, alpha: 0xff }).getBuffer('image/png')
            );

            const outcome = await serverImageProvider.compressImage(opaqueWithAlpha, request());

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'jpg', mime: 'image/jpeg' } });
        });
    });

    describe('lossy sources', () => {
        it('recompresses a JPEG at the requested quality without resizing it', async () => {
            const outcome = await serverImageProvider.compressImage(noisyJpeg, request({ quality: 40 }));

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'jpg', mime: 'image/jpeg' } });
            if (!outcome.compressed) return;
            expect(outcome.buffer.byteLength).toBeLessThan(noisyJpeg.byteLength);
        });

        it('produces a smaller file at a lower quality', async () => {
            const at80 = await serverImageProvider.compressImage(noisyJpeg, request({ quality: 80 }));
            const at20 = await serverImageProvider.compressImage(noisyJpeg, request({ quality: 20 }));

            if (!at80.compressed || !at20.compressed) throw new Error('expected both to compress');
            expect(at20.buffer.byteLength).toBeLessThan(at80.buffer.byteLength);
        });

        it('keeps the original when recompressing would not save anything', async () => {
            const outcome = await serverImageProvider.compressImage(tinyJpeg, request());

            expect(outcome).toEqual({ compressed: false, reason: 'no-gain' });
        });
    });

    describe('resizing', () => {
        it('scales a wide image by its width', async () => {
            const outcome = await serverImageProvider.compressImage(noisyJpeg, request({ maxWidthHeight: 120 }));

            if (!outcome.compressed) throw new Error('expected compression');
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([120, 80]);
        });

        it('scales a tall image by its height', async () => {
            const outcome = await serverImageProvider.compressImage(
                tallPng,
                request({ maxWidthHeight: 120 })
            );

            if (!outcome.compressed) throw new Error('expected compression');
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([40, 120]);
        });

        it('leaves an image already within bounds at its size', async () => {
            const outcome = await serverImageProvider.compressImage(noisyJpeg, request({ maxWidthHeight: 600 }));

            if (!outcome.compressed) throw new Error('expected compression');
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([600, 400]);
        });
    });

    it('propagates a decode failure rather than reporting a bogus result', async () => {
        // corruptPng passes format detection as PNG but Jimp cannot read it. The caller turns this
        // into a logged, per-image "error" skip; swallowing it here would hide the failure instead.
        await expect(serverImageProvider.compressImage(corruptPng, request({ maxWidthHeight: 100 }))).rejects.toThrow();
    });
});

/**
 * Builds a noisy `width`x`height` JPEG (stored at those dimensions) carrying an EXIF Orientation
 * tag. Orientation 6 ("rotate 90 CW") means a 600x400 stored image should be displayed as 400x600
 * portrait; orientation 1 means no rotation. Used to reproduce the rotated-on-import bug (#4254).
 */
async function makeOrientedJpeg(width: number, height: number, orientation: number): Promise<Uint8Array> {
    const image = new Jimp({ width, height, color: 0x3366ccff });
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const r = (x * 31 + y * 17) % 256;
            const g = (x * 13 + y * 7) % 256;
            const b = (x * 5 + y * 23) % 256;
            image.setPixelColor((((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0), x, y);
        }
    }
    const jpeg = Buffer.from(await image.getBuffer('image/jpeg', { quality: 90 }));
    const tiff = Buffer.from([
        0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM" (big-endian), magic 42, IFD0 offset 8
        0x00, 0x01,                                     // one directory entry
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // Orientation tag (0x0112), type SHORT, count 1
        0x00, orientation, 0x00, 0x00,                  // value: big-endian SHORT, right-padded
        0x00, 0x00, 0x00, 0x00                          // next-IFD offset (none)
    ]);
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const length = payload.length + 2;
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]), payload]);
    // The APP1/EXIF segment must sit immediately after the SOI marker (0xFFD8).
    return new Uint8Array(Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]));
}
