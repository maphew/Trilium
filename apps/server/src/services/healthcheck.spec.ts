import fs from "fs";
import http from "http";
import net from "net";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { probeHealth, resolveHealthcheckTarget } from "./healthcheck.js";

//#region Probing the server

const LOCALHOST = "127.0.0.1";
/** The probe asks for 2000 ms, so a wait past this is a wait without end. */
const DEADLINE_ALLOWANCE_MS = 3000;
const STILL_WAITING = "still waiting for the probe to give up";

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
        await stopEverything();
        await new Promise((resolve) => setImmediate(resolve));
        vi.restoreAllMocks();
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

    it("gives up and reports unhealthy when the server accepts but never answers", async () => {
        // A wedged server still completes the handshake, which is the case the probe exists to
        // catch. Its own 2000 ms deadline has to end the wait and report unhealthy.
        const port = await startServer(() => { /* accepts the request, never answers */ });
        const started = Date.now();

        let giveUp: ReturnType<typeof setTimeout> | undefined;
        const outcome = await Promise.race([
            probeHealth({ https: false, port, host: LOCALHOST }),
            new Promise((resolve) => {
                giveUp = setTimeout(() => resolve(STILL_WAITING), DEADLINE_ALLOWANCE_MS);
            })
        ]);
        clearTimeout(giveUp);

        expect(outcome).toBe(1);
        expect(Date.now() - started).toBeGreaterThanOrEqual(2000);
        expect(logged).toEqual([ "TIMEOUT after 2000 ms" ]);
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

//#endregion

//#region Resolving where to probe

/**
 * The probe resolves its target without importing config.ts, port.ts or host.ts, so nothing but
 * these tests keeps the two readings of the same environment and config.ini in step. The last
 * block runs the real config modules over the same inputs and compares.
 */
describe("resolving the healthcheck target", () => {
    let tempDir: string;
    let iniPath: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-target-"));
        iniPath = path.join(tempDir, "config.ini");
    });

    afterEach(() => {
        fs.rmSync(tempDir, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it("falls back to localhost:8080 over http when nothing is configured", () => {
        expect(resolveHealthcheckTarget(baseEnv()))
            .toEqual({ https: false, port: 8080, host: "0.0.0.0" });
    });

    it("reads the [Network] section of config.ini", () => {
        writeIni("[Network]\nhost=192.168.1.5\nport=9001\nhttps=true\n");

        expect(resolveHealthcheckTarget(baseEnv())).toEqual({
            https: true, port: 9001, host: "192.168.1.5"
        });
    });

    it("lets the environment override config.ini", () => {
        writeIni("[Network]\nhost=192.168.1.5\nport=9001\n");
        const target = resolveHealthcheckTarget(baseEnv({
            TRILIUM_NETWORK_HOST: "10.0.0.1",
            TRILIUM_NETWORK_PORT: "7777"
        }));

        expect(target).toEqual({ https: false, port: 7777, host: "10.0.0.1" });
    });

    it("prefers the short TRILIUM_PORT and TRILIUM_HOST aliases over everything else", () => {
        writeIni("[Network]\nhost=192.168.1.5\nport=9001\n");
        const target = resolveHealthcheckTarget(baseEnv({
            TRILIUM_NETWORK_HOST: "10.0.0.1", TRILIUM_NETWORK_PORT: "7777",
            TRILIUM_HOST: "127.0.0.1", TRILIUM_PORT: "8082"
        }));

        expect(target).toEqual({ https: false, port: 8082, host: "127.0.0.1" });
    });

    it("takes config.ini from TRILIUM_CONFIG_INI_PATH when it is set", () => {
        const elsewhere = path.join(tempDir, "elsewhere.ini");
        fs.writeFileSync(elsewhere, "[Network]\nport=9100\n");

        expect(resolveHealthcheckTarget({
            TRILIUM_DATA_DIR: tempDir, TRILIUM_CONFIG_INI_PATH: elsewhere
        }).port).toBe(9100);
    });

    it("reads https as true only for true and 1, in any case", () => {
        for (const [ value, expected ] of [
            [ "true", true ], [ "TRUE", true ], [ " true ", true ], [ "1", true ],
            [ "false", false ], [ "0", false ], [ "yes", false ], [ "", false ]
        ] as const) {
            const target = resolveHealthcheckTarget(baseEnv({ TRILIUM_NETWORK_HTTPS: value }));

            expect(target.https).toBe(expected);
        }
    });

    it("falls back to the default port when the configured one could never be listened on", () => {
        // port.ts exits rather than start, so the server is not listening on anything.
        for (const port of [ "not-a-port", "70000", "-1" ]) {
            expect(resolveHealthcheckTarget(baseEnv({ TRILIUM_PORT: port })).port).toBe(8080);
        }
    });

    it("survives a config.ini that is missing, empty or malformed", () => {
        expect(resolveHealthcheckTarget(baseEnv()).port).toBe(8080);

        for (const contents of [ "", "not an ini file at all", "[Network]\n" ]) {
            writeIni(contents);
            expect(resolveHealthcheckTarget(baseEnv())).toEqual({
                https: false, port: 8080, host: "0.0.0.0"
            });
        }
    });

    it("creates nothing on disk, unlike the config modules it stands in for", () => {
        const untouched = path.join(tempDir, "absent");

        resolveHealthcheckTarget({ TRILIUM_DATA_DIR: untouched });

        expect(fs.existsSync(untouched)).toBe(false);
    });

    it("finds the data directory the server would use when none is configured", () => {
        const home = path.join(tempDir, "home");
        const dataDir = path.join(home, "trilium-data");
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(path.join(dataDir, "config.ini"), "[Network]\nport=9200\n");
        vi.spyOn(os, "homedir").mockReturnValue(home);

        expect(resolveHealthcheckTarget({}).port).toBe(9200);
    });

    it("falls back to the platform's app-data directory, and to defaults without one", () => {
        const home = path.join(tempDir, "home");
        const appData = path.join(tempDir, "appdata");
        fs.mkdirSync(home, { recursive: true });
        vi.spyOn(os, "homedir").mockReturnValue(home);

        const cases = [
            { platform: "linux" as const, dir: path.join(home, ".local", "share"), env: {} },
            { platform: "darwin" as const, env: {},
                dir: path.join(home, "Library", "Application Support") },
            { platform: "win32" as const, dir: appData, env: { APPDATA: appData } }
        ];

        for (const [ index, { platform, dir, env } ] of cases.entries()) {
            const dataDir = path.join(dir, "trilium-data");
            fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(path.join(dataDir, "config.ini"), `[Network]\nport=93${index}0\n`);
            vi.spyOn(os, "platform").mockReturnValue(platform);

            expect(resolveHealthcheckTarget(env).port).toBe(9300 + index * 10);
            fs.rmSync(dir, { recursive: true, force: true });
        }

        // An unrecognised platform, and Windows without APPDATA, have nowhere else to look.
        vi.spyOn(os, "platform").mockReturnValue("freebsd");
        expect(resolveHealthcheckTarget({}).port).toBe(8080);

        vi.spyOn(os, "platform").mockReturnValue("win32");
        expect(resolveHealthcheckTarget({}).port).toBe(8080);
    });

    it("treats an unreadable config.ini as absent", () => {
        // A directory where the file should be: it exists, and reading it throws.
        fs.mkdirSync(iniPath);

        expect(resolveHealthcheckTarget(baseEnv())).toEqual({
            https: false, port: 8080, host: "0.0.0.0"
        });
    });

    describe("agrees with the server's own config modules", () => {
        const CASES = [
            { label: "nothing configured", env: {}, ini: "" },
            { label: "ini only", env: {},
                ini: "[Network]\nhost=192.168.1.5\nport=9001\nhttps=true\n" },
            { label: "standard env vars", ini: "[Network]\nport=9001\n",
                env: { TRILIUM_NETWORK_HOST: "10.0.0.1", TRILIUM_NETWORK_PORT: "7777" } },
            { label: "short aliases", ini: "[Network]\nport=9001\n",
                env: { TRILIUM_HOST: "127.0.0.1", TRILIUM_PORT: "8082" } },
            { label: "https via env", env: { TRILIUM_NETWORK_HTTPS: "true" }, ini: "" },
            { label: "https via ini", env: {}, ini: "[Network]\nhttps=1\n" }
        ];

        for (const { label, env, ini: iniText } of CASES) {
            it(label, async () => {
                writeIni(iniText);
                // config.ts and its imports need the ambient test environment to load at all, so
                // both readings are given the same merged environment rather than a bare one.
                const scenario = { ...process.env, ...baseEnv(env) };

                const viaConfig = await resolveViaConfigModules(scenario);

                expect(resolveHealthcheckTarget(scenario)).toEqual(viaConfig);
            });
        }
    });

    /** The env a container hands the probe, with the data dir pointed at this test's temp copy. */
    function baseEnv(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
        return { TRILIUM_DATA_DIR: tempDir, ...extra };
    }

    function writeIni(contents: string) {
        fs.writeFileSync(iniPath, contents);
    }
});

/**
 * Loads config.ts, port.ts and host.ts against the given environment and reports the target they
 * describe, so the resolver can be compared against the modules it replaces rather than against
 * hand-written expectations.
 */
async function resolveViaConfigModules(env: NodeJS.ProcessEnv) {
    const original = process.env;

    try {
        process.env = { ...env };
        vi.resetModules();

        const { default: config } = await import("./config.js");
        const { default: port } = await import("./port.js");
        const { default: host } = await import("./host.js");

        return { https: config.Network.https, port, host };
    } finally {
        process.env = original;
        vi.resetModules();
    }
}

//#endregion
