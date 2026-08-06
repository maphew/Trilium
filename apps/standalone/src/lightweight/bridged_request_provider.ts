import type { ExecOpts, FetchedResource, FetchResourceOpts, RequestProvider } from "@triliumnext/core";
import { validateFetchableUrl } from "@triliumnext/core/src/services/request.js";

/**
 * A RequestProvider that delegates HTTP requests to the main thread via postMessage.
 *
 * This is used when the host environment (e.g. a Capacitor mobile app) provides
 * a native HTTP layer that bypasses browser CORS and cookie restrictions.
 * The worker sends HTTP_REQUEST messages and waits for HTTP_RESPONSE replies.
 */
export default class BridgedRequestProvider implements RequestProvider {

    private pending = new Map<string, {
        resolve: (value: unknown) => void;
        reject: (reason: Error) => void;
    }>();
    private nextId = 0;

    constructor() {
        self.addEventListener("message", (event: MessageEvent) => {
            const msg = event.data;
            if (!msg || msg.type !== "HTTP_RESPONSE") return;

            const entry = this.pending.get(msg.id);
            if (!entry) return;
            this.pending.delete(msg.id);

            if (msg.error) {
                entry.reject(new Error(msg.error));
            } else {
                entry.resolve(msg);
            }
        });
    }

    async exec<T>(opts: ExecOpts): Promise<T> {
        const paging = opts.paging || {
            pageCount: 1,
            pageIndex: 0,
            requestId: "n/a"
        };

        const headers: Record<string, string> = {
            "Content-Type": paging.pageCount === 1 ? "application/json" : "text/plain",
            "pageCount": String(paging.pageCount),
            "pageIndex": String(paging.pageIndex),
            "requestId": paging.requestId
        };

        if (opts.cookieJar?.header) {
            headers["Cookie"] = opts.cookieJar.header;
        }

        if (opts.auth?.password) {
            headers["trilium-cred"] = btoa(`dummy:${opts.auth.password}`);
        }

        let body: string | undefined;
        if (opts.body) {
            body = typeof opts.body === "object" ? JSON.stringify(opts.body) : opts.body;
        }

        const id = String(this.nextId++);
        const msg = await new Promise<any>((resolve, reject) => {
            const timeoutId = opts.timeout
                ? setTimeout(() => {
                    this.pending.delete(id);
                    reject(new Error(`${opts.method} ${opts.url} failed, error: timeout after ${opts.timeout}ms`));
                }, opts.timeout)
                : undefined;

            // Wrap resolve/reject to clear timeout
            const originalResolve = resolve;
            const originalReject = reject;
            this.pending.set(id, {
                resolve: (value) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    originalResolve(value);
                },
                reject: (reason) => {
                    if (timeoutId) clearTimeout(timeoutId);
                    originalReject(reason);
                }
            });

            (self as unknown as Worker).postMessage({
                type: "HTTP_REQUEST",
                id,
                request: {
                    method: opts.method,
                    url: opts.url,
                    headers,
                    body
                }
            });
        });

        // Capture cookies from the response for the sync cookie jar
        if (opts.cookieJar && msg.headers?.["set-cookie"]) {
            opts.cookieJar.header = msg.headers["set-cookie"];
        }

        if ([200, 201, 204].includes(msg.status)) {
            // Fast path: main thread sent the already-parsed JSON object via
            // structured clone. Use it directly — no second JSON.parse, no
            // intermediate string allocation. Critical for large blob batches
            // on memory-constrained clients (iOS Capacitor WebView worker).
            if (msg.data !== undefined) {
                return msg.data;
            }
            const text = msg.body || "";
            return text.trim() ? JSON.parse(text) : null;
        }

        let errorMessage: string;
        if (msg.data && typeof msg.data === "object") {
            errorMessage = (msg.data as { message?: string }).message ?? "";
        } else {
            try {
                const json = JSON.parse(msg.body || "");
                errorMessage = json?.message || "";
            } catch {
                errorMessage = (msg.body || "").substring(0, 100);
            }
        }
        throw new Error(`${msg.status} ${opts.method} ${opts.url}: ${errorMessage}`);
    }

    async getImage(imageUrl: string): Promise<ArrayBuffer> {
        const id = String(this.nextId++);
        const msg = await new Promise<any>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });

            (self as unknown as Worker).postMessage({
                type: "HTTP_REQUEST",
                id,
                request: {
                    method: "GET",
                    url: imageUrl,
                    headers: {},
                    responseType: "arraybuffer"
                }
            });
        });

        if (msg.status < 200 || msg.status >= 300) {
            throw new Error(`${msg.status} GET ${imageUrl} failed`);
        }

        // The main thread should send back a base64-encoded body for binary responses
        const binary = atob(msg.body);
        const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
        return bytes.buffer;
    }

    /**
     * Fetches a third-party resource over the native transport, which is the whole reason this
     * provider exists: the cross-origin hop happens outside the WebView, so a page that sends no
     * CORS headers — which is nearly every page worth previewing — can still be read.
     *
     * Two things the server's implementation has are missing here, and neither can be had:
     *
     * - The body arrives whole, so `maxBytes` is enforced on what came back rather than on what is
     *   still coming. A native transport hands over a complete response; there is no stream to
     *   abandon partway. The ceiling still holds, it is just paid for before it is checked.
     * - Nothing resolves the hostname, so the private-address check cannot be made and DNS
     *   rebinding has no meaning here anyway. What is left is {@link validateFetchableUrl}, and
     *   the reason that is enough: this transport runs on the user's own device, reaching the
     *   network that user is already on, at the address that user just pasted. The server's rule —
     *   that note content is not entitled to the network its host can see — is about a host reached
     *   by people who are not its owner, which is not this.
     */
    async fetchResource(resourceUrl: string, opts: FetchResourceOpts): Promise<FetchedResource> {
        const validated = validateFetchableUrl(resourceUrl).toString();
        const id = String(this.nextId++);

        const msg = await new Promise<any>((resolve, reject) => {
            this.pending.set(id, { resolve, reject });

            (self as unknown as Worker).postMessage({
                type: "HTTP_REQUEST",
                id,
                request: {
                    method: "GET",
                    url: validated,
                    headers: opts.headers ?? {},
                    responseType: "arraybuffer"
                }
            });
        });

        const binary = atob(msg.body ?? "");

        if (binary.length > opts.maxBytes) {
            throw new Error(`Response exceeds the ${opts.maxBytes} byte limit`);
        }

        return {
            status: msg.status,
            ok: msg.status >= 200 && msg.status < 300,
            contentType: (msg.headers?.["content-type"] ?? "").split(";")[0].trim().toLowerCase(),
            bytes: Uint8Array.from(binary, (c) => c.charCodeAt(0))
        };
    }
}
