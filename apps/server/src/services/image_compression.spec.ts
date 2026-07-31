import type { ImageCompressionResponse } from "@triliumnext/commons";
import { becca, cls, getSql, options } from "@triliumnext/core";
import { createTextNote } from "@triliumnext/core/src/test/api_fixtures.js";
import { CoreApiTester } from "@triliumnext/core/src/test/api_tester.js";
import { Jimp } from "jimp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * Drives the on-demand image compression endpoints end to end: real notes and attachments in the
 * in-memory database, the real core service, and the real JIMP-backed provider. Nothing is mocked,
 * so what these assert is what a caller actually gets back — and, just as importantly, what is left
 * behind in the database afterwards.
 *
 * This spec lives under `apps/server` rather than in core because compression only exists on this
 * runtime; the standalone (WASM) build has no decoder, and core specs run under both.
 */
let api: CoreApiTester;

/** A large noisy PNG: big enough that both converting and resizing it save real bytes. */
let noisyPng: Uint8Array;
/** An 8x8 solid PNG, which nothing can make smaller. */
let smallPng: Uint8Array;
/** A PNG signature followed by garbage: passes format detection, fails to decode. */
let corruptPng: Uint8Array;
/** The same picture stored lossily, for telling the two re-encoding switches apart. */
let noisyJpeg: Uint8Array;

beforeAll(async () => {
    api = CoreApiTester.build();

    const noisy = new Jimp({ width: 600, height: 400, color: 0x3366ccff });
    for (let x = 0; x < 600; x++) {
        for (let y = 0; y < 400; y++) {
            const color = ((((x * 31 + y * 17) % 256) << 24) | (((x * 13 + y * 7) % 256) << 16) | (((x * 5 + y * 23) % 256) << 8) | 0xff) >>> 0;
            noisy.setPixelColor(color, x, y);
        }
    }
    noisyPng = new Uint8Array(await noisy.getBuffer("image/png"));
    noisyJpeg = new Uint8Array(await noisy.getBuffer("image/jpeg", { quality: 100 }));

    const small = new Jimp({ width: 8, height: 8, color: 0x3366ccff });
    smallPng = new Uint8Array(await small.getBuffer("image/png"));

    corruptPng = new Uint8Array(Buffer.concat([ Buffer.from(smallPng.slice(0, 50)), Buffer.alloc(400, 0xab) ]));
}, 60000);

afterEach(() => {
    cls.init(() => {
        options.setOption("imageMaxWidthHeight", "2000");
        options.setOption("imageJpegQuality", "75");
    });
});

