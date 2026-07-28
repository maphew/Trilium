import type { Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

import { markAsInternalElectronRequest } from "../services/electron_request.js";

// Force the process-wide desktop-build flag ON so these tests reproduce the
// #10589 setup: a browser hitting the desktop app's HTTP listener. The gating
// must key off the per-request trusted-renderer marker, NOT this flag — that's
// exactly what the assertions below verify.
vi.mock("../services/utils.js", async (orig) => {
    const actual = await orig<typeof import("../services/utils.js")>();
    return { ...actual, isElectron: true, isDev: true, isMac: false, supportsBackgroundMaterial: false };
});

vi.mock("../services/config.js", () => ({ default: { General: {}, Network: {} } }));
vi.mock("../services/port.js", () => ({ default: 8080 }));
vi.mock("../services/app_path.js", () => ({ default: "app" }));
vi.mock("../services/asset_path.js", () => ({ default: "assets" }));
vi.mock("./csrf_protection.js", () => ({ generateCsrfToken: () => "csrf-test-token" }));
vi.mock("../services/open_id.js", () => ({
    default: { isOpenIDEnabled: () => false, getSSOIssuerName: () => "", getSSOIssuerIcon: () => "" }
}));
vi.mock("../services/totp.js", () => ({ default: { isTotpEnabled: () => false } }));

vi.mock("@triliumnext/core", () => ({
    attributes: {},
    BNote: class {},
    getSharedBootstrapItems: () => ({}),
    icon_packs: { getIconPacks: () => [], generateCss: () => "", MIME_TO_EXTENSION_MAPPINGS: {} },
    options: { getOptionMap: () => ({}) },
    password: { isPasswordSet: () => true },
    sql_init: { isDbInitialized: () => true },
    task_states: { generateTaskStateCss: () => "" },
    getLog: () => ({ info: () => {}, error: () => {} })
}));

const { bootstrap } = await import("./index.js");

function makeReq(overrides: { loggedIn?: boolean; internal?: boolean } = {}): Request {
    const req = {
        session: { loggedIn: overrides.loggedIn ?? false },
        query: {},
        headers: {},
        cookies: {}
    } as unknown as Request;
    if (overrides.internal) {
        markAsInternalElectronRequest(req);
    }
    return req;
}

function makeRes(): { res: Response; body: () => any } {
    let captured: any;
    const res = { send: (payload: any) => { captured = payload; } } as unknown as Response;
    return { res, body: () => captured };
}

describe("bootstrap auth gating (desktop build, #10589)", () => {
    it("serves the login screen to an untrusted (browser) request even on a desktop build", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: false, internal: false }), res);

        // A browser hitting the desktop's HTTP listener must get the login screen,
        // not a spurious loggedIn:true (which stranded it with 401s on every API call).
        expect(body().loggedIn).toBe(false);
        expect(body().login).toBeTruthy();
        expect(body().csrfToken).toBeUndefined();
        // ...and it must NOT be told it's the Electron renderer (no `electron` body
        // class, no renderer-only trilium-app:// URLs).
        expect(body().isElectron).toBe(false);
        expect(body().wsBaseUrl).toBeUndefined();
    });

    it("treats a browser as logged in once it has a real session", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: true, internal: false }), res);

        expect(body().loggedIn).toBe(true);
        expect(body().csrfToken).toBe("csrf-test-token");
    });

    it("bypasses the login screen for the trusted desktop renderer with no web session", () => {
        const { res, body } = makeRes();
        bootstrap(makeReq({ loggedIn: false, internal: true }), res);

        // The trilium-app:// renderer is trusted and never gates on a web session.
        expect(body().loggedIn).toBe(true);
        expect(body().csrfToken).toBe("csrf-test-token");
        // It IS the Electron renderer, so it keeps the electron flag and the
        // absolute renderer-only URLs it can't derive from trilium-app://.
        expect(body().isElectron).toBe(true);
        expect(body().wsBaseUrl).toBeTruthy();
    });
});
