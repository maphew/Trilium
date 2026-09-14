import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    BACKUP_TARGET, fileNameOf, saveChunksToDevice, saveUrlToDevice, setChunkBytesForTests
} from "./capacitor_download.js";

/**
 * The write size these specs run at. Small, so crossing a chunk boundary costs a few hundred
 * kilobytes of base64 rather than the production size, and fixed here so tuning that size does not
 * quietly stop the boundary being crossed at all.
 */
const CHUNK_BYTES = 96 * 1024;

interface CapacitorWindow {
    Capacitor?: unknown;
}

/**
 * Models the bridge the module reaches through: neither Filesystem nor Share is registered by the
 * injected runtime, so both arrive via `registerPlugin()` rather than from `Plugins`.
 */
function installCapacitor({ share }: { share?: ReturnType<typeof vi.fn> } = {}) {
    const written: { path: string; data: string; directory: string; append: boolean }[] = [];
    const removed: string[] = [];

    const filesystem = {
        writeFile: vi.fn(async (opts: { path: string; data: string; directory: string }) => {
            written.push({ ...opts, append: false });
            return { uri: `file:///cache/${opts.path}` };
        }),
        appendFile: vi.fn(async (opts: { path: string; data: string; directory: string }) => {
            written.push({ ...opts, append: true });
        }),
        getUri: vi.fn(async (opts: { path: string }) => ({ uri: `file:///cache/${opts.path}` })),
        rmdir: vi.fn(async (opts: { path: string }) => {
            removed.push(opts.path);
        })
    };

    const sharePlugin = { share: share ?? vi.fn(async () => ({ activityType: "com.example" })) };

    const registerPlugin = vi.fn((name: string) => {
        if (name === "Filesystem") return filesystem;
        if (name === "Share") return sharePlugin;
        return undefined;
    });

    (window as unknown as CapacitorWindow).Capacitor = { Plugins: {}, registerPlugin };

    return { filesystem, sharePlugin, registerPlugin, written, removed };
}

/**
 * Models `window.triliumFileSink`, the binary channel `TriliumFileSink.java` injects: acknowledges
 * every message the way the native side does, or answers a chunk with an error when asked to.
 */
function installFileSink({ failOnChunk = false } = {}) {
    const posted: (string | ArrayBuffer)[] = [];
    const listeners = new Set<(event: { data: string }) => void>();
    const reply = (data: string) => queueMicrotask(() => {
        for (const listener of [ ...listeners ]) {
            listener({ data });
        }
    });

    const sink = {
        postMessage: (message: string | ArrayBuffer) => {
            posted.push(message);
            if (typeof message !== "string") {
                reply(failOnChunk ? "error:disk full" : "written");
            } else {
                reply((JSON.parse(message) as { type: string }).type === "open" ? "opened" : "closed");
            }
        },
        addEventListener: (_type: string, listener: (event: { data: string }) => void) => {
            listeners.add(listener);
        },
        removeEventListener: (_type: string, listener: (event: { data: string }) => void) => {
            listeners.delete(listener);
        }
    };
    (window as { triliumFileSink?: unknown }).triliumFileSink = sink;

    return { posted, listeners };
}

/** The bytes handed to the plugin, decoded back out of the base64 each write carried. */
function writtenBytes(written: { data: string }[]): Uint8Array {
    const binary = written.map((write) => atob(write.data)).join("");
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

/** A response whose body streams in `chunkSize` pieces, as a real network body would. */
function streamingResponse(bytes: Uint8Array, headers: Record<string, string>, chunkSize: number): Response {
    let offset = 0;
    const body = new ReadableStream<Uint8Array>({
        pull(controller) {
            if (offset >= bytes.length) {
                controller.close();
                return;
            }
            controller.enqueue(bytes.slice(offset, offset + chunkSize));
            offset += chunkSize;
        }
    });
    return fakeResponse({ headers, body });
}

function fakeResponse({
    status = 200,
    headers = {},
    body = null,
    buffer
}: {
    status?: number;
    headers?: Record<string, string>;
    body?: ReadableStream<Uint8Array> | null;
    buffer?: Uint8Array;
}): Response {
    const map = new Map(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]));
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (key: string) => map.get(key.toLowerCase()) ?? null },
        body,
        arrayBuffer: async () => (buffer ?? new Uint8Array(0)).buffer
    } as unknown as Response;
}

