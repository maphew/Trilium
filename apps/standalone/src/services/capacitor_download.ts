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
 */

/** Where a saved file waits between being written and being handed to the share sheet. */
const DOWNLOAD_DIR = "trilium-downloads";

/** `Directory.Cache` — the Filesystem plugin takes the enum's string value over the bridge. */
const CACHE = "CACHE";

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
        const uri = await writeToCache(fileName, response);
        return await shareFile(uri, fileName);
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

/** Writes the response into the cache directory a chunk at a time and returns the file's URI. */
async function writeToCache(fileName: string, response: Response): Promise<string> {
    const filesystem = getPlugin<FilesystemPlugin>("Filesystem");
    const path = `${DOWNLOAD_DIR}/${fileName}`;

    // What the previous save left behind. The share sheet hands the receiving app a URI it reads
    // on its own schedule, so a shared file can only be removed before the next save, never after
    // `share()` resolves.
    await filesystem
        .rmdir({ path: DOWNLOAD_DIR, directory: CACHE, recursive: true })
        .catch(() => undefined);

    let started = false;
    for await (const chunk of chunksOf(response, CHUNK_BYTES)) {
        const data = toBase64(chunk);
        if (started) {
            await filesystem.appendFile({ path, data, directory: CACHE });
        } else {
            await filesystem.writeFile({ path, data, directory: CACHE, recursive: true });
            started = true;
        }
    }

    if (!started) {
        await filesystem.writeFile({ path, data: "", directory: CACHE, recursive: true });
    }

    const { uri } = await filesystem.getUri({ path, directory: CACHE });
    return uri;
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
 * Reads the body in pieces of `size` bytes, with whatever is left over emitted last.
 *
 * A response with no `body` — happy-dom under the specs, and a WebView old enough to lack
 * streaming — is read whole instead.
 */
async function* chunksOf(response: Response, size: number): AsyncGenerator<Uint8Array> {
    const reader = response.body?.getReader();
    if (!reader) {
        const whole = new Uint8Array(await response.arrayBuffer());
        if (whole.length) {
            yield whole;
        }
        return;
    }

    let pending = new Uint8Array(0);
    for (;;) {
        const { done, value } = await reader.read();
        if (value?.length) {
            const merged = new Uint8Array(pending.length + value.length);
            merged.set(pending, 0);
            merged.set(value, pending.length);
            pending = merged;

            while (pending.length >= size) {
                const chunk = pending.slice(0, size);
                pending = pending.slice(size);
                yield chunk;
            }
        }
        if (done) {
            break;
        }
    }

    if (pending.length) {
        yield pending;
    }
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
