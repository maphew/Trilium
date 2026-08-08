import type {
    StandaloneDownloadResult,
    StandaloneRestoreProgress,
    StandaloneRestoreResult
} from "@triliumnext/commons";

import LocalServerWorker from "./local-server-worker?worker";
let localWorker: Worker | null = null;
const pending = new Map();
/** Restores in flight, by id, each with the progress callback that stays on this side. */
const restores = new Map<string, {
    resolve: (result: StandaloneRestoreResult) => void;
    reject: (reason: unknown) => void;
    onProgress?: (progress: StandaloneRestoreProgress) => void;
}>();

const LOCAL_API_PREFIXES = ["/bootstrap", "/api/", "/sync/", "/search/"];

/**
 * Restores the database from a backup, on the worker that owns it.
 *
 * The file goes across as a `File`, which structured cloning passes by reference, so nothing is
 * copied and nothing is read into memory here. It deliberately avoids the request path: that
 * serialises bodies whole and gives up after thirty seconds, neither of which a database survives.
 *
 * Progress is relayed from the worker to `onProgress`, which stays on this side of the boundary.
 */
export function restoreBackup(opts: {
    backup: File;
    passphrase?: string;
    onProgress?: (progress: StandaloneRestoreProgress) => void;
}): Promise<StandaloneRestoreResult> {
    startLocalServerWorker();

    const id = Math.random().toString(36).slice(2);

    return new Promise((resolve, reject) => {
        restores.set(id, { resolve, reject, onProgress: opts.onProgress });
        localWorker!.postMessage({
            type: "RESTORE_BACKUP",
            id,
            backup: opts.backup,
            passphrase: opts.passphrase
        });
    });
}

/**
 * How long the download's frame is kept in the page: comfortably past the service worker's own
 * 30-second wait for the stream to open, after which the response has either been handed to the
 * browser's download manager, which no longer needs the frame, or failed inside it invisibly.
 */
const DOWNLOAD_FRAME_LINGER_MS = 60_000;

/** Well inside the ~30 seconds of eventlessness after which browsers reclaim a service worker. */
const BACKUP_PING_INTERVAL_MS = 10_000;

let backupPing: ReturnType<typeof setInterval> | null = null;

/**
 * Keeps the service worker alive while it streams a backup download, by fetching a no-op URL it
 * answers: a fetch event is what resets the browser's idle clock on it. Runs for exactly as long
 * as the local worker says a stream is running, and never twice at once.
 */
function setBackupPinging(active: boolean): void {
    if (active && !backupPing) {
        backupPing = setInterval(
            () => void fetch("/local-backup-ping").catch(() => undefined),
            BACKUP_PING_INTERVAL_MS
        );
    } else if (!active && backupPing) {
        clearInterval(backupPing);
        backupPing = null;
    }
}

/** How long the chain gets to reach the worker and open the stream before it is called dead. */
const DOWNLOAD_START_TIMEOUT_MS = 45_000;

/** The one download in flight, waiting for the worker to say how the stream ended. */
let pendingDownload: {
    resolve: (result: StandaloneDownloadResult) => void;
    startTimer: ReturnType<typeof setTimeout>;
} | null = null;

/** Carried from {@link downloadDatabase} to the stream relay, so it never rides the URL. */
let pendingDownloadPassphrase: string | undefined;

/**
 * Hands the browser a download of the live database, streamed by the service worker.
 *
 * A navigation rather than a request: the URL is answered by the service worker with a response
 * body it pulls from the local worker chunk by chunk, so the browser's own download manager
 * receives, shows and stores the file, and nothing is staged in the origin's storage first.
 * The worker is started here because the service worker's first act is to ask the page for it.
 * The passphrase, when there is one, travels to the worker on the relayed message, never in the
 * URL a browser would put in its history.
 *
 * The navigation is a hidden iframe rather than an anchor click: anchors with the `download`
 * attribute are not routed through service workers everywhere (Firefox never sends them there),
 * while a frame's navigation always is, and the response's `Content-Disposition` is what makes it
 * a download either way. A failure renders invisibly inside the frame instead of navigating the
 * application away.
 *
 * Resolves when the worker has finished producing the stream, one way or the other — which is as
 * close to "the download finished" as anything on this side of the browser's download manager can
 * see. A chain that dies silently inside the hidden frame (a stale service worker, say) resolves
 * as failed after a timeout rather than never.
 */
