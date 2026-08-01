/**
 * A small pool of worker threads that compress images, so the decoding stops holding the thread
 * that serves the application.
 *
 * Decoding is synchronous from beginning to end — jpeg-js, pngjs and UPNG all run to completion
 * without yielding — so an image being compressed on the main thread is an application that has
 * stopped answering for as long as it takes. Moving that off-thread is worth more than the extra
 * cores it also buys.
 *
 * Nothing here is load-bearing. Every way this can fail — a worker file that is not where it was
 * expected, a thread that will not start, one that dies mid-image — ends in the same place: the
 * caller is told so once and compresses in this process instead, exactly as it always did.
 *
 * This is the Node half of the platform, reached only through the server's own image provider —
 * the server itself and the desktop app, whose main process is Node too. The standalone build has
 * no decoder to run in a thread and never arrives here; it answers for itself.
 */

import { getLog } from "@triliumnext/core";
import type { ImageCompressionOutcome, ImageCompressionRequest } from "@triliumnext/core/src/services/image_provider.js";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { join } from "node:path";
import { Worker } from "node:worker_threads";

import type { ImageWorkerRequest, ImageWorkerResponse } from "./image_worker.js";

/**
 * How many images may be compressed at once, or 1 where they cannot be compressed off-thread at
 * all — which is the same answer as "do it here", and is what the caller schedules against.
 *
 * One per core. The thread this frees up needs very little while they work — it hands out images,
 * takes the results and writes them — so holding a core back for it would leave one idle through
 * the whole run for the sake of the part that is already waiting.
 *
 * This is a ceiling rather than a promise: what actually runs at once is whatever the memory budget
 * admits, so on a machine with many cores and images to match, the budget is the binding constraint
 * and this never comes into it.
 *
 * `availableParallelism` rather than the raw core count: it follows the affinity the process was
 * given, so a container pinned to two cores is answered as two.
 */
export function compressionConcurrency(): number {
    return workerEntry() ? Math.max(1, availableParallelism()) : 1;
}

/**
 * Compresses one image in a worker, or answers `null` if there is no worker to do it in — which the
 * caller reads as "then do it yourself" rather than as a failure of the image.
 *
 * @param budgetMb the most this decode may allocate, which the caller has already set aside for it.
 */
export async function compressInWorker(
    buffer: Uint8Array,
    request: ImageCompressionRequest,
    budgetMb: number
): Promise<ImageCompressionOutcome | null> {
    if (!workerEntry()) {
        return disable("no worker entry point was found");
    }

    const worker = await acquire();

    if (!worker) {
        return null;
    }

    try {
        const response = await send(worker, buffer, request, budgetMb);

        everSucceeded = true;

        // The worker's own logging, written here because here is where a logger exists.
        response.logs.forEach((line) => getLog().info(line));

        if (response.error) {
            throw new Error(response.error);
        }

        return response.outcome ?? null;
    } catch (e: unknown) {
        // A thread that failed us once is not trusted with the next image: it may have died, and a
        // pool of one bad worker would fail every image in the run rather than none.
        discard(worker);

        // Nothing has ever come back from a worker here, so this is not one thread having died but
        // this installation being unable to run them — an environment whose loader cannot read the
        // entry point, say. Trying again per image would fail a thousand times over.
        if (!everSucceeded) {
            disable(`they do not work here (${firstLine(e)})`);
        }

        throw e;
    } finally {
        release(worker);
    }
}

/** Stops the pool between runs, so an idle Trilium is not holding threads it is not using. */
export function shutdownImageWorkers() {
    idle.forEach((pooled) => void pooled.worker.terminate());
    idle.length = 0;
}

interface PooledWorker {
    worker: Worker;
    pending?: (response: ImageWorkerResponse) => void;
    failed?: (error: unknown) => void;
}

const idle: PooledWorker[] = [];
const waiting: ((worker: PooledWorker | null) => void)[] = [];
let started = 0;
let disabled = false;
let everSucceeded = false;

async function acquire(): Promise<PooledWorker | null> {
    if (disabled) {
        return null;
    }

    const free = idle.pop();

    if (free) {
        return free;
    }

    if (started < compressionConcurrency()) {
        const spawned = spawn();

        if (spawned) {
            started++;

            return spawned;
        }

        return null;
    }

    // Every worker is busy. The caller's own scheduling normally prevents this, so rather than
    // queue indefinitely this waits for the next one to come free.
    return new Promise((resolve) => waiting.push(resolve));
}

