import type { Request } from "express";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import { type ChunkedUpload, type ChunkedUploadConfig, createChunkedUpload } from "./chunked_upload.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-chunked-upload-spec-"));
const opened: ChunkedUpload<unknown>[] = [];

afterEach(() => {
    opened.splice(0).forEach((upload) => upload.stop());
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    vi.restoreAllMocks();
});

/** An upload whose completed files are kept, so a test can assert on what was assembled. */
function uploadService(overrides: Partial<ChunkedUploadConfig<string>> = {}) {
    const completed: { path: string; fileName: string; totalBytes: number; metadata: unknown }[] = [];
    const upload = createChunkedUpload<string>({
        name: "spec",
        directory: path.join(tempRoot, "uploads"),
        maxTotalBytes: 1024,
        chunkSize: 4,
        onComplete: async (file) => {
            completed.push({ ...file });
            return file.path;
        },
        ...overrides
    });

    opened.push(upload);
    return { upload, completed };
}

function beginRequest(totalBytes: unknown, fileName = "backup.db", metadata?: unknown) {
    return { body: { fileName, totalBytes, metadata } } as unknown as Request;
}

/** A chunk request is both a readable body and a request: `pipeline` reads it, the handler routes it. */
function chunkRequest(uploadId: string, offset: unknown, body: Buffer | Readable) {
    const stream = Buffer.isBuffer(body) ? Readable.from([ body ]) : body;

    return Object.assign(stream, {
        params: { uploadId },
        query: { offset: String(offset) }
    }) as unknown as Request;
}

function sessionRequest(uploadId: string) {
    return { params: { uploadId } } as unknown as Request;
}

/** Sends `content` in fixed-size chunks, exactly as the client does. */
async function sendAll(upload: ChunkedUpload<unknown>, uploadId: string, content: Buffer, chunkSize: number) {
    for (let offset = 0; offset < content.length; offset += chunkSize) {
        await upload.chunk(chunkRequest(uploadId, offset, content.subarray(offset, offset + chunkSize)));
    }
}

describe("chunked upload: assembling a file", () => {
    it("reassembles the chunks in order and hands the finished file to the consumer", async () => {
        const { upload, completed } = uploadService();
        const content = Buffer.from("the quick brown fox jumps over the lazy dog");

        const started = await upload.begin(beginRequest(content.length, "backup.db", { source: "web" }));
        expect(started).toMatchObject({ receivedBytes: 0, totalBytes: content.length, chunkSize: 4 });

        await sendAll(upload, started.uploadId, content, 4);

        const status = await upload.status(sessionRequest(started.uploadId));
        expect(status.receivedBytes).toBe(content.length);

        const assembledPath = await upload.finish(sessionRequest(started.uploadId));
        expect(fs.readFileSync(String(assembledPath))).toEqual(content);
        expect(completed).toEqual([
            { path: assembledPath, fileName: "backup.db", totalBytes: content.length, metadata: { source: "web" } }
        ]);
    });

    it("reports how far it has got, so a client that lost a response can carry on", async () => {
        const { upload } = uploadService();
        const content = Buffer.alloc(12, 7);

        const { uploadId } = await upload.begin(beginRequest(content.length));
        await upload.chunk(chunkRequest(uploadId, 0, content.subarray(0, 4)));

        // The response to this one never reaches the client, which asks where the file got to instead.
        await upload.chunk(chunkRequest(uploadId, 4, content.subarray(4, 8)));

        const { receivedBytes } = await upload.status(sessionRequest(uploadId));
        expect(receivedBytes).toBe(8);

        await upload.chunk(chunkRequest(uploadId, receivedBytes, content.subarray(receivedBytes)));
        const assembledPath = await upload.finish(sessionRequest(uploadId));
        expect(fs.readFileSync(String(assembledPath))).toEqual(content);
    });

    it("leaves the file to the consumer, which may move it without a copy", async () => {
        const destination = path.join(tempRoot, "moved.db");
        const { upload } = uploadService({
            onComplete: async ({ path: uploadedPath }) => {
                fs.renameSync(uploadedPath, destination);
                return destination;
            }
        });
        const content = Buffer.from("payload");

        const { uploadId } = await upload.begin(beginRequest(content.length));
        await sendAll(upload, uploadId, content, 4);
        await upload.finish(sessionRequest(uploadId));

        expect(fs.readFileSync(destination)).toEqual(content);
        // The move is not undone by the sweep that follows it.
        await upload.sweep();
        expect(fs.existsSync(destination)).toBe(true);
    });
});

