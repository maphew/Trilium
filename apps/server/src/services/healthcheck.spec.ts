import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeHealth } from "./healthcheck.js";

const LOCALHOST = "127.0.0.1";

/**
 * Docker reads two things from the probe: the exit code it resolves, and whatever it prints
 * into the container log. Both are pinned here, against real sockets rather than a mocked
 * `http`, so that socket-level behaviour such as the request timeout is exercised for real.
 */
describe("the docker healthcheck probe", () => {
    let logged: string[];

    beforeEach(() => {
        logged = [];
        vi.spyOn(console, "log").mockImplementation((message) => {
            logged.push(String(message));
        });
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await stopEverything();
    });

    it("reports healthy on 200, having asked for the health-check resource", async () => {
        const seen: { method?: string; url?: string }[] = [];
        const port = await startServer((req, res) => {
            seen.push({ method: req.method, url: req.url });
            res.statusCode = 200;
            res.end('{"status":"ok"}');
        });

        expect(await probeHealth({ https: false, port, host: LOCALHOST })).toBe(0);
        expect(seen).toEqual([ { method: "GET", url: "/api/health-check" } ]);
        expect(logged).toEqual([ "STATUS: 200" ]);
    });

    it("reports unhealthy on any status other than 200", async () => {
        let status = 500;
        const port = await startServer((_req, res) => {
            res.statusCode = status;
            res.end();
        });

        for (const next of [ 500, 503, 404, 301 ]) {
            status = next;
            expect(await probeHealth({ https: false, port, host: LOCALHOST })).toBe(1);
        }

        expect(logged).toEqual([ "STATUS: 500", "STATUS: 503", "STATUS: 404", "STATUS: 301" ]);
    });

    it("reports unhealthy when nothing is listening", async () => {
        const port = await reserveFreePort();

        expect(await probeHealth({ https: false, port, host: LOCALHOST })).toBe(1);
        expect(logged).toEqual([ "ERROR" ]);
    });

    it("reaches the server over a unix socket when the port is 0", async () => {
        const seen: (string | undefined)[] = [];
        const socketPath = await startUnixServer((req, res) => {
            seen.push(req.url);
            res.statusCode = 200;
            res.end();
        });

        expect(await probeHealth({ https: false, port: 0, host: socketPath })).toBe(0);
        expect(seen).toEqual([ "/api/health-check" ]);
        expect(logged).toEqual([ "STATUS: 200" ]);
    });

    it("reports unhealthy when the unix socket is not there", async () => {
        const socketPath = path.join(makeTempDir(), "absent.sock");

        expect(await probeHealth({ https: false, port: 0, host: socketPath })).toBe(1);
        expect(logged).toEqual([ "ERROR" ]);
    });

    it("reports healthy without contacting the server when trilium terminates TLS", async () => {
        let reached = false;
        const port = await startServer((_req, res) => {
            reached = true;
            res.end();
        });

        expect(await probeHealth({ https: true, port, host: LOCALHOST })).toBe(0);
        expect(reached).toBe(false);
        expect(logged).toEqual([]);
    });

    it("accepts a 200 whatever the body says", async () => {
        // Only the status line is read, so a reverse proxy's own 200 error page passes.
        const port = await startServer((_req, res) => {
            res.statusCode = 200;
            res.end("<html>proxy error</html>");
        });

        expect(await probeHealth({ https: false, port, host: LOCALHOST })).toBe(0);
    });

    it("waits indefinitely on a server that accepts the connection and stays silent", async () => {
        // `timeout` only arms the socket's idle timer. Nothing listens for the event it emits,
        // so the request is never destroyed and the probe outlives its own deadline.
        const port = await startServer(() => { /* accepts the request, never answers */ });
        const settled = vi.fn();
        const probe = probeHealth({ https: false, port, host: LOCALHOST });

        void probe.then(settled);
        await new Promise((resolve) => setTimeout(resolve, 2500));

        expect(settled).not.toHaveBeenCalled();

        // Drop the connection so the probe settles here rather than during a later test.
        await stopEverything();
        expect(await probe).toBe(1);
        expect(logged).toEqual([ "ERROR" ]);
    });
});

/** Everything a test opened, torn down afterwards whether or not the test got that far. */
const openServers: http.Server[] = [];
const openSockets = new Set<net.Socket>();
const tempDirs: string[] = [];

async function startServer(handler: http.RequestListener) {
    const server = track(http.createServer(handler));
    await new Promise<void>((resolve) => server.listen(0, LOCALHOST, resolve));

    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("expected the server to be listening on a TCP port");
    }

    return address.port;
}

async function startUnixServer(handler: http.RequestListener) {
    const socketPath = path.join(makeTempDir(), "trilium.sock");
    const server = track(http.createServer(handler));
    await new Promise<void>((resolve) => server.listen(socketPath, resolve));

    return socketPath;
}

/** A port that was listening a moment ago and is now free, so connecting to it is refused. */
async function reserveFreePort() {
    const server = net.createServer();
    await new Promise<void>((resolve) => server.listen(0, LOCALHOST, resolve));

    const address = server.address();
    if (address === null || typeof address === "string") {
        throw new Error("expected the server to be listening on a TCP port");
    }

    await new Promise<void>((resolve) => server.close(() => resolve()));

    return address.port;
}

function track(server: http.Server) {
    openServers.push(server);
    server.on("connection", (socket) => {
        openSockets.add(socket);
        socket.on("close", () => openSockets.delete(socket));
    });

    return server;
}

function makeTempDir() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-healthcheck-"));
    tempDirs.push(dir);

    return dir;
}

async function stopEverything() {
    // A silent server still holds a live socket, which keeps close() from ever calling back.
    for (const socket of openSockets) {
        socket.destroy();
    }
    openSockets.clear();

    for (const server of openServers.splice(0)) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
    }

    for (const dir of tempDirs.splice(0)) {
        fs.rmSync(dir, { recursive: true, force: true });
    }
}
