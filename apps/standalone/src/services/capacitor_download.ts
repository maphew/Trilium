import type { StandaloneSaveResult } from "@triliumnext/commons";

/**
 * Saving a download inside the Capacitor shell, which has no download manager of its own.
 *
 * A WebView answers a navigation that resolves to `Content-Disposition: attachment` by calling
 * `WebView.setDownloadListener`, and neither Capacitor nor `MainActivity` registers one — the
 * response is dropped without a trace. Re-requesting the URL natively would not help either: the
 * bytes come from the SQLite worker inside the page, so nothing outside the WebView can fetch
 * them. The page therefore does the whole job: fetch (still routed to the worker by the service
 * worker on Android and by the iOS interceptors on `capacitor://`), write to the app's cache
 * directory, hand the file to the system share sheet.
 *
 * A database backup takes the same last step through {@link saveChunksToDevice}, reading its bytes
 * straight off the local worker rather than out of a response.
 */

/** Where a kind of saved file is written, and what happens to what is already there. */
export interface SaveTarget {
    /** `Directory`'s value, which the Filesystem plugin takes as a string over the bridge. */
    directory: "CACHE" | "DOCUMENTS";
    /** The folder inside it, so saved files do not litter the directory's root. */
    folder: string;
    /**
     * Whether the folder is emptied before the write. True for scratch space the share sheet reads
     * from once; false where the folder holds the user's own files.
     */
    sweep: boolean;
}

/**
 * A download: transient. The share sheet is what the user does with it, and the copy left behind is
 * rubbish, cleared before the next one. It cannot be cleared *after* the sheet closes, because the
 * receiving app reads the shared URI on its own schedule.
 */
export const DOWNLOAD_TARGET: SaveTarget = {
    directory: "CACHE",
    folder: "trilium-downloads",
    sweep: true
};

/**
 * A backup: the opposite. It has to survive the share sheet being dismissed and the phone running
 * low on space, neither of which a cache directory does, and sweeping the folder would destroy the
 * previous backup. Same-day repeats overwrite, which is what the date-based default name means.
 */
export const BACKUP_TARGET: SaveTarget = {
    directory: "DOCUMENTS",
    folder: "Trilium",
    sweep: false
};

/**
 * Bytes per write.
 *
 * A multiple of 3, so each chunk encodes independently: base64 pads any group narrower than three
 * bytes, and a padded group in the middle of a file decodes to the wrong bytes. Every `3n` KiB
 * satisfies that.
 *
 * The size is a trade against the bridge, which is what a write costs: the chunk crosses as base64
 * inside a JSON string, so the bytes are walked about five times between here and the file, and
 * the chunk, its base64 copy and both sides of the marshalled string are live at once — budget
 * roughly four times the chunk. Fewer, larger writes buy fewer round trips at that price.
 */
const DEFAULT_CHUNK_BYTES = 3 * 1024 * 1024;

let chunkBytes = DEFAULT_CHUNK_BYTES;

/**
 * Test-only: shrinks the write size, so a spec can cross a chunk boundary without pushing the
 * production size through base64 and back on every run.
 */
export function setChunkBytesForTests(bytes = DEFAULT_CHUNK_BYTES) {
    chunkBytes = bytes;
}

/** Both platforms' Share plugin rejects with exactly this when the user dismisses the sheet. */
const SHARE_CANCELLED = "Share canceled";

export async function saveUrlToDevice(url: string): Promise<StandaloneSaveResult> {
    let fileName = "download";
    try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) {
            return { status: "failed", message: `The download answered ${response.status}.` };
        }

        fileName = fileNameOf(response, url);
        return await saveChunksToDevice(fileName, bodyChunks(response), DOWNLOAD_TARGET);
    } catch (e) {
        return {
            status: "failed",
            fileName,
            message: e instanceof Error ? e.message : String(e)
        };
    }
}

/**
 * Writes a stream of bytes into `target` and offers the file to the share sheet.
 *
 * The file is complete before the sheet opens, and `location` is set as soon as it is on disk, so
 * a `cancelled` result still names a file that exists — which is what makes this usable for a
 * backup, where dismissing the sheet must not mean the backup never happened.
 */