describe("chunked upload: the offset rule", () => {
    it("refuses a chunk that does not continue where the file left off, and keeps what it has", async () => {
        const { upload } = uploadService();
        const { uploadId } = await upload.begin(beginRequest(12));
        await upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4, 1)));

        // A gap, a chunk already written, and an offset that is not a number at all.
        await expect(upload.chunk(chunkRequest(uploadId, 8, Buffer.alloc(4, 2)))).rejects.toThrow(/4 bytes have been received/);
        await expect(upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4, 2)))).rejects.toThrow(/4 bytes have been received/);
        await expect(upload.chunk(chunkRequest(uploadId, "soon", Buffer.alloc(4)))).rejects.toThrow(/must be stated as an integer/);

        const { receivedBytes } = await upload.status(sessionRequest(uploadId));
        expect(receivedBytes).toBe(4);
    });

    it("drops an upload that sends more than it declared", async () => {
        const { upload } = uploadService();
        const { uploadId } = await upload.begin(beginRequest(4));

        await expect(upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(8)))).rejects.toThrow(/more bytes than it declared/);
        await expect(upload.status(sessionRequest(uploadId))).rejects.toThrow(/No such upload/);
    });

    it("cuts an oversized body off as it is written, rather than measuring it once it is on disk", async () => {
        // Nothing authenticates the caller during setup, so a declared size that the body then
        // ignores must stop at the declared size: the check cannot wait until the disk is full.
        const { upload } = uploadService({ maxTotalBytes: 1024 * 1024 });
        const { uploadId } = await upload.begin(beginRequest(8));
        const written: number[] = [];
        const flood = new Readable({
            read() {
                // Far more than was declared, and the stream keeps offering it until it is stopped.
                written.push(64 * 1024);
                this.push(Buffer.alloc(64 * 1024));
            }
        });

        await expect(upload.chunk(chunkRequest(uploadId, 0, flood))).rejects.toThrow(/more bytes than it declared/);

        // Whatever was let through, it is bounded by what was declared, not by what was sent.
        expect(fs.existsSync(partialPath(tempRoot, uploadId))).toBe(false);
        expect(written.reduce((total, size) => total + size, 0)).toBeLessThan(1024 * 1024);
    });

    it("keeps what the declared size allows and refuses only the byte past it", async () => {
        const { upload } = uploadService();
        const { uploadId } = await upload.begin(beginRequest(8));

        // Exactly the allowance, in two chunks, is not an overshoot.
        await upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4, 1)));
        const status = await upload.chunk(chunkRequest(uploadId, 4, Buffer.alloc(4, 2)));

        expect(status.receivedBytes).toBe(8);
        await expect(upload.finish(sessionRequest(uploadId))).resolves.toBeTruthy();
    });

    it("counts what reached the disk when a chunk breaks partway, and resumes from there", async () => {
        const { upload } = uploadService({ maxTotalBytes: 4096 });
        const content = Buffer.alloc(2048, 3);
        const { uploadId } = await upload.begin(beginRequest(content.length));

        const broken = new Readable({
            read() {
                this.push(content.subarray(0, 1024));
                this.destroy(new Error("connection reset"));
            }
        });
        await expect(upload.chunk(chunkRequest(uploadId, 0, broken))).rejects.toThrow("connection reset");

        // Whatever landed, the count matches the file: that is what makes the next offset the right one.
        const { receivedBytes } = await upload.status(sessionRequest(uploadId));
        expect(receivedBytes).toBe(fs.statSync(partialPath(tempRoot, uploadId)).size);

        await upload.chunk(chunkRequest(uploadId, receivedBytes, content.subarray(receivedBytes)));
        const assembledPath = await upload.finish(sessionRequest(uploadId));
        expect(fs.readFileSync(String(assembledPath))).toEqual(content);
    });
});

