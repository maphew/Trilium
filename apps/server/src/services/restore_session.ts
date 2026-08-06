import { getLog, holdSetup, withSetupLock } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { createChunkedUpload } from "./chunked_upload.js";
import dataDir from "./data_dir.js";
import {
    readBackupFormat,
    removeQuietly,
    reportRestoreFailure,
    restoreDatabase,
    RestoreFailure,
    type RestoreFailureReason,
    type RestoreRequest
} from "./database_restore.js";

/**
 * Holds the backup the setup screen is about to restore, however it arrived, and starts the restore
 * when the user says so.
 *
 * There are two ways in and they converge here: a browser sends the file in chunks, and the desktop
 * points at one already on disk. Both end as *the pending backup*, so the passphrase prompt, the
 * retry after a wrong one, and the restore itself are one path rather than two that have to be kept
 * in step. A backup picked from this device's own backup directory needs nothing pending: it names
 * itself each time, and must survive being restored.
 *
 * Setup is reserved from the moment a backup is pending. What is coming replaces the database, and an
 * hour of uploading must not end with another tab having created a document in the meantime.
 *
 * @module
 */

/** No database is worth more than this, and an upload claiming to be is refused before it starts. */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024 * 1024;

/** Failures another passphrase could still get past, which is the only reason to keep the backup. */
const RETRYABLE_WITH_ANOTHER_PASSPHRASE = new Set<RestoreFailureReason>([
    "passphrase-required",
    "wrong-passphrase-or-damaged-header"
]);

/**
 * Where a finished upload waits between arriving and being restored.
 *
 * Deliberately outside the restore's own working directory, which is emptied whenever a restore
 * ends: a wrong passphrase would otherwise take the uploaded backup with it, and the user would have
 * to send the whole file again to try another one.
 */
const PENDING_UPLOAD_PATH = path.join(dataDir.TMP_DIR, "uploads", "pending-backup");

/** The backup waiting to be restored, and what the screen needs to know about it. */
export interface PendingBackup {
    fileName: string;
    /** Whether the user has to be asked for a passphrase before anything can be done with it. */
    encrypted: boolean;
}

interface Pending extends PendingBackup {
    path: string;
    /** An upload exists only to be restored and may be consumed; a file of the user's may not. */
    consumable: boolean;
}

let pending: Pending | null = null;
let releaseSetupHold: (() => void) | null = null;

/** Receives a backup a chunk at a time, and makes what arrives the pending one. */
export const backupUpload = createChunkedUpload<PendingBackup>({
    name: "restore",
    directory: path.join(dataDir.TMP_DIR, "uploads"),
    maxTotalBytes: MAX_BACKUP_BYTES,
    requireFreeSpace: true,
    onComplete: async ({ path: uploadedPath, fileName }) => {
        fs.mkdirSync(path.dirname(PENDING_UPLOAD_PATH), { recursive: true });
        fs.rmSync(PENDING_UPLOAD_PATH, { force: true });
        // A move rather than a copy: the file is the size of a database, and both ends are in the
        // same temporary directory.
        fs.renameSync(uploadedPath, PENDING_UPLOAD_PATH);

        getLog().info(`A backup was uploaded for restoring (${fileName}).`);

        return setPendingBackup(PENDING_UPLOAD_PATH, fileName, { consumable: true });
    }
});

/**
 * Makes the backup at `filePath` the one waiting to be restored, and reserves setup for it.
 *
 * @param options.consumable whether the restore may take the file rather than copy it. True only for
 *        a file that exists to be restored, i.e. an upload; never for one of the user's own.
 * @throws ConflictError when setup is busy with something else.
 */
export function setPendingBackup(filePath: string, fileName: string, options: { consumable: boolean }): PendingBackup {
    // Taken before the backup is recorded, so a refusal leaves nothing pending behind it. Released
    // when the restore ends, or when the backup is discarded.
    releaseSetupHold ??= holdSetup("restore-backup");

    pending = {
        path: filePath,
        fileName,
        consumable: options.consumable,
        // Stated in the clear in a container's header, so the screen knows to ask for a passphrase
        // without having to try the restore and fail first.
        encrypted: readBackupFormat(filePath)?.encrypted ?? false
    };

    return { fileName: pending.fileName, encrypted: pending.encrypted };
}

/** The backup waiting to be restored, or `null` when none is. */
export function getPendingBackup(): PendingBackup | null {
    return pending && { fileName: pending.fileName, encrypted: pending.encrypted };
}

/** What a restore needs to know to run, for the backup that is pending. */
export function pendingRestoreRequest(): Omit<RestoreRequest, "passphrase"> | null {
    return pending && { path: pending.path, fileName: pending.fileName, consumable: pending.consumable };
}

/**
 * Starts a restore and returns at once, since unwrapping, checking and migrating a large database
 * outlast any sensible request or dialog. Progress is followed through
 * {@link getRestoreProgress}.
 *
 * The setup lock is held for the whole of it, not just for starting it.
 */
export function beginRestore(request: RestoreRequest): void {
    void withSetupLock("restore-backup", async () => {
        try {
            await restoreDatabase(request);
            discardPendingBackup();
        } catch (e) {
            // A passphrase that was wrong or missing is the one failure the same backup can still
            // recover from, so it is kept for the next attempt. Anything else will fail the same way
            // however often it is tried.
            if (!(e instanceof RestoreFailure) || !RETRYABLE_WITH_ANOTHER_PASSPHRASE.has(e.reason)) {
                discardPendingBackup();
            }

            throw e;
        }
    }).catch((e) => {
        // A restore that ran has already recorded why it stopped. One that was refused before it
        // began has recorded nothing, and a client polling for progress would wait on it forever.
        if (!(e instanceof RestoreFailure)) {
            reportRestoreFailure(request.fileName, e);
        }
    });
}

/**
 * Frees setup once the pending backup is restored, abandoned, or found to be unusable, and deletes it
 * if it was ours to delete.
 *
 * Runs while a failure is on its way to the user, so a file that will not go must not become the
 * failure they are told about. Setup is freed either way: a file left behind costs disk, a lock left
 * behind costs them every other way out of the setup screen.
 */
export function discardPendingBackup(): void {
    if (pending?.consumable) {
        removeQuietly(pending.path);
    }

    pending = null;
    releaseSetupHold?.();
    releaseSetupHold = null;
}
