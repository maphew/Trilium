import type { StandaloneSecuritySettingName } from "@triliumnext/commons";
import type { CoreConfig } from "@triliumnext/core";

/**
 * The `security.json` this build keeps in the origin's private filesystem.
 *
 * The desktop keeps the same file in its data directory, deliberately outside the database, so a
 * script that reaches the SQL console cannot grant itself backend scripting with an `UPDATE
 * options`. Here the file has to survive a stronger attacker: a frontend script runs in the page,
 * and the page can reach OPFS on its own.
 *
 * What keeps it out of reach is the exclusive lock an OPFS sync access handle takes.
 * `createSyncAccessHandle()` exists only in a dedicated worker, so this worker takes the handle
 * during startup and holds it until the page that owns it goes away; while it does, a
 * `createWritable()` on the same file from the page fails with `NoModificationAllowedError`, and
 * so does removing it. The worker is therefore the only writer, and the only way to reach the
 * worker is the `SECURITY_SET` message that `security_gate.ts` sends after the browser has asked
 * the user.
 *
 * @module
 */

export interface StandaloneSecuritySettings {
    backendScriptingEnabled: boolean;
    sqlConsoleEnabled: boolean;
}

export const SECURITY_SETTING_NAMES: readonly StandaloneSecuritySettingName[] = [
    "backendScriptingEnabled",
    "sqlConsoleEnabled"
];

/** What an instance never told otherwise runs with, and what every failure falls back to. */
export const DEFAULT_SECURITY_SETTINGS: StandaloneSecuritySettings = {
    backendScriptingEnabled: false,
    sqlConsoleEnabled: false
};

const SECURITY_FILE_NAME = "security.json";

/** Matches `waitForSahPoolRelease`, which waits out the same handover for the database pool. */
const ACQUIRE_DEADLINE_MS = 15_000;
const ACQUIRE_POLL_MS = 150;

export interface AcquireOptions {
    deadlineMs?: number;
    pollMs?: number;
    getRoot?: () => Promise<FileSystemDirectoryHandle>;
}

/**
 * Takes the lock on `security.json` and answers what it says, for as long as the worker lives.
 *
 * A reload starts this worker while the browser is still releasing the previous one's handles, so
 * the acquisition is retried the way the database pool's is. Every way this can fail — no OPFS, a
 * handle nothing ever releases — produces a store that reads the defaults and refuses writes,
 * because the alternative to a lock that was never taken is a file anything can write.
 */
export async function acquireSecuritySettings({
    deadlineMs = ACQUIRE_DEADLINE_MS,
    pollMs = ACQUIRE_POLL_MS,
    getRoot = () => navigator.storage.getDirectory()
}: AcquireOptions = {}): Promise<SecuritySettingsStore> {
    let file: FileSystemFileHandle;
    try {
        file = await (await getRoot()).getFileHandle(SECURITY_FILE_NAME, { create: true });
    } catch (e) {
        console.warn("[SecuritySettings] The settings file could not be opened:", e);
        return new SecuritySettingsStore(null);
    }

    const deadline = Date.now() + deadlineMs;
    for (;;) {
        try {
            return new SecuritySettingsStore(await file.createSyncAccessHandle());
        } catch (e) {
            // `NoModificationAllowedError` is the one worth waiting out: another context holds the
            // file, usually the worker of the page this one replaced. Anything else is an
            // environment that cannot do this at all, and retrying it only delays the boot.
            const isHeld = (e as DOMException)?.name === "NoModificationAllowedError";
            if (!isHeld || Date.now() >= deadline) {
                console.warn(
                    "[SecuritySettings] The settings file could not be locked, so this "
                    + "instance runs with backend scripting and the SQL console off:", e
                );
                return new SecuritySettingsStore(null);
            }
            await new Promise(resolve => setTimeout(resolve, pollMs));
        }
    }
}

/** Reads the settings this start runs with, and writes the ones the user agrees to. */
export class SecuritySettingsStore {
    constructor(private readonly handle: FileSystemSyncAccessHandle | null) {}

    /** Whether the lock was taken, which is what decides if a change can be written at all. */
    get isWritable(): boolean {
        return this.handle !== null;
    }

    read(): StandaloneSecuritySettings {
        if (!this.handle) {
            return { ...DEFAULT_SECURITY_SETTINGS };
        }

        try {
            const bytes = new Uint8Array(this.handle.getSize());
            this.handle.read(bytes, { at: 0 });
            return parseSecuritySettings(new TextDecoder().decode(bytes));
        } catch (e) {
            console.warn("[SecuritySettings] The settings file could not be read:", e);
            return { ...DEFAULT_SECURITY_SETTINGS };
        }
    }

    /**
     * Writes one setting, and says whether it was written.
     *
     * The name and the value are checked here rather than trusted, because both arrive as a message
     * from the page: this is the point where a request stops being something a script asked for and
     * becomes what the next start reads.
     */
    setSetting(name: unknown, enabled: unknown): boolean {
        if (!this.handle || !isSecuritySettingName(name) || typeof enabled !== "boolean") {
            return false;
        }

        try {
            const settings = { ...this.read(), [name]: enabled };
            const bytes = new TextEncoder().encode(JSON.stringify(settings, null, 4));
            this.handle.truncate(0);
            const written = this.handle.write(bytes, { at: 0 });
            this.handle.flush();

            // A short write leaves the file holding part of a setting, which the next start reads
            // as no settings at all. Saying so is what keeps the toggle from claiming otherwise.
            if (written !== bytes.length) {
                console.error(
                    `[SecuritySettings] Only ${written} of ${bytes.length} bytes were written.`
                );
                return false;
            }

            return true;
        } catch (e) {
            console.error("[SecuritySettings] The settings file could not be written:", e);
            return false;
        }
    }
}

export function isSecuritySettingName(name: unknown): name is StandaloneSecuritySettingName {
    return typeof name === "string" && (SECURITY_SETTING_NAMES as readonly string[]).includes(name);
}

/**
 * Reads what the file says, granting nothing it does not say exactly.
 *
 * Only a literal `true` enables anything: a `"true"`, a `1` or an object is what a half-written
 * file looks like, and none of them is a decision the user made.
 */
export function parseSecuritySettings(raw: string): StandaloneSecuritySettings {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return { ...DEFAULT_SECURITY_SETTINGS };
    }

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
        return { ...DEFAULT_SECURITY_SETTINGS };
    }

    const record = parsed as Record<string, unknown>;
    return {
        backendScriptingEnabled: record.backendScriptingEnabled === true,
        sqlConsoleEnabled: record.sqlConsoleEnabled === true
    };
}

/**
 * The config core is started with, which is where these settings become the guard's answer.
 *
 * Core treats an empty string and `false` as "no override" and falls back to the stored option, so
 * this carries the two flags the file holds and lets core answer the rest for itself.
 */
export function toCoreConfig(settings: StandaloneSecuritySettings): CoreConfig {
    return {
        General: { instanceName: "", readOnly: false },
        Sync: { syncServerHost: "", syncServerTimeout: "", syncProxy: "" },
        Security: {
            backendScriptingEnabled: settings.backendScriptingEnabled,
            sqlConsoleEnabled: settings.sqlConsoleEnabled,
            allowLanAccess: false
        }
    };
}
