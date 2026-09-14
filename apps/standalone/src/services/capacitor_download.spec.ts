import { afterEach, describe, expect, it, vi } from "vitest";

import { fileNameOf, saveUrlToDevice } from "./capacitor_download.js";

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

/** The bytes handed to the plugin, decoded back out of the base64 each write carried. */
function writtenBytes(written: { data: string }[]): Uint8Array {
    const binary = written.map((write) => atob(write.data)).join("");
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
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
    afterEach(() => {
        delete (window as unknown as CapacitorWindow).Capacitor;
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
            // Over one 768 KiB chunk, so the write is split and the append path runs. The pattern
            // repeats at 251 (a prime, coprime with the chunk size) so a chunk boundary landing on
            // the wrong byte shows up as a mismatch rather than an accidental match.
            const bytes = Uint8Array.from({ length: 900 * 1024 }, (_, i) => i % 251);
            vi.stubGlobal("fetch", vi.fn(async () => streamingResponse(
                bytes,
                { "content-disposition": `attachment; filename*=UTF-8''Export.zip` },
                64 * 1024
            )));

            const result = await saveUrlToDevice("api/branches/b1/export/subtree/html/t1");

            expect(result).toEqual({ status: "saved", fileName: "Export.zip" });
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
            expect(await saveUrlToDevice("api/x")).toEqual({ status: "saved", fileName: "a.bin" });
            expect(writtenBytes(written)).toEqual(bytes);

            written.length = 0;
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({})));
            expect(await saveUrlToDevice("api/empty.bin")).toEqual({ status: "saved", fileName: "empty.bin" });
            expect(written).toEqual([
                expect.objectContaining({ data: "", append: false })
            ]);
        });

        it("reports a cancelled share sheet as cancelled, and any other share error as a failure", async () => {
            installCapacitor({ share: vi.fn(async () => { throw new Error("Share canceled"); }) });
            vi.stubGlobal("fetch", vi.fn(async () => fakeResponse({ buffer: Uint8Array.from([1]) })));
            expect(await saveUrlToDevice("api/a.bin")).toEqual({ status: "cancelled", fileName: "a.bin" });

            installCapacitor({ share: vi.fn(async () => { throw new Error("No app can open this"); }) });
            expect(await saveUrlToDevice("api/a.bin")).toEqual({
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
});