export async function saveChunksToDevice(
    fileName: string,
    chunks: AsyncIterable<Uint8Array>,
    target: SaveTarget
): Promise<StandaloneSaveResult> {
    try {
        const uri = await writeChunks(fileName, chunks, target);
        return { ...await shareFile(uri, fileName), location: displayPath(uri) };
    } catch (e) {
        return {
            status: "failed",
            fileName,
            message: e instanceof Error ? e.message : String(e)
        };
    }
}

interface WriteOptions {
    path: string;
    data: string;
    directory: string;
    recursive?: boolean;
}

interface FilesystemPlugin {
    writeFile(opts: WriteOptions): Promise<{ uri: string }>;
    appendFile(opts: WriteOptions): Promise<void>;
    getUri(opts: { path: string; directory: string }): Promise<{ uri: string }>;
    rmdir(opts: { path: string; directory: string; recursive: boolean }): Promise<void>;
}

interface SharePlugin {
    share(opts: { title?: string; files: string[] }): Promise<{ activityType?: string }>;
}

/**
 * A native plugin, reached through the global Capacitor bridge rather than a `@capacitor/*`
 * import — bare module specifiers do not resolve in the browser's native ES module loader.
 * `Capacitor.Plugins` holds only what the injected runtime registered (`CapacitorHttp` and the
 * rest of core), so everything else is registered here, on the same bridge, from the
 * `PluginHeaders` the native side published.
 */
function getPlugin<T>(name: string): T {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (window as any).Capacitor;
    const plugin = cap?.Plugins?.[name] ?? cap?.registerPlugin?.(name);

    if (!plugin) {
        throw new Error(`The ${name} plugin is not available`);
    }

    return plugin as T;
}

/** Writes the chunks into `target` one at a time and returns the finished file's URI. */
async function writeChunks(
    fileName: string,
    chunks: AsyncIterable<Uint8Array>,
    { directory, folder, sweep }: SaveTarget
): Promise<string> {
    const filesystem = getPlugin<FilesystemPlugin>("Filesystem");
    const path = `${folder}/${fileName}`;

    if (sweep) {
        await filesystem
            .rmdir({ path: folder, directory, recursive: true })
            .catch(() => undefined);
    }

    const sink = takeFileSink();
    if (sink) {
        try {
            // The plugin creates the file first, so its own directory mapping — not a guess at
            // it — is what turns `path` into the absolute path the sink writes to.
            await filesystem.writeFile({ path, data: "", directory, recursive: true });
            const { uri } = await filesystem.getUri({ path, directory });

            await writeThroughSink(sink, displayPath(uri), chunks);
            return uri;
        } finally {
            releaseFileSink();
        }
    }

    let started = false;
    // One call is kept in flight while the next chunk encodes, so the encode's cost hides behind
    // the bridge's. Never two: appends are ordered only because each is issued after the previous
    // one resolves.
    let pending: Promise<unknown> | null = null;

    const awaitPending = async () => {
        if (pending) {
            await pending;
            pending = null;
        }
    };

    await withoutCallLogging(async () => {
        for await (const chunk of rechunk(chunks, chunkBytes)) {
            const data = toBase64(chunk);

            await awaitPending();
            pending = started
                ? filesystem.appendFile({ path, data, directory })
                : filesystem.writeFile({ path, data, directory, recursive: true });
            started = true;
        }
        await awaitPending();
    });

    if (!started) {
        await filesystem.writeFile({ path, data: "", directory, recursive: true });
    }

    const { uri } = await filesystem.getUri({ path, directory });
    return uri;
}

/**
 * `window.triliumFileSink`: the binary write channel `TriliumFileSink.java` injects on Android.
 *
 * A `WebMessageListener` object, so it carries raw `ArrayBuffer`s — where the plugin bridge wraps
 * every chunk in base64 inside a JSON string that the native side re-parses whole, capping writes
 * around 13 MB/s. Absent on iOS, on WebViews too old for ArrayBuffer messages, and on the web.
 */
interface NativeFileSink {
    postMessage(message: string | ArrayBuffer): void;
    addEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
    removeEventListener(type: "message", listener: (event: { data: unknown }) => void): void;
}