function release(worker: PooledWorker) {
    const next = waiting.shift();

    if (next) {
        next(worker);

        return;
    }

    idle.push(worker);
}

function discard(worker: PooledWorker) {
    started--;
    void worker.worker.terminate();

    const at = idle.indexOf(worker);

    if (at >= 0) {
        idle.splice(at, 1);
    }
}

function spawn(): PooledWorker | null {
    const entry = workerEntry();

    /* v8 ignore next 3 -- guarded by compressionConcurrency() answering 1 when there is no entry,
       which stops the caller ever asking. Kept because "no entry" and "cannot spawn" are one
       fallback, and this is the one that must not throw. */
    if (!entry) {
        return disable("no worker entry point was found");
    }

    try {
        const pooled: PooledWorker = { worker: new Worker(entry.file, { execArgv: entry.execArgv }) };

        pooled.worker.on("message", (response: ImageWorkerResponse) => pooled.pending?.(response));
        // A worker that dies takes its in-flight image with it; the image is failed, not the run.
        pooled.worker.on("error", (error) => pooled.failed?.(error));
        pooled.worker.on("exit", () => pooled.failed?.(new Error("Image worker exited.")));
        pooled.worker.unref();

        return pooled;
    } catch (e: unknown) {
        return disable(`they could not be started (${(e as Error).message})`);
    }
}

/**
 * Gives up on workers for the rest of the process, saying so once.
 *
 * Once rather than per image: a run over a subtree would otherwise write the same line a thousand
 * times, and the condition is a property of this installation rather than of any one image.
 */
/** The gist of a failure. A worker's error arrives with its stack attached, which a log line is not. */
function firstLine(error: unknown): string {
    return String(error instanceof Error ? error.message : error).split(/\r?\n/)[0];
}

function disable(reason: string): null {
    if (!disabled) {
        disabled = true;
        getLog().info(
            `Image Compression Tool: compressing in this process because ${reason}.`);
    }

    return null;
}

function send(
    worker: PooledWorker,
    buffer: Uint8Array,
    request: ImageCompressionRequest,
    budgetMb: number
): Promise<ImageWorkerResponse> {
    const message: ImageWorkerRequest = { id: ++lastRequestId, buffer, request, budgetMb };

    return new Promise<ImageWorkerResponse>((resolve, reject) => {
        // A thread that took an image and went quiet would otherwise hold the run open with nothing
        // to show for it. Generous, because a large decode legitimately takes minutes; expiring is
        // treated as the worker having failed, and the image is compressed here instead.
        const expiry = setTimeout(
            () => reject(new Error("Image worker did not answer in time.")), WORKER_REPLY_TIMEOUT_MS);

        worker.pending = (response) => {
            clearTimeout(expiry);
            resolve(response);
        };
        worker.failed = (error) => {
            clearTimeout(expiry);
            reject(error);
        };
        // Copied rather than transferred: these bytes were read from the database and the caller
        // still holds them to report the original size, and to fall back on if this goes wrong.
        worker.worker.postMessage(message);
    }).finally(() => {
        worker.pending = undefined;
        worker.failed = undefined;
    });
}

const WORKER_REPLY_TIMEOUT_MS = 5 * 60 * 1000;

let lastRequestId = 0;

interface WorkerEntry {
    file: string;
    execArgv?: string[];
}

/**
 * Where the worker's code is, which differs by how the server was started.
 *
 * Bundled, the worker sits beside the bundle as an entry point of its own. Running from sources it
 * is the TypeScript, started with this process's own loader flags — which works wherever those
 * flags are what makes TypeScript readable, and fails harmlessly wherever they are not.
 *
 * Answered once and remembered, including the answer that there is none: this is a question about
 * an installation, and asking the filesystem it per image would be its own small waste.
 */
function workerEntry(): WorkerEntry | null {
    if (resolvedEntry === undefined) {
        resolvedEntry = [
            { file: join(__dirname, "services", "image_worker.cjs") },
            { file: join(__dirname, "image_worker.cjs") },
            // Running from sources, where a thread can only read TypeScript through the loader that
            // is already reading it here. Inherited rather than named: whatever started this process
            // is by definition able to start one more like it, and guessing at a loader by name
            // would be a guess about how someone chose to run the server.
            { file: join(__dirname, "image_worker.ts"), execArgv: process.execArgv }
        ].find((candidate) => existsSync(candidate.file)) ?? null;
    }

    return resolvedEntry;
}

let resolvedEntry: WorkerEntry | null | undefined;
