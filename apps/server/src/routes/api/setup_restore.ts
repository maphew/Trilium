import { getBackup, getLog, holdSetup, NotFoundError, ValidationError, withSetupLock } from "@triliumnext/core";
import type { Request } from "express";
import fs from "fs";
import path from "path";

import type ServerBackupService from "../../backup_provider.js";
import { createChunkedUpload } from "../../services/chunked_upload.js";
import dataDir from "../../services/data_dir.js";
import {
    getRestoreProgress,
    readBackupFormat,
    removeQuietly,
    reportRestoreFailure,
    restoreDatabase,
    RestoreFailure,
    type RestoreFailureReason,
    type RestoreProgress
} from "../../services/database_restore.js";

/**
 * The setup screen's way back from a backup: list what is already on disk, take a file that is not,
 * and restore whichever the user picks.
 *
 * Every endpoint here is reachable without authentication, because before the database exists there
 * is nobody to authenticate — the same footing the rest of the setup wizard stands on. What that
 * costs is bounded deliberately: one upload at a time, a ceiling on its size, a session that expires,
 * and a path from the listing that is checked against the backup directories rather than taken at
 * its word.
 *
 * @module
 */

/** No database is worth more than this, and an upload claiming to be is refused before it starts. */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024 * 1024;

/** Failures another passphrase could still get past, which is the only reason to keep the file. */
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

/** What an upload turned out to be, which decides whether the user is asked for a passphrase. */
interface PendingUpload {
    fileName: string;
    encrypted: boolean;
}

let pendingUpload: PendingUpload | null = null;
let releaseSetupHold: (() => void) | null = null;

const upload = createChunkedUpload<PendingUpload>({
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

        pendingUpload = {
            fileName,
            // Stated in the clear in a container's header, so the setup screen knows to ask for a
            // passphrase without having to try the restore and fail first.
            encrypted: readBackupFormat(PENDING_UPLOAD_PATH)?.encrypted ?? false
        };
        getLog().info(`A backup was uploaded for restoring (${fileName}).`);

        return pendingUpload;
    }
});

/**
 * Starts an upload, and reserves setup for it: what arrives is going to replace the database, and an
 * hour of uploading must not end with another tab having created a document in the meantime.
 */
async function beginUpload(req: Request) {
    const status = await upload.begin(req);

    // Taken after the upload is accepted, so a refused one does not leave setup reserved. Released
    // when the restore ends, when the upload is abandoned, or when its session expires.
    releaseSetupHold ??= holdSetup("restore-backup");

    return status;
}

async function uploadChunk(req: Request) {
    return await upload.chunk(req);
}

async function uploadStatus(req: Request) {
    return await upload.status(req);
}

async function finishUpload(req: Request) {
    return await upload.finish(req);
}

async function abortUpload(req: Request) {
    await upload.abort(req);
    discardPendingUpload();
}

/**
 * Restores the backup the user picked: the one just uploaded, or one from the backup directory.
 *
 * Answers as soon as the restore is under way rather than when it is over, since unwrapping,
 * checking and migrating a large database outlast any sensible request. The client follows the rest
 * through {@link status}.
 */
async function start(req: Request) {
    const { source, filePath, passphrase } = (req.body ?? {}) as StartBody;
    const request = source === "existing"
        ? existingBackup(filePath)
        : uploadedBackup();

    // Deliberately not awaited: the restore runs on past this response, holding the setup lock for
    // as long as it takes, and reports itself through the status endpoint.
    void withSetupLock("restore-backup", async () => {
        try {
            await restoreDatabase({ ...request, passphrase });
            discardPendingUpload();
        } catch (e) {
            // A passphrase that was wrong or missing is the one failure the same file can still
            // recover from, so the upload is kept for the next attempt. Anything else is a file that
            // will fail the same way however often it is tried.
            if (!(e instanceof RestoreFailure) || !RETRYABLE_WITH_ANOTHER_PASSPHRASE.has(e.reason)) {
                discardPendingUpload();
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

    return { started: true };
}

function status(): { restore: RestoreProgress | null } {
    return { restore: getRestoreProgress() };
}

/** Drops the sweeper's timer. Only the tests have any use for a shutdown this tidy. */
function stop() {
    upload.stop();
}

export default {
    beginUpload,
    uploadChunk,
    uploadStatus,
    finishUpload,
    abortUpload,
    start,
    status,
    stop
};

interface StartBody {
    source?: "uploaded" | "existing";
    /** Only for `existing`: which backup, from the listing. */
    filePath?: string;
    passphrase?: string;
}

function uploadedBackup() {
    if (!pendingUpload) {
        throw new NotFoundError("No uploaded backup is waiting to be restored.");
    }

    return { path: PENDING_UPLOAD_PATH, fileName: pendingUpload.fileName, consumable: true };
}

/**
 * A backup from the listing, resolved through the backup service rather than trusted: the path
 * arrives from a client, on an endpoint that needs no authentication.
 */
function existingBackup(filePath: string | undefined) {
    if (!filePath) {
        throw new ValidationError("No backup was named.");
    }

    const backup = getBackup() as ServerBackupService;
    const resolvedPath = backup.resolveBackupPath(filePath);
    if (!resolvedPath) {
        throw new NotFoundError("No such backup.");
    }

    return { path: resolvedPath, fileName: path.basename(resolvedPath), consumable: false };
}

/**
 * Frees setup and the disk once an upload is restored, abandoned, or found to be unusable.
 *
 * Runs while a failure is on its way to the user, so the file not going quietly must not become the
 * failure they are told about. Setup is freed either way: a file left behind costs disk, a lock left
 * behind costs them every other way out of the setup screen.
 */
function discardPendingUpload() {
    pendingUpload = null;
    removeQuietly(PENDING_UPLOAD_PATH);

    releaseSetupHold?.();
    releaseSetupHold = null;
}
