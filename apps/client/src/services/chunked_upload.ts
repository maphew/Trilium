import server from "./server.js";

/**
 * Uploads a file to a chunked upload endpoint, a slice at a time.
 *
 * A single request cannot carry a file measured in gigabytes with any confidence: a reverse proxy
 * caps the body, a timeout ends it, a dropped connection loses all of it, and there is no progress to
 * show along the way. Sending it in slices answers all four, because each slice is an ordinary small
 * request that can be retried on its own.
 *
 * The server is the authority on how far the file has got. Every failure is followed by asking it
 * where to continue from, so a slice whose response was lost is never sent twice and a slice that
 * broke partway resumes at the byte it stopped at.
 *
 * Nothing here knows what the file is for: the endpoint decides that, and `metadata` reaches it
 * untouched.
 *
 * @example
 * ```ts
 * const result = await uploadInChunks<RestoreStarted>({
 *     endpoint: "setup/restore/upload",
 *     blob: file,
 *     fileName: file.name,
 *     onProgress: ({ fraction, etaMs }) => setProgress({ fraction, etaMs }),
 *     signal: abortController.signal
 * });
 * ```
 *
 * @module
 */

/** Content type of a chunk. Deliberately not `application/octet-stream`, which the server's own body
 * parser would swallow into memory before the route ever saw it. */
export const CHUNK_CONTENT_TYPE = "application/vnd.trilium.chunk";

export interface ChunkedUploadProgress {
    sentBytes: number;
    totalBytes: number;
    /** Between 0 and 1. */
    fraction: number;
    /** Averaged over the transfer so far; 0 until the first chunk lands. */
    bytesPerSecond: number;
    /** Milliseconds left at the current rate, or `null` while there is nothing to work that out from. */
    etaMs: number | null;
}

export interface ChunkedUploadOptions {
    /** Base path of the endpoint, relative to the API root, e.g. `"setup/restore/upload"`. */
    endpoint: string;
    blob: Blob;
    /** The name to give the file at the other end. */
    fileName: string;
    /** Passed to the endpoint as-is when the upload starts. */
    metadata?: Record<string, unknown>;
    onProgress?: (progress: ChunkedUploadProgress) => void;
    /** Cancels the upload and tells the server to forget it. */
    signal?: AbortSignal;
    /** Attempts per chunk before the upload gives up. Defaults to 5. */
    maxRetriesPerChunk?: number;
    /** Delay before the first retry, doubling with each further one. Defaults to 500ms. */
    retryDelayMs?: number;
}

/** What the endpoint says about a session, whether it is being started or asked after. */
export interface ChunkedUploadStatus {
    uploadId: string;
    fileName: string;
    totalBytes: number;
    receivedBytes: number;
    chunkSize: number;
    expiresAt: number;
}

/**
 * Sends `blob` to `endpoint` and returns whatever that endpoint answers once the file is complete.
 *
 * @throws the server's own message for a failure it will not recover from, or `"Upload cancelled"`
 *         when the caller's signal aborts.
 */
