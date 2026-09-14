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
 * Bytes per write. A multiple of 3, so each chunk encodes independently: base64 pads any group
 * narrower than three bytes, and a padded group in the middle of a file decodes to the wrong
 * bytes. 768 KiB keeps the base64 copy of a chunk around a megabyte.
 */
const CHUNK_BYTES = 768 * 1024;

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

    let started = false;
    for await (const chunk of rechunk(chunks, CHUNK_BYTES)) {
        const data = toBase64(chunk);
        if (started) {
            await filesystem.appendFile({ path, data, directory });
        } else {
            await filesystem.writeFile({ path, data, directory, recursive: true });
            started = true;
        }
    }

    if (!started) {
        await filesystem.writeFile({ path, data: "", directory, recursive: true });
    }

    const { uri } = await filesystem.getUri({ path, directory });
    return uri;
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
 * This is what keeps every write but the last a multiple of 3 bytes, so each encodes to base64
 * independently. It belongs here rather than in the callers because a source picks its chunk sizes
 * for its own reasons — a response body by packet, the backup stream by database page — and none
 * of them is obliged to know what the writer needs.
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
 * Base64 for the bridge, which carries binary as a string. Built in steps because
 * `String.fromCharCode` takes its bytes as arguments, and a chunk's worth at once overflows the
 * call stack. The crypto provider's `encodeBase64` is not reachable from here: it lives in the
 * worker, and this runs on the page.
 */
function toBase64(bytes: Uint8Array): string {
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
