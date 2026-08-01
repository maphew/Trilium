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
import { parentPort } from "node:worker_threads";

import { compressImageBytes } from "./image_codec.js";

export interface ImageWorkerRequest {
    /** Matches the answer to the question, the two being in flight together with others. */
    id: number;
    buffer: Uint8Array;
    request: ImageCompressionRequest;
    /** The most this decode may allocate — what the caller set aside for it. */
    budgetMb: number;
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
parentPort?.on("message", (message: ImageWorkerRequest) => {
    const logs: string[] = [];

    compressImageBytes(message.buffer, message.request, (line) => logs.push(line), message.budgetMb)
        .then(
            (outcome) => reply({ id: message.id, outcome, logs }),
            (error: unknown) => reply({ id: message.id, error: describe(error), logs })
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