describe("compress note images (POST /api/notes/:noteId/compress-images)", () => {
    it("404s for a note that does not exist", async () => {
        const res = await api.post("/api/notes/missingNote123/compress-images");

        expect(res.status).toBe(404);
    });

    it("compresses an image note's own content and writes the new bytes and mime back", async () => {
        const noteId = await createImageNote(noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { convertLossless: true }
        });

        expect(res.status).toBe(200);
        expect(res.body.compressedCount).toBe(1);
        expect(res.body.skippedCount).toBe(0);
        expect(res.body.savedSize).toBe(res.body.originalSize - res.body.newSize);
        expect(res.body.savedSize).toBeGreaterThan(0);
        expect(res.body.items[0]).toMatchObject({
            entityType: "note",
            entityId: noteId,
            mime: "image/jpeg",
            compressed: true
        });

        const stored = readNote(noteId);
        expect(stored.mime).toBe("image/jpeg");
        expect(stored.size).toBe(res.body.newSize);
        expect(stored.size).toBeLessThan(noisyPng.byteLength);
    });

    it("leaves a PNG within the bound untouched once converting is switched off", async () => {
        const noteId = await createImageNote(noisyPng);

        // Scaling is then the only step that can reach a PNG, and there is nothing oversized to
        // scale. Recompressing lossy images stays on, and has no business with a PNG.
        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { convertLossless: false }
        });

        expect(res.body.compressedCount).toBe(0);
        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "no-gain", mime: "image/png" });
        // A skipped image weighs the same on both sides, so the run reports no saving at all.
        expect(res.body.originalSize).toBe(noisyPng.byteLength);
        expect(res.body.newSize).toBe(noisyPng.byteLength);
        expect(res.body.savedSize).toBe(0);
        expect(readNote(noteId).size).toBe(noisyPng.byteLength);
    });

    it("visits every image attachment of a text note and reports each one", async () => {
        const { noteId } = await createTextNote(api);
        const big = await addAttachment(noteId, "big.png", noisyPng);
        const small = await addAttachment(noteId, "small.png", smallPng);
        // Not an image: attachments of other roles are not part of the run at all.
        await addAttachment(noteId, "notes.txt", new Uint8Array([ 1, 2, 3 ]), { role: "file", mime: "text/plain" });

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { convertLossless: true }
        });

        expect(res.body.items.map((item) => item.entityId).sort()).toEqual([ big, small ].sort());
        expect(res.body.compressedCount).toBe(1);
        expect(res.body.skippedCount).toBe(1);

        expect(itemFor(res.body, big)).toMatchObject({ entityType: "attachment", compressed: true, mime: "image/jpeg" });
        expect(itemFor(res.body, small)).toMatchObject({ compressed: false, skipReason: "no-gain", mime: "image/png" });

        expect(readAttachment(big).mime).toBe("image/jpeg");
        // The title is deliberately left alone: elsewhere it is a reference, and download and export
        // filenames already take their extension from the mime.
        expect(readAttachment(big).title).toBe("big.png");
        expect(readAttachment(small).size).toBe(smallPng.byteLength);
    });

    it("reports an empty run for a note holding no images", async () => {
        const { noteId } = await createTextNote(api);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`);

        expect(res.body).toMatchObject({ items: [], compressedCount: 0, skippedCount: 0, savedSize: 0 });
    });

    it("does not follow child notes unless asked to, they may be clones shared elsewhere", async () => {
        const { noteId } = await createTextNote(api);
        const childId = await createImageNote(noisyPng, noteId);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { convertLossless: true }
        });

        expect(res.body.items).toHaveLength(0);
        expect(readNote(childId).size).toBe(noisyPng.byteLength);
    });

    it("descends the whole subtree when asked, visiting a clone once however often it is placed", async () => {
        const { noteId } = await createTextNote(api);
        const ownAttachment = await addAttachment(noteId, "own.png", noisyPng);
        const childId = await createImageNote(noisyPng, noteId);
        const grandchildId = await createImageNote(noisyPng, childId);
        // The same note placed a second time inside the subtree: it holds one image, and the run
        // must not compress it twice (nor report it twice).
        await api.put(`/api/notes/${grandchildId}/clone-to-note/${noteId}`);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { convertLossless: true, recursive: true }
        });

        expect(res.body.items.map((item) => item.entityId).sort())
            .toEqual([ ownAttachment, childId, grandchildId ].sort());
        expect(res.body.compressedCount).toBe(3);
        expect(readNote(childId).mime).toBe("image/jpeg");
        expect(readNote(grandchildId).mime).toBe("image/jpeg");
    });

    it("400s on a non-boolean recursive", async () => {
        const { noteId } = await createTextNote(api);

        const res = await api.post(`/api/notes/${noteId}/compress-images`, { body: { recursive: "deep" } });

        expect(res.status).toBe(400);
    });

    it("skips the generated picture of a spreadsheet note, which is rebuilt on every save", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "spreadsheet-export.png", noisyPng);
        setNoteType(noteId, "spreadsheet", "application/json");

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { convertLossless: true }
        });

        expect(res.body.items[0]).toMatchObject({
            entityId: attachmentId,
            compressed: false,
            skipReason: "generated",
            // Reported at its real weight even though it was never touched.
            originalSize: noisyPng.byteLength
        });
        expect(readAttachment(attachmentId).mime).toBe("image/png");
    });

    it("skips a protected image when no protected session is open", async () => {
        const noteId = await createImageNote(noisyPng);
        cls.init(() => { becca.getNoteOrThrow(noteId).isProtected = true; });

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { convertLossless: true }
        });

        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "protected", originalSize: 0 });

        cls.init(() => { becca.getNoteOrThrow(noteId).isProtected = false; });
    });

    it("reports an undecodable image as an error and leaves it alone", async () => {
        const noteId = await createImageNote(corruptPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { convertLossless: true, maxWidthHeight: 100 }
        });

        expect(res.status).toBe(200);
        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "error", originalSize: corruptPng.byteLength });
        expect(readNote(noteId).size).toBe(corruptPng.byteLength);
    });

    it("carries on past a failing image to the ones after it", async () => {
        const { noteId } = await createTextNote(api);
        const broken = await addAttachment(noteId, "broken.png", corruptPng);
        const good = await addAttachment(noteId, "good.png", noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { convertLossless: true }
        });

        expect(itemFor(res.body, broken).skipReason).toBe("error");
        expect(itemFor(res.body, good).compressed).toBe(true);
    });
});

describe("compression parameters", () => {
    it("resizes to the requested bound rather than the option's", async () => {
        const noteId = await createImageNote(noisyPng);

        await api.post(`/api/notes/${noteId}/compress-images`, { body: { maxWidthHeight: 100 } });

        expect(await decodedSize(noteId)).toEqual([ 100, 67 ]);
    });

    it("falls back to the imageMaxWidthHeight option when no bound is given", async () => {
        cls.init(() => options.setOption("imageMaxWidthHeight", "150"));
        const noteId = await createImageNote(noisyPng);

        await api.post(`/api/notes/${noteId}/compress-images`, { body: { convertLossless: true } });

        expect(await decodedSize(noteId)).toEqual([ 150, 100 ]);
    });

    it("honours the requested quality, and falls back to the imageJpegQuality option without one", async () => {
        const explicitLow = await compressedSize({ convertLossless: true, quality: 20 });
        const explicitHigh = await compressedSize({ convertLossless: true, quality: 70 });
        expect(explicitLow).toBeLessThan(explicitHigh);

        cls.init(() => options.setOption("imageJpegQuality", "20"));
        expect(await compressedSize({ convertLossless: true })).toBe(explicitLow);
    });

    it("falls back to the default quality when the stored option is out of range", async () => {
        cls.init(() => options.setOption("imageJpegQuality", "75"));
        const at75 = await compressedSize({ convertLossless: true });

        // An option the caller did not choose and cannot fix from here must not fail the request.
        cls.init(() => options.setOption("imageJpegQuality", "500"));
        expect(await compressedSize({ convertLossless: true })).toBe(at75);
    });

    it.each([
        [ "a fractional maxWidthHeight", { maxWidthHeight: 10.5 } ],
        [ "a zero maxWidthHeight", { maxWidthHeight: 0 } ],
        [ "a quality below the minimum", { quality: 5 } ],
        [ "a quality above the maximum", { quality: 101 } ],
        [ "a non-integer quality", { quality: 75.5 } ],
        [ "a non-boolean resize", { resize: "yes" } ],
        [ "a non-boolean reencode", { reencode: "yes" } ],
        [ "a non-boolean convertLossless", { convertLossless: "yes" } ]
    ])("400s on %s", async (_label, body) => {
        const noteId = await createImageNote(smallPng);

        const res = await api.post(`/api/notes/${noteId}/compress-images`, { body });

        expect(res.status).toBe(400);
    });

    it("400s on a body that is not an object of options", async () => {
        const noteId = await createImageNote(smallPng);

        expect((await api.post(`/api/notes/${noteId}/compress-images`, { body: [ 1, 2 ] })).status).toBe(400);
        expect((await api.post(`/api/notes/${noteId}/compress-images`, { body: "reencode" })).status).toBe(400);
    });

    it("treats a missing body as a request for both steps", async () => {
        const noteId = await createImageNote(noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`);

        expect(res.status).toBe(200);
        // A request that named nothing asked for the images to be compressed; answering it with a
        // no-op because a PNG happened to fit the bound would be the surprising reading.
        expect(res.body.items[0]).toMatchObject({ compressed: true, mime: "image/jpeg" });
    });

    it("changes nothing at all when every step is switched off", async () => {
        const noteId = await createImageNote(noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { resize: false, reencode: false, convertLossless: false, maxWidthHeight: 10 }
        });

        // Oversized by a long way, and still untouched: with nothing switched on, the bound is
        // never measured against.
        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "no-gain" });
        expect(readNote(noteId).size).toBe(noisyPng.byteLength);
    });

    it.each([
        [ "the lossy one", { reencode: true, convertLossless: false }, "jpeg.jpg" ],
        [ "the lossless one", { reencode: false, convertLossless: true }, "png.png" ]
    ])("reaches only its own kind of image with %s switched on", async (_label, body, expected) => {
        const { noteId } = await createTextNote(api);
        await addAttachment(noteId, "png.png", noisyPng);
        await addAttachment(noteId, "jpeg.jpg", noisyJpeg, { mime: "image/jpeg" });

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, { body });

        // Squeezing the JPEGs harder is no reason to stop a PNG being a PNG, and vice versa: each
        // switch answers for its own kind and leaves the other exactly as it was.
        expect(res.body.items.filter((item) => item.compressed).map((item) => item.title)).toEqual([ expected ]);
    });

    it("re-encodes without scaling when only scaling is switched off", async () => {
        const noteId = await createImageNote(noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { resize: false, maxWidthHeight: 100 }
        });

        expect(res.body.items[0]).toMatchObject({ compressed: true, mime: "image/jpeg" });
        // The bound is quoted and ignored: nothing was asked to be measured against it.
        expect(await decodedSize(noteId)).toEqual([ 600, 400 ]);
    });
});