describe("capacitor download", () => {
    beforeEach(() => {
        setChunkBytesForTests(CHUNK_BYTES);
    });

    afterEach(() => {
        setChunkBytesForTests();
        delete (window as unknown as CapacitorWindow).Capacitor;
        delete (window as { triliumFileSink?: unknown }).triliumFileSink;
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    describe("fileNameOf", () => {
        it("prefers filename* over filename, decodes both, and falls back to the URL then a default", () => {
            const disposition = (value: string) =>
                fakeResponse({ headers: { "content-disposition": value } });

            expect(fileNameOf(
                disposition(`attachment; filename="Plain.zip"; filename*=UTF-8''N%C3%B6tes.zip`),
                "https://localhost/api/x"
            )).toBe("Nötes.zip");

            expect(fileNameOf(
                disposition(`attachment; filename="My%20Notes.zip"`),
                "https://localhost/api/x"
            )).toBe("My Notes.zip");

            expect(fileNameOf(
                fakeResponse({}),
                "https://localhost/api/notes/abc/download?123"
            )).toBe("download");

            expect(fileNameOf(fakeResponse({}), "https://localhost/api/")).toBe("download");
        });

        it("keeps the name to a single, harmless path segment", () => {
            const named = (value: string) =>
                fileNameOf(
                    fakeResponse({ headers: { "content-disposition": `attachment; filename="${value}"` } }),
                    "https://localhost/api/x"
                );

            expect(named("..%2F..%2Fetc%2Fpasswd")).toBe("-..-etc-passwd");
            expect(named("a%3Ab%3Fc.zip")).toBe("a-b-c.zip");
        });
    });

    describe("saveUrlToDevice", () => {
        it("writes the body in chunks that decode back to the original bytes, then shares the file", async () => {
            const { filesystem, sharePlugin, written, removed } = installCapacitor();
            // Over one chunk, so the write is split and the append path runs. The pattern repeats
            // at 251 (a prime, coprime with the chunk size) so a chunk boundary landing on the
            // wrong byte shows up as a mismatch rather than an accidental match.
            const bytes = Uint8Array.from({ length: CHUNK_BYTES + 4001 }, (_, i) => i % 251);
            vi.stubGlobal("fetch", vi.fn(async () => streamingResponse(
                bytes,
                { "content-disposition": `attachment; filename*=UTF-8''Export.zip` },
                8 * 1024
            )));

            const result = await saveUrlToDevice("api/branches/b1/export/subtree/html/t1");

            expect(result).toEqual({
                status: "saved",
                fileName: "Export.zip",
                // The `file://` scheme is stripped: this is shown to a person, not opened.
                location: "/cache/trilium-downloads/Export.zip"
            });
            expect(removed).toEqual(["trilium-downloads"]);
            expect(written.map((write) => write.append)).toEqual([false, true]);
            expect(written.every((write) => write.path === "trilium-downloads/Export.zip")).toBe(true);
            expect(writtenBytes(written)).toEqual(bytes);
            expect(filesystem.writeFile).toHaveBeenCalledWith(
                expect.objectContaining({ directory: "CACHE", recursive: true })
            );
            expect(sharePlugin.share).toHaveBeenCalledWith({
                title: "Export.zip",
                files: ["file:///cache/trilium-downloads/Export.zip"]
            });
        });

        it("reads a response with no streaming body whole, and writes an empty one as an empty file", async () => {
            const { written } = installCapacitor();
            const bytes = Uint8Array.from([1, 2, 3, 4, 5]);
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({
                headers: { "content-disposition": `attachment; filename="a.bin"` },
                buffer: bytes
            })));
            expect(await saveUrlToDevice("api/x")).toMatchObject({ status: "saved", fileName: "a.bin" });
            expect(writtenBytes(written)).toEqual(bytes);

            written.length = 0;
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({})));
            expect(await saveUrlToDevice("api/empty.bin")).toMatchObject({ status: "saved", fileName: "empty.bin" });
            expect(written).toEqual([
                expect.objectContaining({ data: "", append: false })
            ]);
        });

        it("reports a cancelled share sheet as cancelled, and any other share error as a failure", async () => {
            installCapacitor({ share: vi.fn(async () => { throw new Error("Share canceled"); }) });
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ buffer: Uint8Array.from([1]) })));
            // Still a file on disk, which is what `location` says and what makes a dismissed sheet
            // survivable for a backup.
            expect(await saveUrlToDevice("api/a.bin")).toEqual({
                status: "cancelled",
                fileName: "a.bin",
                location: "/cache/trilium-downloads/a.bin"
            });

            installCapacitor({ share: vi.fn(async () => { throw new Error("No app can open this"); }) });
            expect(await saveUrlToDevice("api/a.bin")).toMatchObject({
                status: "failed",
                fileName: "a.bin",
                message: "No app can open this"
            });
        });

        it("fails on an error status, and on a bridge that has no Filesystem plugin", async () => {
            installCapacitor();
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ status: 500 })));
            expect(await saveUrlToDevice("api/x")).toEqual({
                status: "failed",
                message: "The download answered 500."
            });

            (window as unknown as CapacitorWindow).Capacitor = { Plugins: {} };
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({
                headers: { "content-disposition": `attachment; filename="a.bin"` },
                buffer: Uint8Array.from([1])
            })));
            expect(await saveUrlToDevice("api/x")).toEqual({
                status: "failed",
                fileName: "a.bin",
                message: "The Filesystem plugin is not available"
            });
        });
    });

    describe("saveChunksToDevice", () => {
        /** Emits `bytes` in pieces of `size`, which is how an arbitrary producer feeds the writer. */
        async function* inPieces(bytes: Uint8Array, size: number) {
            for (let offset = 0; offset < bytes.length; offset += size) {
                yield bytes.slice(offset, offset + size);
            }
        }

        /** The sink's messages joined back into the bytes they carried. */
        function concatBuffers(buffers: ArrayBuffer[]): Uint8Array {
            const total = buffers.reduce((sum, buffer) => sum + buffer.byteLength, 0);
            const out = new Uint8Array(total);
            let offset = 0;
            for (const buffer of buffers) {
                out.set(new Uint8Array(buffer), offset);
                offset += buffer.byteLength;
            }
            return out;
        }

        it("realigns a source whose chunks are not a multiple of 3 bytes", async () => {
            const { written } = installCapacitor();
            // 4001 is coprime with 3, so every incoming piece straddles a base64 group. Writing
            // these through unaligned would pad mid-file and corrupt everything after the first
            // piece, which is exactly what the database backup's page-sized chunks would do. The
            // total clears one write, so there is a boundary to get wrong.
            const bytes = Uint8Array.from({ length: CHUNK_BYTES * 2 + 7 }, (_, i) => (i * 7) % 251);

            const result = await saveChunksToDevice("db.tnbackup", inPieces(bytes, 4001), BACKUP_TARGET);

            expect(result.status).toBe("saved");
            expect(writtenBytes(written)).toEqual(bytes);
            // Every write but the last is a whole chunk, so every write but the last is 3-aligned.
            expect(written.slice(0, -1).every((write) => atob(write.data).length % 3 === 0)).toBe(true);
        });

        it("writes a backup into documents and leaves the previous ones alone", async () => {
            const { written, removed, sharePlugin } = installCapacitor();

            const result = await saveChunksToDevice(
                "db.tnbackup", inPieces(Uint8Array.from([1, 2, 3]), 3), BACKUP_TARGET
            );

            // Sweeping the folder before each write is right for the share sheet's scratch space
            // and would destroy the previous backup here.
            expect(removed).toEqual([]);
            expect(written).toEqual([
                expect.objectContaining({ path: "Trilium/db.tnbackup", directory: "DOCUMENTS" })
            ]);
            expect(result.location).toBe("/cache/Trilium/db.tnbackup");
            expect(sharePlugin.share).toHaveBeenCalledWith({
                title: "db.tnbackup",
                files: ["file:///cache/Trilium/db.tnbackup"]
            });
        });

        it("streams raw bytes through the native sink when the shell provides one", async () => {
            const { filesystem, written, sharePlugin } = installCapacitor();
            const { posted, listeners } = installFileSink();
            const bytes = Uint8Array.from({ length: CHUNK_BYTES + 4001 }, (_, i) => (i * 13) % 251);

            const result = await saveChunksToDevice("db.tnbackup", inPieces(bytes, 4001), BACKUP_TARGET);

            expect(result).toMatchObject({ status: "saved", location: "/cache/Trilium/db.tnbackup" });
            // The plugin only creates the empty file, so its own directory mapping resolves the
            // absolute path; the bytes themselves never ride the plugin bridge.
            expect(written).toEqual([ expect.objectContaining({ data: "", append: false }) ]);
            expect(filesystem.appendFile).not.toHaveBeenCalled();

            expect(posted[0]).toBe(JSON.stringify({ type: "open", path: "/cache/Trilium/db.tnbackup" }));
            expect(posted.at(-1)).toBe(JSON.stringify({ type: "close" }));
            const streamed = posted.filter((message): message is ArrayBuffer => typeof message !== "string");
            expect(streamed.length).toBe(2);
            expect(concatBuffers(streamed)).toEqual(bytes);

            expect(sharePlugin.share).toHaveBeenCalled();
            // The transfer's listener is gone, so the next save starts with a clean channel.
            expect(listeners.size).toBe(0);
        });

        it("fails the save when the sink answers a chunk with an error, without sharing", async () => {
            const { sharePlugin } = installCapacitor();
            const { listeners } = installFileSink({ failOnChunk: true });

            const result = await saveChunksToDevice(
                "db.tnbackup", inPieces(Uint8Array.from([ 1, 2, 3 ]), 3), BACKUP_TARGET
            );

            expect(result).toEqual({
                status: "failed",
                fileName: "db.tnbackup",
                message: "disk full"
            });
            expect(sharePlugin.share).not.toHaveBeenCalled();
            expect(listeners.size).toBe(0);
        });

        it("encodes through the runtime's own toBase64 when it has one, to the same bytes", async () => {
            // Node has no Uint8Array.prototype.toBase64 yet, so the suite otherwise only ever runs
            // the fallback — while every current WebView takes this path.
            const proto = Uint8Array.prototype as unknown as { toBase64?: (this: Uint8Array) => string };
            const original = proto.toBase64;
            let calls = 0;
            proto.toBase64 = function (this: Uint8Array) {
                calls++;
                let binary = "";
                for (const byte of this) {
                    binary += String.fromCharCode(byte);
                }
                return btoa(binary);
            };

            try {
                const { written } = installCapacitor();
                const bytes = Uint8Array.from({ length: CHUNK_BYTES + 17 }, (_, i) => (i * 11) % 251);

                const result = await saveChunksToDevice("n.bin", inPieces(bytes, 5000), BACKUP_TARGET);

                expect(result.status).toBe("saved");
                expect(calls).toBeGreaterThan(0);
                expect(writtenBytes(written)).toEqual(bytes);
            } finally {
                if (original) {
                    proto.toBase64 = original;
                } else {
                    delete proto.toBase64;
                }
            }
        });

        it("fails without sharing when the source throws part-way through", async () => {
            const { sharePlugin } = installCapacitor();
            async function* breaks() {
                yield Uint8Array.from([1, 2, 3]);
                throw new Error("The backup stream failed.");
            }

            expect(await saveChunksToDevice("db.tnbackup", breaks(), BACKUP_TARGET)).toEqual({
                status: "failed",
                fileName: "db.tnbackup",
                message: "The backup stream failed."
            });
            expect(sharePlugin.share).not.toHaveBeenCalled();
        });
    });
});
