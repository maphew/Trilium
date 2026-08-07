/**
 * What the standalone build exposes to the client as `window.standaloneApi`.
 *
 * Standalone runs the whole stack in the browser: the database lives in a worker's private
 * filesystem, and the client talks to it over an intercepted `fetch`. That path serialises every
 * request body twice on its way through, and gives up after thirty seconds, which is fine for the
 * JSON everything else exchanges and impossible for a database.
 *
 * So the few things that carry a file get their own way through, the same way the desktop's
 * `window.electronApi` does. A `File` handed across is a reference to bytes the browser already has;
 * nothing is copied, nothing is uploaded, and the worker reads it as a stream.
 */

/** How far a restore has got, reported as it goes. */
export interface StandaloneRestoreProgress {
    /** Which step is running: preparing the backup, checking it, or putting it in place. */
    stage: "staging" | "validating" | "swapping" | "done" | "failed";
    /** How far through that step, from 0 to 1, for the step that can say. */
    fraction?: number;
}

/** How a restore ended. */
export interface StandaloneRestoreResult {
    status: "restored" | "needs-passphrase" | "error";
    /** Machine-readable cause when `status` is `error`, which the screen turns into a sentence. */
    reason?: string;
    /** The technical detail behind that cause. */
    message?: string;
}

export interface StandaloneRestoreApi {
    /**
     * Restores the database from a backup the user picked, reading it where it lies.
     *
     * Answers `needs-passphrase` for an encrypted backup given none, which is an invitation to ask
     * for one and call again with the same file rather than a failure.
     */
    importBackup(opts: {
        backup: File;
        passphrase?: string;
        onProgress?: (progress: StandaloneRestoreProgress) => void;
    }): Promise<StandaloneRestoreResult>;
}

/** The complete surface the standalone build exposes to the client. */
export interface StandaloneApi {
    restore: StandaloneRestoreApi;
}