describe("compress one attachment (POST /api/attachments/:attachmentId/compress-image)", () => {
    it("404s for an attachment that does not exist", async () => {
        const res = await api.post("/api/attachments/missingAtt123/compress-image");

        expect(res.status).toBe(404);
    });

    it("400s for an attachment that is not an image", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "notes.txt", new Uint8Array([ 1, 2 ]), { role: "file", mime: "text/plain" });

        const res = await api.post(`/api/attachments/${attachmentId}/compress-image`);

        expect(res.status).toBe(400);
    });

    it("compresses just that attachment, leaving its siblings alone", async () => {
        const { noteId } = await createTextNote(api);
        const target = await addAttachment(noteId, "target.png", noisyPng);
        const sibling = await addAttachment(noteId, "sibling.png", noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/attachments/${target}/compress-image`, {
            body: { convertLossless: true }
        });

        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0]).toMatchObject({ entityType: "attachment", entityId: target, compressed: true });
        expect(readAttachment(target).mime).toBe("image/jpeg");
        expect(readAttachment(sibling).size).toBe(noisyPng.byteLength);
    });

    it("still refuses a generated picture when it is targeted directly", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "spreadsheet-export.png", noisyPng);
        setNoteType(noteId, "spreadsheet", "application/json");

        const res = await api.post<ImageCompressionResponse>(`/api/attachments/${attachmentId}/compress-image`, {
            body: { convertLossless: true }
        });

        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "generated" });
    });
});

/** Creates a real image note holding the given bytes and returns its noteId. */
async function createImageNote(content: Uint8Array, parentNoteId = "root"): Promise<string> {
    const { noteId } = await createTextNote(api, { parentNoteId });

    cls.init(() => getSql().transactional(() => {
        const note = becca.getNoteOrThrow(noteId);
        note.type = "image";
        note.mime = "image/png";
        note.save();
        note.setContent(content, { forceSave: true });
    }));

    return noteId;
}

async function addAttachment(
    noteId: string,
    title: string,
    content: Uint8Array,
    { role = "image", mime = "image/png" } = {}
): Promise<string> {
    return cls.init(() => getSql().transactional(() => {
        const attachment = becca.getNoteOrThrow(noteId).saveAttachment({ role, mime, title, content }, "title");
        return attachment.attachmentId ?? "";
    }));
}

function setNoteType(noteId: string, type: string, mime: string) {
    cls.init(() => getSql().transactional(() => {
        const note = becca.getNoteOrThrow(noteId);
        note.type = type as never;
        note.mime = mime;
        note.save();
    }));
}

function readNote(noteId: string): { mime: string; size: number } {
    return cls.init(() => {
        const note = becca.getNoteOrThrow(noteId);
        return { mime: note.mime, size: note.getContent().length };
    });
}

function readAttachment(attachmentId: string): { mime: string; title: string; size: number } {
    return cls.init(() => {
        const attachment = becca.getAttachmentOrThrow(attachmentId);
        return { mime: attachment.mime, title: attachment.title, size: attachment.getContent().length };
    });
}

function itemFor(response: ImageCompressionResponse, entityId: string) {
    const item = response.items.find((candidate) => candidate.entityId === entityId);

    if (!item) {
        throw new Error(`No item reported for '${entityId}'.`);
    }

    return item;
}

/** Compresses a fresh copy of the noisy PNG and returns how many bytes it ended up at. */
async function compressedSize(body: Record<string, unknown>): Promise<number> {
    const noteId = await createImageNote(noisyPng);
    const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, { body });

    if (res.body.compressedCount !== 1) {
        throw new Error(`Expected ${JSON.stringify(body)} to compress; got ${JSON.stringify(res.body.items)}`);
    }

    return res.body.newSize;
}

async function decodedSize(noteId: string): Promise<[number, number]> {
    const content = cls.init(() => becca.getNoteOrThrow(noteId).getContent());
    const decoded = await Jimp.read(Buffer.from(content as Uint8Array));

    return [ decoded.bitmap.width, decoded.bitmap.height ];
}