/** Whether a transfer already owns the sink, which holds one open file and no more. */
let sinkBusy = false;

function takeFileSink(): NativeFileSink | null {
    const sink = (window as { triliumFileSink?: NativeFileSink }).triliumFileSink;
    if (!sink || typeof sink.postMessage !== "function" || sinkBusy) {
        return null;
    }
    sinkBusy = true;
    return sink;
}

function releaseFileSink(): void {
    sinkBusy = false;
}

/** How long one acknowledged step may take before the transfer is declared dead. */
const SINK_ACK_TIMEOUT_MS = 30_000;

/**
 * Streams the chunks down the sink: `open`, one ArrayBuffer per chunk, `close`, each step
 * acknowledged before the next is sent — which is all the flow control there is, and enough,
 * because the native side answers only after its write lands.
 */
async function writeThroughSink(
    sink: NativeFileSink,
    filePath: string,
    chunks: AsyncIterable<Uint8Array>
): Promise<void> {
    // Replies arrive in send order, so the head of this queue is always the awaited step.
    const waiting: ((reply: string) => void)[] = [];
    const listener = (event: { data: unknown }) => waiting.shift()?.(String(event.data));
    sink.addEventListener("message", listener);

    const send = (message: string | ArrayBuffer, expected: string) =>
        new Promise<void>((resolve, reject) => {
            const timer = setTimeout(
                () => reject(new Error("The file sink stopped answering.")),
                SINK_ACK_TIMEOUT_MS
            );
            waiting.push((reply) => {
                clearTimeout(timer);
                if (reply === expected) {
                    resolve();
                } else {
                    reject(new Error(reply.startsWith("error:")
                        ? reply.slice("error:".length)
                        : `Unexpected sink reply: ${reply}`));
                }
            });
            sink.postMessage(message);
        });

    try {
        await send(JSON.stringify({ type: "open", path: filePath }), "opened");
        for await (const chunk of rechunk(chunks, chunkBytes)) {
            await send(exactBuffer(chunk), "written");
        }
        await send(JSON.stringify({ type: "close" }), "closed");
    } finally {
        sink.removeEventListener("message", listener);
    }
}

/** The chunk's bytes as exactly one ArrayBuffer, which is what the message channel carries. */
function exactBuffer(chunk: Uint8Array): ArrayBuffer {
    const { buffer, byteOffset, byteLength } = chunk;
    if (byteOffset === 0 && byteLength === buffer.byteLength && buffer instanceof ArrayBuffer) {
        return buffer;
    }
    return buffer.slice(byteOffset, byteOffset + byteLength) as ArrayBuffer;
}

/**
 * Runs `write` with Capacitor's per-call console logging turned off.
 *
 * A debuggable build logs every plugin call by handing the call object to `console.dir`, and a
 * write's call object holds the whole base64 chunk — megabytes through the console pipeline per
 * chunk, next to the write itself. The flag is read at call time, so this suppresses only those
 * call traces; the application's own console output reaches logcat by a different route.
 */
async function withoutCallLogging<T>(write: () => Promise<T>): Promise<T> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (window as any).Capacitor;
    const wasEnabled = cap?.isLoggingEnabled;

    if (cap) {
        cap.isLoggingEnabled = false;
    }
    try {
        return await write();
    } finally {
        if (cap) {
            cap.isLoggingEnabled = wasEnabled;
        }
    }
}

/**
 * The file's URI as somewhere a person can be told to look. `getUri` answers with a `file://` URL,
 * percent-encoded, which is a path with two layers of machinery on top of it.
 */