export function downloadDatabase(fileName: string, passphrase?: string): Promise<StandaloneDownloadResult> {
    startLocalServerWorker();
    // A newer download supersedes one still unaccounted for, rather than stacking behind it.
    settlePendingDownload({ status: "cancelled" });
    pendingDownloadPassphrase = passphrase;

    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.src = `/local-backup-download?fileName=${encodeURIComponent(fileName)}`;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), DOWNLOAD_FRAME_LINGER_MS);

    return new Promise((resolve) => {
        pendingDownload = {
            resolve,
            startTimer: setTimeout(
                () => settlePendingDownload({ status: "failed", message: "The download did not start." }),
                DOWNLOAD_START_TIMEOUT_MS
            )
        };
    });
}

function settlePendingDownload(result: StandaloneDownloadResult): void {
    if (pendingDownload) {
        clearTimeout(pendingDownload.startTimer);
        pendingDownload.resolve(result);
        pendingDownload = null;
    }
}

export function isLocalApiRequest(url: URL): boolean {
    return LOCAL_API_PREFIXES.some(p => url.pathname.startsWith(p));
}

export async function localFetch(request: Request): Promise<Response> {
    startLocalServerWorker();

    const id = Math.random().toString(36).slice(2);
    const headersObj: Record<string, string> = {};
    for (const [k, v] of request.headers.entries()) headersObj[k] = v;

    const body = (request.method === "GET" || request.method === "HEAD")
        ? null
        : await request.arrayBuffer();

    const response = await new Promise<{ status: number; headers: Record<string, string>; body?: ArrayBuffer }>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        localWorker!.postMessage({
            type: "LOCAL_REQUEST",
            id,
            request: { url: request.url, method: request.method, headers: headersObj, body }
        }, body ? [body] : []);
    });

    const respHeaders = new Headers();
    if (response.headers) {
        for (const [k, v] of Object.entries(response.headers)) respHeaders.set(k, v);
    }
    return new Response(response.body ?? null, { status: response.status || 200, headers: respHeaders });
}

/**
 * Handler for outbound HTTP requests from the worker.
 * When registered, the worker's BridgedRequestProvider sends HTTP_REQUEST
 * messages here instead of using fetch() directly. The handler performs the
 * actual HTTP call (e.g. via a native networking layer) and returns the result.
 */
export type NativeHttpHandler = (request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    responseType?: string;
}) => Promise<{
    status: number;
    headers: Record<string, string>;
    // Exactly one of these will be set:
    // - `data` carries an already-parsed JSON response straight through the
    //   structured-clone postMessage. The worker uses it as-is and skips
    //   JSON.parse, avoiding the ~2× memory blowup that killed large blobs
    //   (parsed object + an intermediate ~60MB string was OOM-ing the iOS
    //   worker). The handler must NOT JSON.stringify the response itself.
    // - `body` is the raw string body — used for non-JSON responses (e.g.
    //   base64 binary returned for `responseType: "arraybuffer"`) and for
    //   error bodies the worker needs to inspect.
    data?: unknown;
    body?: string;
}>;

let nativeHttpHandler: NativeHttpHandler | null = null;

/**
 * Register a handler for outbound HTTP requests from the worker.
 * Must be called before startLocalServerWorker().
 */
export function registerNativeHttpHandler(handler: NativeHttpHandler) {
    nativeHttpHandler = handler;
}

function showFatalErrorDialog(message: string) {
    alert(message);
}

