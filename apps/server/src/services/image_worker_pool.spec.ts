import type { ImageCompressionRequest } from "@triliumnext/core/src/services/image_provider.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The pool's failure semantics, with the processes themselves faked out: what separates "this
 * installation cannot run workers, stop trying" from "this one image killed its worker, fail it
 * alone". Getting that line wrong in the second direction hands the poison image to the thread
 * serving the application — the freeze the pool exists to prevent.
 */
const h = vi.hoisted(() => {
    type Handler = (...args: unknown[]) => void;

    class FakeChild {
        pid: number;
        sent: unknown[] = [];
        killed = false;
        channel = { unref() {} };
        private handlers = new Map<string, Handler[]>();

        constructor(pid: number) {
            this.pid = pid;
        }

        on(event: string, handler: Handler) {
            this.handlers.set(event, [ ...(this.handlers.get(event) ?? []), handler ]);

            return this;
        }

        emit(event: string, ...args: unknown[]) {
            (this.handlers.get(event) ?? []).forEach((handler) => handler(...args));
        }

        send(message: unknown, callback?: (error: Error | null) => void) {
            this.sent.push(message);
            callback?.(null);

            return true;
        }

        kill() {
            this.killed = true;

            return true;
        }

        unref() {}
    }

    const forked: InstanceType<typeof FakeChild>[] = [];
    const forkOptions: { serialization?: string; execArgv?: string[] }[] = [];

    return {
        forked,
        forkOptions,
        fork(file: string, options: { serialization?: string; execArgv?: string[] }) {
            void file;
            forkOptions.push(options);

            const child = new FakeChild(4000 + forked.length);

            forked.push(child);

            return child;
        }
    };
});

vi.mock("node:child_process", () => ({ fork: h.fork }));
vi.mock("@triliumnext/core", () => ({ getLog: () => ({ info() {}, error() {} }) }));

const REQUEST: ImageCompressionRequest = {
    resize: true,
    maxWidthHeight: 800,
    jpegHandling: "compress",
    pngHandling: "optimize",
    quality: 75,
    conversionQuality: 85
};

const BYTES = new Uint8Array([ 1, 2, 3 ]);

/** Lets the pool's ready-gate promise chain and send callbacks run to completion. */
async function flush() {
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
    vi.resetModules();
    h.forked.length = 0;
    h.forkOptions.length = 0;
});

describe("worker pool failure semantics", () => {
    it("fails a poison image alone once any worker has announced, and replaces its worker", async () => {
        const pool = await import("./image_worker_pool.js");
        const first = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();

        const child = h.forked[0];

        expect(child).toBeDefined();
        // The bytes only survive the channel under structured clone; JSON would mangle them.
        expect(h.forkOptions[0]).toMatchObject({ serialization: "advanced" });

        // The image goes out only once the child has provably attached its listener.
        expect(child.sent).toHaveLength(0);
        child.emit("message", { trace: "worker 4000: loaded and listening" });
        await flush();
        expect(child.sent).toHaveLength(1);

        // The decode takes the worker down mid-image: the image fails, the pool does not.
        child.emit("exit", 1, null);
        await expect(first).rejects.toThrow("exited with code 1");
        expect(child.killed).toBe(true);

        const second = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();

        const replacement = h.forked[1];

        expect(replacement).toBeDefined();
        replacement.emit("message", { trace: "worker 4001: loaded and listening" });
        await flush();
        replacement.emit("message", { id: (replacement.sent[0] as { id: number }).id, outcome: { compressed: false, reason: "no-gain" }, logs: [] });
        await expect(second).resolves.toMatchObject({ compressed: false, reason: "no-gain" });
    });

    it("gives up on workers for good only when none has ever spoken", async () => {
        const pool = await import("./image_worker_pool.js");
        const first = pool.compressInWorker(BYTES, REQUEST, 1024);

        await flush();
        // Dead before its announce: nothing has proven workers can run here at all.
        h.forked[0].emit("exit", 127, null);

        await expect(first).resolves.toBeNull();

        // Disabled: the next image is answered without so much as a spawn attempt.
        await expect(pool.compressInWorker(BYTES, REQUEST, 1024)).resolves.toBeNull();
        expect(h.forked).toHaveLength(1);
    });
});