function displayPath(uri: string): string {
    const path = uri.replace(/^file:\/\//, "");
    try {
        return decodeURIComponent(path);
    } catch {
        return path;
    }
}

async function shareFile(uri: string, fileName: string): Promise<StandaloneSaveResult> {
    try {
        await getPlugin<SharePlugin>("Share").share({ title: fileName, files: [uri] });
        return { status: "saved", fileName };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        if (message.includes(SHARE_CANCELLED)) {
            return { status: "cancelled", fileName };
        }
        return { status: "failed", fileName, message };
    }
}

/**
 * Reads the body as it arrives.
 *
 * A response with no `body` — happy-dom under the specs, and a WebView old enough to lack
 * streaming — is read whole instead.
 */
async function* bodyChunks(response: Response): AsyncGenerator<Uint8Array> {
    const reader = response.body?.getReader();
    if (!reader) {
        const whole = new Uint8Array(await response.arrayBuffer());
        if (whole.length) {
            yield whole;
        }
        return;
    }

    for (;;) {
        const { done, value } = await reader.read();
        if (value?.length) {
            yield value;
        }
        if (done) {
            return;
        }
    }
}

/**
 * Regroups a stream into pieces of `size` bytes, with whatever is left over emitted last.
 *
 * This is what keeps every plugin-bridge write but the last a multiple of 3 bytes, so each encodes
 * to base64 independently, and what bounds a sink message to one chunk. It belongs here rather
 * than in the callers because a source picks its chunk sizes for its own reasons — a response body
 * by packet, the backup stream by database page — and none of them is obliged to know what the
 * writer needs.
 */
async function* rechunk(chunks: AsyncIterable<Uint8Array>, size: number): AsyncGenerator<Uint8Array> {
    // Held as they arrive and joined only when a whole chunk is due. Merging each arrival into one
    // growing buffer instead would copy everything received so far on every arrival, which a
    // database backup pays for by the gigabyte.
    const parts: Uint8Array[] = [];
    let pending = 0;

    for await (const value of chunks) {
        if (!value.length) {
            continue;
        }
        parts.push(value);
        pending += value.length;

        while (pending >= size) {
            yield take(parts, size);
            pending -= size;
        }
    }

    if (pending) {
        yield take(parts, pending);
    }
}

/** Removes the first `size` bytes of `parts`, leaving the tail of a part it splits at the front. */
function take(parts: Uint8Array[], size: number): Uint8Array {
    const out = new Uint8Array(size);
    let filled = 0;

    while (filled < size) {
        const part = parts[0];
        if (!part) {
            return out.subarray(0, filled);
        }

        const taken = Math.min(part.length, size - filled);
        out.set(part.subarray(0, taken), filled);
        filled += taken;

        if (taken === part.length) {
            parts.shift();
        } else {
            parts[0] = part.subarray(taken);
        }
    }

    return out;
}

/**
 * Base64 for the bridge, which carries binary as a string.
 *
 * `Uint8Array.prototype.toBase64` (Chrome 140+, so every current WebView) encodes in native code
 * with the same standard alphabet and padding `btoa` produces. The fallback is built in steps
 * because `String.fromCharCode` takes its bytes as arguments, and a chunk's worth at once
 * overflows the call stack. The crypto provider's `encodeBase64` is not reachable from here: it
 * lives in the worker, and this runs on the page.
 */
function toBase64(bytes: Uint8Array): string {
    const native = (bytes as Uint8Array & { toBase64?: () => string }).toBase64;
    if (typeof native === "function") {
        return native.call(bytes);
    }

    const STEP = 8192;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += STEP) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + STEP));
    }
    return btoa(binary);
}

/**
 * The name the response asks for, preferring RFC 5987's `filename*` over the plain parameter.
 * Trilium URI-encodes both (see `getContentDisposition`), so both are decoded the same way.
 */
export function fileNameOf(response: Response, url: string): string {
    const disposition = response.headers.get("content-disposition") ?? "";
    const extended = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
    const plain = /filename="([^"]*)"/i.exec(disposition);

    return sanitize(decode(extended?.[1] ?? plain?.[1]))
        || sanitize(decode(new URL(url, location.href).pathname.split("/").pop()))
        || "download";
}

function decode(value: string | undefined): string {
    if (!value) {
        return "";
    }
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

/** Keeps the name a name: one path segment, no leading dot, nothing a filesystem chokes on. */
function sanitize(name: string): string {
    // eslint-disable-next-line no-control-regex
    return name.replace(/[/\\:*?"<>|\x00-\x1f]/g, "-").replace(/^\.+/, "").trim();
}
