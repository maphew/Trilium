import type { StandaloneRestoreProgress, StandaloneRestoreResult } from "@triliumnext/commons";

import { isLeader } from "./leader_election.js";
import LocalServerWorker from "./local-server-worker?worker";
let localWorker: Worker | null = null;
const pending = new Map();
/** Restores in flight, by id, each with the progress callback that stays on this side. */
const restores = new Map<string, {
    resolve: (result: StandaloneRestoreResult) => void;
    reject: (reason: unknown) => void;
    onProgress?: (progress: StandaloneRestoreProgress) => void;
}>();

/**
 * Carries the worker's WebSocket-style messages from the leader tab to the
 * others. Only the leader has a worker, so without this relay a follower would
 * never learn that an entity changed and its froca cache would go stale.
 *
 * A BroadcastChannel never echoes to the sender, so the leader posting here does
 * not re-deliver to itself — it dispatches its own copy directly.
 */
const WS_RELAY_CHANNEL = "trilium-ws-relay";
let wsRelay: BroadcastChannel | null = null;

function getWsRelay(): BroadcastChannel | null {
    if (typeof BroadcastChannel === "undefined") {
        return null;
    }
    if (!wsRelay) {
        wsRelay = new BroadcastChannel(WS_RELAY_CHANNEL);
        wsRelay.onmessage = (event) => dispatchWsMessage(event.data);
    }
    return wsRelay;
}

function dispatchWsMessage(message: unknown): void {
    window.dispatchEvent(new CustomEvent("trilium:ws-message", { detail: message }));
}

/**
 * Tell the service worker that this tab owns the database, so it routes every
 * tab's API traffic here. The service worker is evicted when idle and loses
 * this, so it also probes for the leader on demand — see sw.ts.
 */
export function announceLeadership(): void {
    // Start listening for relayed messages even as leader: if this tab is ever
    // demoted the channel is already live.
    getWsRelay();
    navigator.serviceWorker?.controller?.postMessage({ type: "LEADER_ANNOUNCE" });
}

const LOCAL_API_PREFIXES = ["/bootstrap", "/api/", "/sync/", "/search/"];

/**
 * Restores the database from a backup, on the worker that owns it.
 *
 * The file goes across as a `File`, which structured cloning passes by reference, so nothing is
 * copied and nothing is read into memory here. It deliberately avoids the request path: that
 * serialises bodies whole and gives up after thirty seconds, neither of which a database survives.
 *
 * Progress is relayed from the worker to `onProgress`, which stays on this side of the boundary.
 *
 * Only the leader tab can do this: it is the one holding the database, and the
 * restore bypasses the request path that would otherwise proxy a follower's
 * call through to it. Starting a worker here in a follower would open a second
 * database against the same OPFS pool — the failure leadership exists to
 * prevent — so a follower is refused outright instead.
 */
export function restoreBackup(opts: {
    backup: File;
    passphrase?: string;
    onProgress?: (progress: StandaloneRestoreProgress) => void;
}): Promise<StandaloneRestoreResult> {
    if (!isLeader()) {
        return Promise.reject(new Error(
            "A backup can only be restored from the tab that owns the database. "
            + "Close the other Trilium tabs and try again."
        ));
    }

    const worker = startLocalServerWorker();
    const id = Math.random().toString(36).slice(2);

    return new Promise((resolve, reject) => {
        restores.set(id, { resolve, reject, onProgress: opts.onProgress });
        worker.postMessage({
            type: "RESTORE_BACKUP",
            id,
            backup: opts.backup,
            passphrase: opts.passphrase
        });
    });
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

        // Handle WebSocket-like messages from the worker (for frontend updates)
        if (msg?.type === "WS_MESSAGE" && msg.message) {
            // Dispatch a custom event that ws.ts listens to in standalone mode
            dispatchWsMessage(msg.message);
            // Only this tab has a worker, so pass the update on to the others —
            // that is what makes one tab's edit show up in the rest.
            getWsRelay()?.postMessage(msg.message);
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

    // Followers need the relay too, so they receive the leader's entity changes.
    getWsRelay();

    navigator.serviceWorker.addEventListener("message", async (event) => {
        const msg = event.data;

        // The service worker lost track of the leader and is probing for it.
        if (msg?.type === "WHO_IS_LEADER") {
            const replyPort = event.ports && event.ports[0];
            replyPort?.postMessage({ type: "LEADER_REPLY", isLeader: isLeader() });
            return;
        }

        if (!msg || msg.type !== "LOCAL_FETCH") return;

        const port = event.ports && event.ports[0];
        if (!port) return;

        // Never start a worker just because a request arrived: only the leader
        // may own one. If the service worker guessed wrong, say so and let it
        // find the real leader rather than opening a second, broken database.
        if (!isLeader()) {
            port.postMessage({ type: "NOT_LEADER", id: msg.id });
            return;
        }

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
