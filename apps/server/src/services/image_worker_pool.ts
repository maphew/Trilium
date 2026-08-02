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

import type { ImageWorkerRequest, ImageWorkerResponse, ImageWorkerTrace } from "./image_worker.js";

/**
 * How many images may be compressed at once, or 1 where they cannot be compressed off-thread at
 * all — which is the same answer as "do it here", and is what the caller schedules against.
 *
 * Capped low, and deliberately not scaled to the machine. Decoding a photograph is bound by memory
 * bandwidth at least as much as by processor: past a handful of them the decoders are queueing for
 * the same bus, and adding more buys contention rather than throughput. Measured on a 24-thread
 * machine, letting it run one per core left a 380 KB image taking 10.7 seconds where a 4.9 MB one
 * had taken 2.9 seconds earlier in the same run — and starting a further thread, 24ms of work at
 * the outset, took 2.3 seconds by then.
 *
 * It stays a ceiling rather than a promise: what actually runs at once is whatever the memory budget
 * admits, which on large images is fewer still.
 *
 * `availableParallelism` rather than the raw core count, for the machines below the cap: it follows
 * the affinity the process was given, so a container pinned to two cores is answered as two.
 */
export function compressionConcurrency(): number {
    return workerEntry() ? Math.max(1, Math.min(MAX_WORKERS, availableParallelism())) : 1;
}

/** Where decoding stops going faster for being given more threads; see above for the measurement. */
const MAX_WORKERS = 4;

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

        release(worker);

        return response.outcome ?? null;
    } catch (e: unknown) {
        // Retired rather than released: a thread that failed us may well be dead, and handing it to
        // the next image would post a message nothing is listening for — which looks like the run
        // hanging rather than like one image having failed.
        retire(worker);

        // Nothing has ever come back from a worker here, so this is not one thread having died but
        // this installation being unable to run them — an environment whose loader cannot read the
        // entry point, say. Answered as "there are no workers", which is the truth of it: this image
        // and every one after it is compressed by the caller, exactly as before there were threads.
        if (!everSucceeded) {
            return disable(`they do not work here (${firstLine(e)})`);
        }

        // Workers do work here, and one of them failed on this image. Raised rather than answered
        // with a fallback: doing it on the calling thread instead would stop the application for the
        // length of a decode, and doing that for each of several failing workers is how a run takes
        // the whole application down with it. The image is reported untouched and the run goes on.
        throw e;
    }
}

/**
 * Stops the workers that are not doing anything, so a Trilium that has finished compressing is not
 * still holding them.
 *
 * A thread does not release what it decoded when it goes quiet — its isolate keeps the last image
 * it worked on until something there collects it, and several idle threads each sitting on a
 * decoded photograph is memory the rest of the application would rather have. Terminating them
 * gives it back outright.
 *
 * Only the free ones: a busy worker is not in the pool to be found here, and is left to finish.
 */
export function shutdownImageWorkers() {
    started -= idle.length;
    idle.forEach((pooled) => {
        pooled.stopped = true;
        void pooled.worker.terminate();
    });
    idle.length = 0;
}

/**
 * How long the pool waits, having been given nothing to do, before letting its threads go.
 *
 * Long enough that the images of one run do not pay to start a thread each, short enough that a run
 * which has finished stops costing anything soon after. Nothing schedules a run, so any wait at all
 * is only ever bridging the gap between two images.
 */
const IDLE_SHUTDOWN_MS = 30 * 1000;

let idleTimer: NodeJS.Timeout | undefined;

/** Restarted whenever a worker comes free, so the countdown only ever runs on a quiet pool. */
function scheduleShutdown() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(shutdownImageWorkers, IDLE_SHUTDOWN_MS);
    // Never a reason for this to be what holds the process open.
    idleTimer.unref();
}

interface PooledWorker {
    worker: Worker;
    /** Captured while it is alive: a thread reports its id as -1 once it has gone. */
    threadId: number;
    /** Set when we stopped it ourselves, so its exit is not reported as something going wrong. */
    stopped?: boolean;
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
    // Nothing was waiting for it, so this may well have been the last image of a run.
    scheduleShutdown();
}

/**
 * Takes a worker out of the pool for good, and never puts it back.
 *
 * Whoever was waiting for a free worker is answered with none rather than with this one: no thread
 * is coming to replace it, and a caller told there is none compresses the image itself. Waiting on
 * a thread that no longer exists is the one outcome worse than not having threads at all.
 */
function retire(worker: PooledWorker) {
    started--;
    worker.stopped = true;
    void worker.worker.terminate();
    waiting.shift()?.(null);
}

/**
 * The heap a worker is given: sized to the work, and neither inherited nor unbounded.
 *
 * Both directions matter, which is why this is a fixed figure rather than a floor.
 *
 * Too small and a decode does not fail, it collects — over and over, taking several times longer
 * while looking perfectly healthy. A thread started by Electron's main process inherits a heap set
 * for running an application, not for decoding photographs.
 *
 * Too large is the subtler half. V8 collects lazily against its ceiling, so a thread allowed four
 * gigabytes will happily accumulate several before it bothers, and four such threads can put a
 * machine into paging — where the symptom is not the compression slowing down but everything else
 * stopping, the process that hosts them included.
 *
 * This is what one decode actually needs: the memory budget a single image may claim, and room to
 * work around it. A worker only ever holds one image at a time, so it never needs more.
 */
