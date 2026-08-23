import http from "http";

/** Where the probe looks for the server, as the running instance resolved it. */
export interface HealthcheckTarget {
    /** True when Trilium terminates TLS itself, which the probe cannot speak. */
    https: boolean;
    /** TCP port to probe, or 0 when `host` names a Unix socket instead. */
    port: number;
    /** Host name, or the Unix socket path when `port` is 0. */
    host: string;
}

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

        request.on("error", () => {
            console.log("ERROR");
            resolve(1);
        });
        request.end();
    });
}
