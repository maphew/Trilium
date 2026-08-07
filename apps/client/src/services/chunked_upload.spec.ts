import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHUNK_CONTENT_TYPE, ChunkedUploadError, uploadInChunks } from "./chunked_upload.js";

vi.mock("./server.js", () => ({
    default: {
        // A null header must not reach fetch, which would send it as the string "null".
        getHeaders: async () => ({ "x-csrf-token": "token", "trilium-hoisted-note-id": null })
    }
}));

const CHUNK_SIZE = 4;

/** Stands in for the endpoint: accumulates what it is sent and answers the way the server does. */
class FakeEndpoint {
    received = "";
    totalBytes = 0;
    aborted = false;
    finished = false;
    readonly calls: { method: string; url: string; headers: Record<string, string> }[] = [];
    /** Queued failures, applied to chunk requests in order. `null` sends the chunk through. */
    private readonly failures: (Failure | null)[] = [];

    failNextChunks(...failures: (Failure | null)[]) {
        this.failures.push(...failures);
    }

    fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
        const method = init.method ?? "GET";
        this.calls.push({ method, url, headers: init.headers as Record<string, string> });

        if (url.endsWith("/begin")) {
            const body = JSON.parse(String(init.body)) as { totalBytes: number };
            this.totalBytes = body.totalBytes;
            return json({ uploadId: "upload1", fileName: "backup.db", totalBytes: body.totalBytes, receivedBytes: 0, chunkSize: CHUNK_SIZE, expiresAt: 0 });
        }

        if (url.includes("/chunk?offset=")) {
            const failure = this.failures.shift();
            if (failure) {
                return failure.status ? error(failure.status, failure.message) : Promise.reject(new TypeError("Failed to fetch"));
            }

            const offset = Number(url.split("offset=")[1]);
            if (offset !== this.received.length) {
                return error(409, `Chunk starts at ${offset}, but ${this.received.length} bytes have been received.`);
            }

            this.received += await (init.body as Blob).text();
            return json(this.status());
        }

        if (url.endsWith("/finish")) {
            this.finished = true;
            return json({ restored: this.received });
        }

        if (method === "DELETE") {
            this.aborted = true;
            return new Response(null, { status: 204 });
        }

        return json(this.status());
    };

    private status() {
        return { uploadId: "upload1", fileName: "backup.db", totalBytes: this.totalBytes, receivedBytes: this.received.length, chunkSize: CHUNK_SIZE, expiresAt: 0 };
    }
}

interface Failure {
    /** Omitted for a connection that never answered at all. */
    status?: number;
    message?: string;
}

function json(body: unknown) {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function error(status: number, message = "failed") {
    return new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json" } });
}

function upload(endpoint: FakeEndpoint, content: string, overrides = {}) {
    return uploadInChunks<{ restored: string }>({
        endpoint: "setup/restore/upload",
        blob: new Blob([ content ]),
        fileName: "backup.db",
        retryDelayMs: 0,
        ...overrides
    });
}

let endpoint: FakeEndpoint;

beforeEach(() => {
    endpoint = new FakeEndpoint();
    window.glob = { ...window.glob, baseApiUrl: "api/" } as typeof window.glob;
    vi.stubGlobal("fetch", endpoint.fetch);
});

afterEach(() => vi.unstubAllGlobals());

describe("chunked upload", () => {
    it("sends the file a slice at a time and returns what the endpoint answers", async () => {
        const content = "restore me please";

        const result = await upload(endpoint, content);

        expect(result).toEqual({ restored: content });
        expect(endpoint.received).toBe(content);
        expect(endpoint.finished).toBe(true);

        const offsets = endpoint.calls.filter((call) => call.url.includes("/chunk?")).map((call) => Number(call.url.split("offset=")[1]));
        expect(offsets).toEqual([ 0, 4, 8, 12, 16 ]);
    });

    it("sends the headers the API expects, dropping the ones with nothing in them", async () => {
        await upload(endpoint, "abcd");

        const chunkCall = endpoint.calls.find((call) => call.url.includes("/chunk?"));
        expect(chunkCall?.headers).toEqual({ "x-csrf-token": "token", "content-type": CHUNK_CONTENT_TYPE });
        expect(endpoint.calls[0].headers).toMatchObject({ "content-type": "application/json" });
    });

    it("reports progress that climbs to the whole file", async () => {
        const onProgress = vi.fn();

        await upload(endpoint, "12345678", { onProgress });

        const fractions = onProgress.mock.calls.map(([ progress ]) => progress.fraction);
        expect(fractions[0]).toBe(0);
        expect(fractions.at(-1)).toBe(1);
        expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ sentBytes: 8, totalBytes: 8 }));
    });

    it("asks the endpoint where the file got to before retrying, so nothing is sent twice", async () => {
        // The first chunk lands but its response is lost, and the second connection simply fails.
        endpoint.failNextChunks({ status: 409, message: "offset moved" }, {});

        const result = await upload(endpoint, "abcdefgh");

        expect(result).toEqual({ restored: "abcdefgh" });
        expect(endpoint.received).toBe("abcdefgh");
        expect(endpoint.calls.filter((call) => call.method === "GET")).toHaveLength(2);
    });

    it("gives up on a failure retrying cannot fix, and tells the endpoint to forget the upload", async () => {
        endpoint.failNextChunks({ status: 400, message: "the offset must be stated as an integer" });

        await expect(upload(endpoint, "abcd")).rejects.toThrow("the offset must be stated as an integer");
        expect(endpoint.aborted).toBe(true);
        expect(endpoint.calls.filter((call) => call.url.includes("/chunk?"))).toHaveLength(1);
    });

    it("gives up once the retries are spent", async () => {
        endpoint.failNextChunks({}, {}, {}, {});

        await expect(upload(endpoint, "abcd", { maxRetriesPerChunk: 2 })).rejects.toBeInstanceOf(TypeError);
        expect(endpoint.calls.filter((call) => call.url.includes("/chunk?"))).toHaveLength(3);
        expect(endpoint.aborted).toBe(true);
    });

    it("raises the endpoint's own words, with the status it refused on", async () => {
        endpoint.failNextChunks({ status: 507, message: "the disk is full" });

        const failure = await upload(endpoint, "abcd", { maxRetriesPerChunk: 0 }).catch((e) => e);

        expect(failure).toBeInstanceOf(ChunkedUploadError);
        expect(failure).toMatchObject({ message: "the disk is full", status: 507 });
    });

    it("stops when the caller cancels, and leaves nothing behind on the endpoint", async () => {
        const controller = new AbortController();
        endpoint.failNextChunks({ status: 500 });
        controller.abort();

        await expect(upload(endpoint, "abcdefgh", { signal: controller.signal })).rejects.toThrow();
        expect(endpoint.aborted).toBe(true);
        expect(endpoint.finished).toBe(false);
    });

    it("does not try to abort a session that was never started", async () => {
        vi.stubGlobal("fetch", async () => error(409, "Another upload is already in progress."));

        await expect(upload(endpoint, "abcd")).rejects.toThrow("Another upload is already in progress.");
        expect(endpoint.aborted).toBe(false);
    });
});