function workerLimits() {
    return { maxOldGenerationSizeMb: WORKER_HEAP_MB };
}

/** Room for the largest decode the budget will admit, and the working set around it. */
const WORKER_HEAP_MB = 2048;

function spawn(): PooledWorker | null {
    const entry = workerEntry();

    /* v8 ignore next 3 -- guarded by compressionConcurrency() answering 1 when there is no entry,
       which stops the caller ever asking. Kept because "no entry" and "cannot spawn" are one
       fallback, and this is the one that must not throw. */
    if (!entry) {
        return disable("no worker entry point was found");
    }

    try {
        const startedAt = Date.now();
        const limits = workerLimits();
        const worker = new Worker(entry.file, { execArgv: entry.execArgv, resourceLimits: limits });
        // Read now rather than in the handlers: a thread that has exited reports its id as -1, which
        // is the one moment the id is worth having.
        const pooled: PooledWorker = { worker, threadId: worker.threadId };

        // Rare enough to say out loud without asking: a handful of lines per process, and the ones
        // that answer "did a thread ever start, and did it stay up" — which is the whole question
        // when a run stops making progress.
        getLog().info(`Image Compression Tool: starting a worker with a `
            + `${limits.maxOldGenerationSizeMb} MB heap from ${entry.file}`);
        pooled.worker.on("online",
            () => getLog().info(`Image Compression Tool: worker ${pooled.threadId} online in ${Date.now() - startedAt}ms`));

        pooled.worker.on("message", (response: ImageWorkerResponse | ImageWorkerTrace) => {
            // Traces arrive while the image is still being worked on, so they are written straight
            // out rather than waited for; only the answer settles the request.
            if ("trace" in response) {
                getLog().info(`Image Compression Tool: ${response.trace}`);

                return;
            }

            pooled.pending?.(response);
        });
        // A worker that dies takes its in-flight image with it; the image is failed, not the run.
        pooled.worker.on("error", (error) => {
            getLog().info(`Image Compression Tool: worker ${pooled.threadId} errored: ${firstLine(error)}`);
            pooled.failed?.(error);
        });
        pooled.worker.on("exit", (code) => {
            // A thread we stopped ourselves exits with a failure code too, so saying so plainly is
            // the difference between "this is the pool tidying up" and "something died mid-image".
            getLog().info(pooled.stopped
                ? `Image Compression Tool: worker ${pooled.threadId} stopped`
                : `Image Compression Tool: worker ${pooled.threadId} exited unexpectedly with code ${code}`
                    + `${pooled.pending ? " while working on an image" : " while idle"}`);
            pooled.failed?.(new Error(`Image worker exited with code ${code}.`));
        });
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
    const sentAt = Date.now();

    trace(`sending image #${message.id} (${buffer.byteLength} bytes) to worker ${worker.threadId}`
        + ` — ${started} started, ${idle.length} idle, ${waiting.length} waiting`);

    return new Promise<ImageWorkerResponse>((resolve, reject) => {
        // A thread that took an image and went quiet would otherwise hold the run open with nothing
        // to show for it. Generous, because a large decode legitimately takes minutes; expiring is
        // treated as the worker having failed, and the image is compressed here instead.
        const expiry = setTimeout(() => {
            getLog().info(
                `Image Compression Tool: worker ${worker.threadId} did not answer for image `
                + `#${message.id} within ${WORKER_REPLY_TIMEOUT_MS}ms; giving up on it`);
            reject(new Error("Image worker did not answer in time."));
        }, WORKER_REPLY_TIMEOUT_MS);

        worker.pending = (response) => {
            clearTimeout(expiry);
            trace(`worker ${worker.threadId} answered image #${message.id} in ${Date.now() - sentAt}ms`);
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

/**
 * How long a worker is given to answer before it is written off.
 *
 * Deliberately far longer than any decode should take, because the cost of being wrong in this
 * direction is small and the cost of being wrong in the other is not. Two minutes looked generous
 * against images that decode in seconds — until an image near the size ceiling, sharing the memory
 * bus with three others, legitimately took longer than that. Killing it did not save any time: the
 * work fell back onto the thread serving the application, blocked it for twenty seconds, and made
 * the next worker time out in turn.
 *
 * So this is for a thread that has genuinely stopped, not for one that is taking a while. A run
 * meets that at most once per worker, and the images are not waiting on anything else meanwhile.
 */
const WORKER_REPLY_TIMEOUT_MS = 15 * 60 * 1000;

/**
 * Per-image tracing, off unless asked for: a cleanup over a large tree would otherwise write two
 * lines per image into the log a user reads. Set `TRILIUM_IMAGE_WORKER_DEBUG` to follow a run image
 * by image; the worker reads the same variable and traces its own side to stdout.
 */
function trace(message: string) {
    if (process.env.TRILIUM_IMAGE_WORKER_DEBUG) {
        getLog().info(`Image Compression Tool: ${message}`);
    }
}

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
