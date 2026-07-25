import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";

// Simulate the desktop build with network access off — the only configuration in
// which the middleware actually gates anything.
vi.mock("./utils.js", async (orig) => ({ ...(await orig<typeof import("./utils.js")>()), isElectron: true }));
vi.mock("./config.js", () => ({ default: { Security: { allowLanAccess: false } } }));

import { desktopNetworkAccessGate, isLocalIntegrationPath, isLoopbackHost, shouldBlockDesktopWebRequest } from "./desktop_network_gate.js";

function makeRes() {
    const res = {} as Record<string, unknown>;
    res.status = vi.fn(() => res);
    res.type = vi.fn(() => res);
    res.send = vi.fn(() => res);
    return res as unknown as Response & { status: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn> };
}

// A plain-object stand-in for an external (unmarked) request: the middleware reads the
// path and the Host header via req.get("host").
function makeReq(path: string, host: string | undefined): Request {
    return { path, get: (name: string) => (name.toLowerCase() === "host" ? host : undefined) } as unknown as Request;
}

describe("isLocalIntegrationPath", () => {
    it("matches the MCP and clipper endpoints (and only those)", () => {
        expect(isLocalIntegrationPath("/mcp")).toBe(true);
        expect(isLocalIntegrationPath("/mcp/messages")).toBe(true);
        expect(isLocalIntegrationPath("/api/clipper")).toBe(true);
        expect(isLocalIntegrationPath("/api/clipper/handshake")).toBe(true);
        expect(isLocalIntegrationPath("/etapi")).toBe(true);
        expect(isLocalIntegrationPath("/etapi/notes")).toBe(true);

        expect(isLocalIntegrationPath("/")).toBe(false);
        expect(isLocalIntegrationPath("/bootstrap")).toBe(false);
        expect(isLocalIntegrationPath("/api/tree")).toBe(false);
        expect(isLocalIntegrationPath("/share/abc")).toBe(false);
        // Must not be fooled by a prefix that isn't a path segment boundary.
        expect(isLocalIntegrationPath("/mcp-evil")).toBe(false);
        expect(isLocalIntegrationPath("/api/clipperx")).toBe(false);
    });
});

describe("isLoopbackHost", () => {
    it("accepts loopback host headers (with or without port / brackets) and rejects the rest", () => {
        for (const host of ["localhost", "localhost:37742", "127.0.0.1", "127.0.0.1:37742", "127.5.5.5", "[::1]", "[::1]:37742"]) {
            expect(isLoopbackHost(host)).toBe(true);
        }
        for (const host of [undefined, "", "evil.example.com", "evil.example.com:37742", "192.168.1.9:37742", "localhost.evil.com"]) {
            expect(isLoopbackHost(host)).toBe(false);
        }
    });
});

describe("shouldBlockDesktopWebRequest", () => {
    const base = { isElectron: true, allowLanAccess: false, isInternal: false, path: "/", host: "localhost:37742" };

    it("never blocks on the server build", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, isElectron: false })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, isElectron: false, path: "/share/x" })).toBe(false);
    });

    it("serves everything once network access is enabled", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, allowLanAccess: true })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, allowLanAccess: true, path: "/share/x" })).toBe(false);
    });

    it("never blocks the trusted renderer (internal trilium-app:// request)", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, isInternal: true })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, isInternal: true, path: "/share/x" })).toBe(false);
    });

    it("blocks the web app and share for external requests when network access is off", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/bootstrap" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/api/tree" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/share/abc" })).toBe(true);
    });

    it("still allows the localhost integrations (MCP, clipper, ETAPI) from a loopback host", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/mcp" })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/api/clipper/handshake" })).toBe(false);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/etapi/notes" })).toBe(false);
    });

    it("blocks the localhost integrations when the Host header is non-loopback (DNS rebinding)", () => {
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/api/clipper/handshake", host: "evil.example.com" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/etapi/notes", host: "evil.example.com:37742" })).toBe(true);
        expect(shouldBlockDesktopWebRequest({ ...base, path: "/mcp", host: undefined })).toBe(true);
    });
});

describe("desktopNetworkAccessGate (desktop build, network access off)", () => {
    it("responds 403 to an external web request and does not continue", () => {
        const res = makeRes();
        const next = vi.fn() as unknown as NextFunction;
        // A plain object carries no internal-electron marker → treated as external/TCP.
        desktopNetworkAccessGate(makeReq("/", "localhost:37742"), res, next);

        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it("passes localhost-integration requests through to the next handler", () => {
        const res = makeRes();
        const next = vi.fn() as unknown as NextFunction;
        desktopNetworkAccessGate(makeReq("/api/clipper/handshake", "localhost:37742"), res, next);

        expect(next).toHaveBeenCalled();
        expect(res.status).not.toHaveBeenCalled();
    });
});
