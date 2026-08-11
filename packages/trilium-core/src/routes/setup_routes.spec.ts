import { describe, expect, it } from "vitest";

import { buildSharedApiRoutes } from "./index.js";

/**
 * How the setup routes are registered, rather than what they do.
 *
 * One property is worth pinning down here, because nothing else catches it and the failure it
 * causes is remote from its cause: a handler that erases the knowledge base must not be wrapped in
 * a transaction. `asyncRoute` opens one in the browser and not on the server, so a route that
 * erases goes on working on the desktop and dies on the standalone build with "cannot rollback - no
 * transaction is active" — the transaction belonged to a connection the erasure closed, and the one
 * opened in its place has nothing to roll back.
 */
describe("how the setup routes are registered", () => {
    /** Every route that erases the knowledge base before it creates one in its place. */
    const ERASING_ROUTES = [
        "/api/setup/new-document",
        "/api/setup/sync-from-server",
        "/api/setup/existing/delete",
        // Not an erasure, but it reopens the database it was asked to leave alone, which closes the
        // connection just the same.
        "/api/setup/existing/keep"
    ];

    it("keeps every route that closes the database out of a transaction", () => {
        const registered = captureRoutes();

        for (const path of ERASING_ROUTES) {
            expect(registered.get(path), `${path} is not registered at all`).toBe("asyncRouteWithoutTransaction");
        }
    });
});

/**
 * Runs the route builder against a context that records which builder each path went through, and
 * does nothing else. Enough for the question above, which is about registration rather than about
 * anything a handler does.
 */
function captureRoutes(): Map<string, string> {
    const registered = new Map<string, string>();
    const noop = () => {};
    const record = (builder: string) => (_method: string, path: string) => {
        registered.set(path, builder);
    };

    buildSharedApiRoutes({
        route: record("route"),
        asyncRoute: record("asyncRoute"),
        asyncRouteWithoutTransaction: record("asyncRouteWithoutTransaction"),
        apiRoute: record("apiRoute"),
        asyncApiRoute: record("asyncApiRoute"),
        apiResultHandler: noop,
        checkApiAuth: noop,
        checkApiAuthOrElectron: noop,
        checkAppNotInitialized: noop,
        checkSetupAuth: noop,
        checkCredentials: noop,
        loginRateLimiter: noop,
        uploadMiddlewareWithErrorHandling: noop,
        importMiddlewareWithErrorHandling: noop,
        csrfMiddleware: noop
    });

    return registered;
}