export function startLocalServerWorker() {
    if (localWorker) return localWorker;
    localWorker = new LocalServerWorker();
    localWorker.postMessage({
        type: "INIT",
        queryString: location.search,
        useNativeHttp: nativeHttpHandler != null
    });

    // Handle worker errors during initialization
    localWorker.onerror = (event) => {
        console.error("[LocalBridge] Worker error:", event);
        // Reject all pending requests
        for (const [, resolver] of pending) {
            resolver.reject(new Error(`Worker error: ${event.message}`));
        }
        pending.clear();
    };

    localWorker.onmessage = (event) => {
        const msg = event.data;

        // Restore progress and outcome, which travel on their own channel rather than as a response
        // to a request: the backup that started them never went through one.
        if (msg?.type === "RESTORE_PROGRESS") {
            restores.get(msg.id)?.onProgress?.(msg.progress);
            return;
        }
        if (msg?.type === "RESTORE_RESULT") {
            restores.get(msg.id)?.resolve(msg.result);
            restores.delete(msg.id);
            return;
        }

        // Handle fatal platform crashes (shown as a dialog to the user)
        if (msg?.type === "FATAL_ERROR") {
            console.error("[LocalBridge] Fatal error:", msg.message);
            showFatalErrorDialog(msg.message);
            return;
        }

        // Handle worker error reports
        if (msg?.type === "WORKER_ERROR") {
            console.error("[LocalBridge] Worker reported error:", msg.error);
            // Reject all pending requests with the error
            for (const [, resolver] of pending) {
                resolver.reject(new Error(msg.error?.message || "Unknown worker error"));
            }
            pending.clear();
            return;
        }

        // A backup download is streaming through the service worker, which receives no events of
        // its own while a response body streams: browsers reclaim such "idle" workers within a
        // minute or so, killing the download mid-file. A real fetch is a functional event that
        // resets that clock, so one is sent for as long as the worker says the stream is running.
        // The end of the stream also carries its outcome, which is what the caller of
        // downloadDatabase() has been waiting on.
        if (msg?.type === "BACKUP_STREAM_ACTIVE") {
            setBackupPinging(msg.active === true);
            if (msg.active === true) {
                if (pendingDownload) {
                    clearTimeout(pendingDownload.startTimer);
                }
            } else {
                settlePendingDownload(msg.result ?? { status: "done" });
            }
            return;
        }

        // Handle WebSocket-like messages from the worker (for frontend updates)
        if (msg?.type === "WS_MESSAGE" && msg.message) {
            // Dispatch a custom event that ws.ts listens to in standalone mode
            window.dispatchEvent(new CustomEvent("trilium:ws-message", {
                detail: msg.message
            }));
            return;
        }

        // Relay outbound HTTP requests to the registered native handler
        if (msg?.type === "HTTP_REQUEST" && nativeHttpHandler) {
            const { id, request } = msg;
            nativeHttpHandler(request)
                .then((response) => {
                    localWorker!.postMessage({
                        type: "HTTP_RESPONSE",
                        id,
                        ...response
                    });
                })
                .catch((err) => {
                    localWorker!.postMessage({
                        type: "HTTP_RESPONSE",
                        id,
                        error: err instanceof Error ? err.message : String(err)
                    });
                });
            return;
        }

        if (!msg || msg.type !== "LOCAL_RESPONSE") return;

        const { id, response, error } = msg;
        const resolver = pending.get(id);
        if (!resolver) return;
        pending.delete(id);

        if (error) resolver.reject(new Error(error));
        else resolver.resolve(response);
    };

    return localWorker;
}

export function attachServiceWorkerBridge() {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker) {
        console.warn("[LocalBridge] Service workers not available — skipping bridge setup");
        return;
    }

    navigator.serviceWorker.addEventListener("message", async (event) => {
        const msg = event.data;

        // A backup download's channel: handed straight through to the worker, which streams the
        // database into it. The page is only the relay, because the service worker cannot reach
        // the local worker itself.
        if (msg?.type === "LOCAL_BACKUP_STREAM") {
            const streamPort = event.ports && event.ports[0];
            if (streamPort) {
                startLocalServerWorker();
                localWorker?.postMessage({
                    type: "BACKUP_STREAM",
                    port: streamPort,
                    passphrase: pendingDownloadPassphrase
                }, [ streamPort ]);
                pendingDownloadPassphrase = undefined;
            }
            return;
        }

        if (!msg || msg.type !== "LOCAL_FETCH") return;

        const port = event.ports && event.ports[0];
        if (!port) return;

        try {
            startLocalServerWorker();

            const id = msg.id;
            const req = msg.request;

            const response = await new Promise<{ body?: ArrayBuffer }>((resolve, reject) => {
                pending.set(id, { resolve, reject });
                // Transfer body to worker for efficiency (if present)
                localWorker!.postMessage({
                    type: "LOCAL_REQUEST",
                    id,
                    request: req
                }, req.body ? [req.body] : []);
            });

            port.postMessage({
                type: "LOCAL_FETCH_RESPONSE",
                id,
                response
            }, response.body ? [response.body] : []);
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            port.postMessage({
                type: "LOCAL_FETCH_RESPONSE",
                id: msg.id,
                response: {
                    status: 500,
                    headers: { "content-type": "text/plain; charset=utf-8" },
                    body: new TextEncoder().encode(errorMessage).buffer
                }
            });
        }
    });
}
