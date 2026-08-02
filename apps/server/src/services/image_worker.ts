/**
 * The worker side of image compression: decodes and re-encodes one image at a time, off the thread
 * that has to keep answering requests.
 *
 * Deliberately tiny, and importing only {@link image_codec}. Everything Trilium — options, the
 * database, the logger — stays on the other side of the message, so this bundles to jimp and a few
 * hundred lines rather than to a second copy of the server.
 *
 * Nothing here decides anything. It is handed the bytes, the settings and the memory it may use,
 * and answers with what came out; a caller that never hears back falls back to doing it itself.
 */

import type { ImageCompressionOutcome, ImageCompressionRequest } from "@triliumnext/core/src/services/image_provider.js";
import { getHeapStatistics } from "node:v8";
import { parentPort, threadId } from "node:worker_threads";

import { compressImageBytes } from "./image_codec.js";

export interface ImageWorkerRequest {
    /** Matches the answer to the question, the two being in flight together with others. */
    id: number;
    buffer: Uint8Array;
    request: ImageCompressionRequest;
    /** The most this decode may allocate — what the caller set aside for it. */
    budgetMb: number;
}

/** A line the worker wants written as it happens, rather than when — or if — it finishes. */
export interface ImageWorkerTrace {
    trace: string;
}

export interface ImageWorkerResponse {
    id: number;
    outcome?: ImageCompressionOutcome;
    /** Set when the image could not be compressed at all; the caller reports it against that image. */
    error?: string;
    /** What the codec wanted written, carried back to the thread that has somewhere to write it. */
    logs: string[];
}

/* v8 ignore start -- runs only inside a worker thread, where the harness does not follow. What it
   does is exercised through the codec directly; what is left here is the message plumbing. */

/**
 * Traced on the worker's own output rather than through the reply.
 *
 * The reply is no use for diagnosing a thread that is not answering, which is the failure worth
 * tracing: whatever it would have carried is exactly what never arrives. This goes to the parent's
 * stdout as it happens, so a thread that stops can be seen stopping and where.
 */
/**
 * Sends a line to the thread that has a logger, and prints it besides.
 *
 * Sent rather than only printed because a packaged desktop app has nowhere to show a thread's
 * stdout, and the backend log is where someone looking into a run is actually reading.
 */
const announce = (message: string) => {
    console.log(`[image worker ${threadId}] ${message}`);
    parentPort?.postMessage({ trace: `worker ${threadId}: ${message}` } satisfies ImageWorkerTrace);
};

/** The per-image commentary, which would be a line an image without the asking. */
const trace = (message: string) => {
    if (process.env.TRILIUM_IMAGE_WORKER_DEBUG) {
        announce(message);
    }
};

// Announced whether or not anyone asked for tracing: one line per thread, and the one that answers
// why a run is slow rather than broken. A thread whose old space is smaller than the decode it is
// handed does not fail — it collects, over and over, taking several times longer while looking
// perfectly healthy. What V8 actually granted is the only place that shows.
announce(`loaded and listening; heap limit ${Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024)} MB`);

parentPort?.on("message", (message: ImageWorkerRequest) => {
    const logs: string[] = [];
    const started = Date.now();

    trace(`received image #${message.id}, ${message.buffer.byteLength} bytes, budget ${message.budgetMb} MB`);

    compressImageBytes(
        message.buffer,
        message.request,
        // Detail is carried back only when it was asked for; the caller would drop it anyway, and
        // it would otherwise travel between threads an image at a time for nothing.
        (line, detail) => {
            if (!detail || process.env.TRILIUM_IMAGE_WORKER_DEBUG) {
                logs.push(line);
            }
        },
        message.budgetMb
    )
        .then(
            (outcome) => {
                trace(`image #${message.id} ${outcome.compressed ? "compressed" : `skipped (${outcome.reason})`}`
                    + ` in ${Date.now() - started}ms; replying`);
                reply({ id: message.id, outcome, logs });
            },
            (error: unknown) => {
                trace(`image #${message.id} failed in ${Date.now() - started}ms: ${describe(error)}`);
                reply({ id: message.id, error: describe(error), logs });
            }
        );
});

/**
 * Sends the answer back, letting the bytes be copied rather than handed over.
 *
 * Transferring them would save the copy, but an encoder's output does not necessarily own the
 * memory behind it — jimp returns a Node buffer, which is commonly a window onto a shared pool, and
 * handing that over fails outright. The copy is of the compressed image, which is the smaller of
 * the two and the one already worth the least; paying it buys a path that cannot fail this way.
 */
function reply(response: ImageWorkerResponse) {
    parentPort?.postMessage(response);
}

function describe(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
/* v8 ignore stop */