export async function uploadInChunks<T>(options: ChunkedUploadOptions): Promise<T> {
    const { endpoint, blob, fileName, metadata, onProgress, signal } = options;
    const maxRetries = options.maxRetriesPerChunk ?? 5;
    const retryDelayMs = options.retryDelayMs ?? 500;
    const totalBytes = blob.size;

    const session = await request<ChunkedUploadStatus>("POST", `${endpoint}/begin`, {
        signal,
        body: JSON.stringify({ fileName, totalBytes, metadata }),
        contentType: "application/json"
    });

    const startedAt = Date.now();
    let sentBytes = session.receivedBytes;
    report(0);

    try {
        while (sentBytes < totalBytes) {
            // The slice and the offset are both taken when the attempt runs, not when it is written:
            // a retry that follows a resync has to send what the server is actually waiting for.
            const sent = await withRetries(
                () => request<ChunkedUploadStatus>(
                    "POST",
                    `${endpoint}/${session.uploadId}/chunk?offset=${sentBytes}`,
                    {
                        signal,
                        body: blob.slice(sentBytes, sentBytes + session.chunkSize),
                        contentType: CHUNK_CONTENT_TYPE
                    }
                ),
                // Whatever went wrong, the server knows what it holds and this side does not: a lost
                // response means the chunk did land, a broken connection means part of it did.
                async () => {
                    const status = await request<ChunkedUploadStatus>("GET", `${endpoint}/${session.uploadId}`, { signal });
                    sentBytes = status.receivedBytes;
                },
                maxRetries,
                retryDelayMs,
                signal
            );

            sentBytes = sent.receivedBytes;
            report(sentBytes);
        }

        return await request<T>("POST", `${endpoint}/${session.uploadId}/finish`, { signal });
    } catch (e) {
        // The session would expire on its own, but not before holding the whole file on the server's
        // disk for an hour and, where only one upload is allowed at a time, the next attempt with it.
        await request("DELETE", `${endpoint}/${session.uploadId}`).catch(() => {});
        throw e;
    }

    function report(sent: number) {
        if (!onProgress) {
            return;
        }

        const elapsedMs = Date.now() - startedAt;
        const bytesPerSecond = sent > 0 && elapsedMs > 0 ? (sent / elapsedMs) * 1000 : 0;

        onProgress({
            sentBytes: sent,
            totalBytes,
            fraction: totalBytes > 0 ? sent / totalBytes : 0,
            bytesPerSecond,
            etaMs: bytesPerSecond > 0 ? ((totalBytes - sent) / bytesPerSecond) * 1000 : null
        });
    }
}

/**
 * Retries `attempt` while the failure is one that retrying can fix: the connection, or the server
 * having moved on from the offset the chunk was for. A rejection the request itself earned, e.g. a
 * malformed one or a session that is gone, is raised immediately rather than repeated.
 */
async function withRetries<T>(
    attempt: () => Promise<T>,
    resync: () => Promise<void>,
    maxRetries: number,
    retryDelayMs: number,
    signal?: AbortSignal
): Promise<T> {
    for (let retriesLeft = maxRetries; ; retriesLeft--) {
        try {
            return await attempt();
        } catch (e) {
            if (retriesLeft <= 0 || !isWorthRetrying(e) || signal?.aborted) {
                throw e;
            }
        }

        await delay(retryDelayMs * 2 ** (maxRetries - retriesLeft), signal);
        await resync();
    }
}

function isWorthRetrying(e: unknown): boolean {
    if (e instanceof ChunkedUploadError) {
        // A conflict means the offset has moved, which the resync then corrects; anything else in the
        // 4xx range is this side's mistake and would fail again identically.
        return e.status === 409 || e.status >= 500;
    }

    // No status at all: the request never completed, which is exactly what a retry is for.
    return !(e instanceof DOMException && e.name === "AbortError");
}

/** A response the server refused, carrying the status so the retry rules can tell the cases apart. */
export class ChunkedUploadError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "ChunkedUploadError";
    }
}

interface RequestOptions {
    body?: BodyInit;
    contentType?: string;
    signal?: AbortSignal;
}

async function request<T>(method: string, url: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {};
    for (const [ name, value ] of Object.entries(await server.getHeaders())) {
        if (value) {
            headers[name] = value;
        }
    }
    if (options.contentType) {
        headers["content-type"] = options.contentType;
    }

    const response = await fetch(`${window.glob.baseApiUrl}${url}`, {
        method,
        headers,
        body: options.body,
        signal: options.signal
    });

    if (!response.ok) {
        throw new ChunkedUploadError(await messageOf(response), response.status);
    }

    return response.status === 204 ? (undefined as T) : await response.json() as T;
}

/** The server's own words where it gave any, since they are what the user is shown. */
async function messageOf(response: Response): Promise<string> {
    try {
        const body = await response.text();
        const parsed = body.startsWith("{") ? JSON.parse(body) as { message?: string } : null;

        return parsed?.message || body || response.statusText;
    } catch {
        return response.statusText;
    }
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);

        function onAbort() {
            clearTimeout(timer);
            reject(new DOMException("Upload cancelled", "AbortError"));
        }

        signal?.addEventListener("abort", onAbort, { once: true });
    });
}
