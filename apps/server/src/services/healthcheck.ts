import fs from "fs";
import http from "http";
import ini from "ini";
import os from "os";
import path from "path";

/** Where the probe looks for the server, as the running instance resolved it. */
export interface HealthcheckTarget {
    /** True when Trilium terminates TLS itself, which the probe cannot speak. */
    https: boolean;
    /** TCP port to probe, or 0 when `host` names a Unix socket instead. */
    port: number;
    /** Host name, or the Unix socket path when `port` is 0. */
    host: string;
}

//#region Probing the server

const PROBE_PATH = "/api/health-check";
const TIMEOUT_MS = 2000;

/**
 * Requests `/api/health-check` and resolves the exit code Docker reads from the probe:
 * 0 for healthy, 1 for unhealthy.
 */
export function probeHealth({ https, port, host }: HealthcheckTarget): Promise<number> {
    if (https) {
        // Trilium-terminated TLS is not supported yet, PRs are welcome. A reverse proxy that
        // terminates TLS leaves `https` false, so the probe still runs there.
        return Promise.resolve(0);
    }

    return new Promise((resolve) => {
        const options: http.RequestOptions = { timeout: TIMEOUT_MS };
        const onResponse = (res: http.IncomingMessage) => {
            console.log(`STATUS: ${res.statusCode}`);
            resolve(res.statusCode === 200 ? 0 : 1);
        };

        const request = port !== 0
            ? http.request(`http://${host}:${port}${PROBE_PATH}`, options, onResponse)
            : http.request({ ...options, socketPath: host, path: PROBE_PATH }, onResponse);

        // `timeout` only arms the socket's idle timer, so the request has to be torn down here.
        // Without this a wedged server that still completes the handshake is waited on forever.
        request.on("timeout", () => {
            console.log(`TIMEOUT after ${TIMEOUT_MS} ms`);
            request.destroy();
            resolve(1);
        });

        request.on("error", () => {
            console.log("ERROR");
            resolve(1);
        });
        request.end();
    });
}

//#endregion

//#region Resolving where to probe

const DEFAULT_HOST = "0.0.0.0";
const DEFAULT_PORT = 8080;
const MAX_PORT = 65536;

/**
 * Resolves where to probe, mirroring what config.ts, port.ts and host.ts resolve for the running
 * server. It reads the same environment variables and the same `[Network]` section of config.ini,
 * but imports none of those modules: loading them creates the data directory, writes a config
 * sample and can call process.exit(), none of which a healthcheck should do. The two readings are
 * held in agreement by the tests in healthcheck.spec.ts.
 */
export function resolveHealthcheckTarget(env: NodeJS.ProcessEnv = process.env): HealthcheckTarget {
    const network = readNetworkSection(env);

    return {
        https: resolveHttps(env.TRILIUM_NETWORK_HTTPS, network.https),
        port: resolvePort(env, network.port),
        host: env.TRILIUM_HOST || fromConfig(env.TRILIUM_NETWORK_HOST, network.host, DEFAULT_HOST)
    };
}

/** TRILIUM_PORT wins when set, as it does in port.ts, then whatever config.ts would report. */
function resolvePort(env: NodeJS.ProcessEnv, iniValue: unknown) {
    const resolved = env.TRILIUM_PORT || fromConfig(env.TRILIUM_NETWORK_PORT, iniValue, "");
    const port = parseInt(resolved, 10);

    // port.ts exits on a port outside this range, so the server is not listening either way.
    return Number.isInteger(port) && port >= 0 && port < MAX_PORT ? port : DEFAULT_PORT;
}

function resolveHttps(envValue: string | undefined, iniValue: unknown) {
    if (envValue !== undefined) {
        return toBoolean(envValue);
    }

    return hasIniValue(iniValue) ? toBoolean(iniValue) : false;
}

/** Mirrors getConfigValue in config.ts: the environment variable wins even when it is empty. */
function fromConfig(envValue: string | undefined, iniValue: unknown, fallback: string) {
    if (envValue !== undefined) {
        return envValue;
    }

    return hasIniValue(iniValue) ? String(iniValue) : fallback;
}

function hasIniValue(value: unknown) {
    return value !== undefined && value !== null && value !== "";
}

/** Mirrors transformBoolean in config.ts: "true"/"false" in any case, plus 1 and 0. */
function toBoolean(value: unknown) {
    const text = String(value).toLowerCase().trim();

    if (text === "true") {
        return true;
    }
    if (text === "false") {
        return false;
    }

    return value === "1" || value === 1;
}

//#endregion

//#region Reading config.ini

const DATA_DIR_NAME = "trilium-data";

function readNetworkSection(env: NodeJS.ProcessEnv): Record<string, unknown> {
    const iniPath = env.TRILIUM_CONFIG_INI_PATH || path.join(resolveDataDir(env), "config.ini");

    try {
        if (!fs.existsSync(iniPath)) {
            return {};
        }

        const section = ini.parse(fs.readFileSync(iniPath, "utf8")).Network;

        return section && typeof section === "object" ? section : {};
    } catch {
        // An unreadable config.ini leaves the defaults in place, which still probe localhost.
        return {};
    }
}

/** The read-only half of getTriliumDataDir in data_dir.ts, which creates directories as it goes. */
function resolveDataDir(env: NodeJS.ProcessEnv) {
    if (env.TRILIUM_DATA_DIR) {
        return env.TRILIUM_DATA_DIR;
    }

    const homePath = path.join(os.homedir(), DATA_DIR_NAME);
    if (fs.existsSync(homePath)) {
        return homePath;
    }

    const appDataDir = platformAppDataDir(env);

    if (appDataDir && fs.existsSync(appDataDir)) {
        return path.join(appDataDir, DATA_DIR_NAME);
    }

    return homePath;
}

function platformAppDataDir(env: NodeJS.ProcessEnv) {
    const platform = os.platform();

    if (platform === "win32") {
        return env.APPDATA || null;
    }
    if (platform === "linux") {
        return path.join(os.homedir(), ".local", "share");
    }
    if (platform === "darwin") {
        return path.join(os.homedir(), "Library", "Application Support");
    }

    return null;
}

//#endregion