describe("chunked upload: starting and ending a session", () => {
    it("refuses a size that is missing, not a whole number, or above the limit", async () => {
        const { upload } = uploadService({ maxTotalBytes: 100 });

        await expect(upload.begin(beginRequest(undefined))).rejects.toThrow(/positive integer/);
        await expect(upload.begin(beginRequest(4.5))).rejects.toThrow(/positive integer/);
        await expect(upload.begin(beginRequest(0))).rejects.toThrow(/positive integer/);
        await expect(upload.begin(beginRequest(101))).rejects.toThrow(/above the limit of 100/);
    });

    it("allows only as many sessions at once as it is configured for", async () => {
        const { upload } = uploadService();
        await upload.begin(beginRequest(8));

        await expect(upload.begin(beginRequest(8))).rejects.toThrow(/already in progress/);
    });

    it("reduces the stated name to a base name, so it cannot point outside the upload directory", async () => {
        const { upload, completed } = uploadService();
        const { uploadId } = await upload.begin(beginRequest(4, "../../etc/passwd"));

        await upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)));
        await upload.finish(sessionRequest(uploadId));

        expect(completed[0].fileName).toBe("passwd");
        expect(path.dirname(completed[0].path)).toBe(path.join(tempRoot, "uploads", "spec"));
    });

    it("refuses to finish an upload that is not all there", async () => {
        const { upload, completed } = uploadService();
        const { uploadId } = await upload.begin(beginRequest(8));
        await upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)));

        await expect(upload.finish(sessionRequest(uploadId))).rejects.toThrow(/has 4 of 8 bytes/);
        expect(completed).toHaveLength(0);
        // Still open, so the client can send the rest rather than start again.
        expect((await upload.status(sessionRequest(uploadId))).receivedBytes).toBe(4);
    });

    it("removes the file when the consumer fails to take it", async () => {
        const { upload } = uploadService({
            onComplete: async () => { throw new Error("not a database"); }
        });
        const { uploadId } = await upload.begin(beginRequest(4));
        await upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)));

        await expect(upload.finish(sessionRequest(uploadId))).rejects.toThrow("not a database");
        expect(fs.existsSync(partialPath(tempRoot, uploadId))).toBe(false);
    });

    it("forgets an aborted upload and deletes what it had received", async () => {
        const { upload } = uploadService();
        const { uploadId } = await upload.begin(beginRequest(8));
        await upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)));

        await upload.abort(sessionRequest(uploadId));

        expect(fs.existsSync(partialPath(tempRoot, uploadId))).toBe(false);
        await expect(upload.status(sessionRequest(uploadId))).rejects.toThrow(/No such upload/);
        // The slot is free again.
        await expect(upload.begin(beginRequest(8))).resolves.toBeTruthy();
    });

    it("answers for an upload it has never heard of", async () => {
        const { upload } = uploadService();

        await expect(upload.status(sessionRequest("nosuchupload"))).rejects.toThrow(/No such upload/);
    });
});

describe("chunked upload: telling the consumer a session came to nothing", () => {
    /** An upload that records every ending its consumer is told about. */
    function watchedService(overrides: Partial<ChunkedUploadConfig<string>> = {}) {
        const discarded = { count: 0 };
        const { upload } = uploadService({ onSessionDiscarded: () => discarded.count++, ...overrides });

        return { upload, discarded };
    }

    it("says so when an upload expires, which has no caller of its own to fail", async () => {
        const { upload, discarded } = watchedService({ sessionTtlMs: 1 });
        await upload.begin(beginRequest(8));

        await new Promise((resolve) => setTimeout(resolve, 5));
        await upload.sweep();

        expect(discarded.count).toBe(1);
    });

    it("says so when an upload is abandoned or contradicts its declared size", async () => {
        const { upload, discarded } = watchedService();
        const first = await upload.begin(beginRequest(8));
        await upload.abort(sessionRequest(first.uploadId));

        const second = await upload.begin(beginRequest(4));
        await expect(upload.chunk(chunkRequest(second.uploadId, 0, Buffer.alloc(8)))).rejects.toThrow();

        expect(discarded.count).toBe(2);
    });

    it("says so when the consumer itself refuses the finished file", async () => {
        const { upload, discarded } = watchedService({
            onComplete: async () => { throw new Error("not a database"); }
        });
        const { uploadId } = await upload.begin(beginRequest(4));
        await upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)));

        await expect(upload.finish(sessionRequest(uploadId))).rejects.toThrow("not a database");

        expect(discarded.count).toBe(1);
    });

    it("stays quiet when the upload becomes what it was for", async () => {
        const { upload, discarded } = watchedService();
        const { uploadId } = await upload.begin(beginRequest(4));
        await upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)));
        await upload.finish(sessionRequest(uploadId));

        // Nothing was set aside in vain, so nothing is put back.
        expect(discarded.count).toBe(0);
    });
});

describe("chunked upload: sweeping", () => {
    it("drops a session that has gone quiet for too long, and frees its slot", async () => {
        const { upload } = uploadService({ sessionTtlMs: 1 });
        const { uploadId } = await upload.begin(beginRequest(8));
        await upload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)));

        await new Promise((resolve) => setTimeout(resolve, 5));
        await upload.sweep();

        expect(fs.existsSync(partialPath(tempRoot, uploadId))).toBe(false);
        await expect(upload.chunk(chunkRequest(uploadId, 4, Buffer.alloc(4)))).rejects.toThrow(/No such upload/);
        await expect(upload.begin(beginRequest(8))).resolves.toBeTruthy();
    });

    it("deletes a partial file no session claims, which after a restart is every one of them", async () => {
        const { upload } = uploadService();
        const directory = path.join(tempRoot, "uploads", "spec");
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, "abandoned.part"), "left behind");

        const { uploadId } = await upload.begin(beginRequest(8));
        await upload.sweep();

        expect(fs.existsSync(path.join(directory, "abandoned.part"))).toBe(false);
        // The live session is not swept along with it.
        expect(fs.existsSync(partialPath(tempRoot, uploadId))).toBe(true);
    });
});

function partialPath(root: string, uploadId: string) {
    return path.join(root, "uploads", "spec", `${uploadId}.part`);
}
