import {
    type BackupContainerErrorReason,
    FIXED_HEADER_BYTES,
    isBackupContainerError,
    peekBackupContainer,
    readBackupContainer
} from "@triliumnext/backup-container";
import { cls, events as eventService, getLog, getSql, sql_init as sqlInit } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import config from "./config.js";
import dataDir from "./data_dir.js";
import { type DatabaseRejection, validateDatabaseFile } from "./database_validation.js";

/**
 * Puts a backup in place of this instance's database.
 *
 * The database is open before the restore starts and has to be open after it, so the file cannot
 * simply be written over: the connection is detached, the file is exchanged, and a new connection is
 * attached to what is now there. On Windows that order is not a preference — an open handle prevents
 * the file from being renamed at all.
 *
 * Everything that can be checked is checked before the exchange, on a copy nothing is attached to,
 * because the alternative is finding out afterwards: the migration is what would otherwise notice an
 * unusable database, and a migration that cannot proceed ends the process outright.
 *
 * The database being replaced is kept aside until the restored one has migrated and opened. Until
 * then a marker sits next to it, so an interruption in the middle — a power cut, a killed process —
 * is recognised at the next start and undone, rather than leaving an instance that cannot open its
 * own document.
 *
 * Only ever run during setup, where nothing else holds the database: the share connection is opened
 * on `dbReady`, which has not resolved, and sessions are not persisted until the database is
 * initialized.
 *
 * @module
 */

/** What the restore is doing, in the order it does it. */
export type RestoreStage =
    /** Getting the backup into a plain database file: unwrapping a container, or taking the upload. */
    | "staging"
    /** Reading that file to see whether it can be this instance's database. */
    | "validating"
    /** Detaching, exchanging the files, and attaching again. Over in moments. */
    | "swapping"
    /** Opening the restored database, which for an older one includes migrating it. */
    | "migrating"
    | "done"
    | "failed";

/** Why a restore stopped, in terms the setup screen turns into something the user can act on. */
export type RestoreFailureReason =
    | DatabaseRejection
    | BackupContainerErrorReason
    /** The files could not be exchanged; the original database is back in place. */
    | "swap-failed"
    /** The restored database is in place but would not open. */
    | "migration-failed"
    /** The restore never started, e.g. setup was busy with something else. */
    | "restore-refused";

export interface RestoreProgress {
    stage: RestoreStage;
    /** The name of the backup being restored, so a reloaded page can say what is going on. */
    fileName: string;
    /** Set when `stage` is `failed`. */
    error?: string;
    /** Set when `stage` is `failed`. */
    reason?: RestoreFailureReason;
}

export interface RestoreRequest {
    /** Where the backup is now. */
    path: string;
    /** What to call it when reporting on it. */
    fileName: string;
    /**
     * Whether the restore may take the file rather than copy it. True for an upload's temporary file,
     * whose only purpose is this; false for a backup in the backup directory, which must survive.
     */
    consumable: boolean;
    /** Required for an encrypted backup. */
    passphrase?: string;
}

let progress: RestoreProgress | null = null;

/** How the running or last restore is getting on, or `null` if none has been started. */
export function getRestoreProgress(): RestoreProgress | null {
    return progress;
}

/**
 * Restores `request` over this instance's database, reporting its way through
 * {@link getRestoreProgress}.
 *
 * Callers hold the setup lock for the whole call: a second setup operation starting midway through
 * would build a database over the one being restored, and neither would report anything wrong.
 *
 * @throws RestoreFailure carrying the reason, which is also left in the progress for the client that
 *         is polling rather than waiting.
 */
export async function restoreDatabase(request: RestoreRequest): Promise<void> {
    const log = getLog();
    log.info(`Restoring the database from a backup (${request.fileName}).`);
    progress = { stage: "staging", fileName: request.fileName };

    try {
        // The whole restore runs in one execution context: what follows the swap writes to the
        // database, and the request that started this is long since answered.
        await cls.init(async () => {
            const candidate = await stageBackup(request);

            report("validating");
            const validation = validateDatabaseFile(candidate);
            if (!validation.valid) {
                throw new RestoreFailure(validation.rejection, validation.message);
            }

            report("swapping");
            swapInDatabase(candidate);

            report("migrating");
            await openRestoredDatabase();
        });

        report("done");
        log.info("The database was restored.");
    } catch (e) {
        const failure = asFailure(e);
        progress = {
            stage: "failed",
            fileName: request.fileName,
            error: failure.message,
            reason: failure.reason
        };
        log.error(`The database could not be restored (${failure.reason}): ${failure.message}`);

        throw failure;
    } finally {
        // Whatever happened, the temporary files are of no further use. Tidying up is never allowed
        // to throw from here: an exception raised in a `finally` replaces the one on its way out, so
        // a directory that would not delete used to bury the reason the restore actually failed —
        // and with it the client's only way of telling a wrong passphrase from a broken backup.
        removeQuietly(stagingDirectory(), { recursive: true });
    }
}

/**
 * Records a failure that happened *instead of* a restore rather than during one, e.g. one that was
 * refused before it could start.
 *
 * Without this such a failure is reported nowhere: {@link restoreDatabase} never ran, so it left no
 * progress behind, and a client polling for one waits on a run that is never going to begin.
 */
export function reportRestoreFailure(fileName: string, error: unknown): void {
    progress = {
        stage: "failed",
        fileName,
        error: messageOf(error),
        reason: error instanceof RestoreFailure ? error.reason : "restore-refused"
    };
}

/**
 * Undoes a restore that was interrupted between the database being moved aside and the restored one
 * opening.
 *
 * Runs at startup, before the database is opened, and before core is initialized — so it says what it
 * did through the console rather than the log, which does not exist yet.
 */
export function recoverInterruptedRestore(document: string = dataDir.DOCUMENT_PATH): void {
    if (!fs.existsSync(markerFor(document))) {
        return;
    }

    const setAside = setAsideFor(document);
    if (fs.existsSync(setAside)) {
        console.info("A restore was interrupted; putting the previous database back.");
        removeDatabaseFiles(document);
        fs.renameSync(setAside, document);
    } else {
        // Nothing was set aside, so either the exchange had not started or it had finished: the
        // database in place is the one to open either way.
        console.info("A restore was interrupted; the database in place is intact.");
    }

    fs.rmSync(markerFor(document), { force: true });
}

/**
 * Moves `document` aside and puts `candidate` in its place, which is the whole of the exchange as far
 * as the filesystem is concerned.
 *
 * Separate from the detaching and attaching around it so that what happens to the files can be
 * exercised on its own, and so the order is stated in one place: aside first, sidecars after it,
 * candidate last.
 */
export function exchangeDatabaseFiles(candidate: string, document: string): void {
    const setAside = setAsideFor(document);

    fs.rmSync(setAside, { force: true });
    if (fs.existsSync(document)) {
        fs.renameSync(document, setAside);
    }

    // The sidecars belong to the database that was just moved away; left behind, SQLite would read
    // them as this one's.
    removeSidecars(document);

    moveInto(candidate, document);
}

/** A failure with a reason attached, so the setup screen can tell the cases apart. */
export class RestoreFailure extends Error {
    constructor(readonly reason: RestoreFailureReason, message: string) {
        super(message);
        this.name = "RestoreFailure";
    }
}

/** What a backup file is, read from its header rather than from what it is called. */
export interface BackupFormat {
    /** Whether it is a container rather than a plain copy of a database. */
    container: boolean;
    /** Whether a passphrase is needed to unwrap it. */
    encrypted: boolean;
}

/**
 * Identifies a backup file from its first few dozen bytes, which is where a container states what it
 * is, in the clear and without the passphrase.
 *
 * Goes by the header rather than the extension: a container renamed to `.db` is still a container,
 * and a database renamed to `.tnbackup` is still a database.
 *
 * @returns what the file is, or `null` when it cannot be read at all.
 */
export function readBackupFormat(filePath: string): BackupFormat | null {
    const head = Buffer.alloc(FIXED_HEADER_BYTES);
    let descriptor: number | undefined;

    try {
        descriptor = fs.openSync(filePath, "r");
        fs.readSync(descriptor, head, 0, head.length, 0);
    } catch {
        return null;
    } finally {
        if (descriptor !== undefined) {
            fs.closeSync(descriptor);
        }
    }

    const container = peekBackupContainer(head);

    return { container: !!container, encrypted: container?.encrypted ?? false };
}

/**
 * Produces the plain database file the rest of the restore works on.
 *
 * An uploaded database is used where it lies: it exists only to be restored, and copying it would
 * mean writing gigabytes a second time to no purpose. A container is unwrapped, and a backup from the
 * backup directory is copied, since that one has to stay where it is.
 */
export async function stageBackup(request: RestoreRequest): Promise<string> {
    const format = readBackupFormat(request.path);
    if (!format) {
        throw new RestoreFailure("not-a-database", "The backup could not be read.");
    }

    if (!format.container) {
        if (request.consumable) {
            return request.path;
        }

        const candidate = freshCandidatePath();
        await fs.promises.copyFile(request.path, candidate);
        return candidate;
    }

    // Asked before the file is read rather than after: an encrypted container without a passphrase
    // fails the same way either way, but only one of them takes minutes to get there.
    if (format.encrypted && !request.passphrase) {
        throw new RestoreFailure("passphrase-required", "The backup is encrypted.");
    }

    const candidate = freshCandidatePath();
    const source = fs.createReadStream(request.path);
    const destination = fs.createWriteStream(candidate);

    try {
        await readBackupContainer(source, destination, { passphrase: request.passphrase });
    } finally {
        // Both streams are closed here rather than left to the reader, which only ends them once it
        // gets as far as its pipeline: a wrong passphrase is refused before that, from the header, so
        // on a failure the two handles are still open. Windows will not let an open file be deleted
        // or replaced, which turns one wrong password into a staging directory that cannot be
        // cleared and an uploaded backup that cannot be overwritten by the next attempt.
        await closeStream(source);
        await closeStream(destination);
    }

    if (request.consumable) {
        await fs.promises.rm(request.path, { force: true });
    }

    return candidate;
}

/**
 * Exchanges the database file for `candidate`, leaving the old one aside under a marker until the
 * restored one has opened.
 *
 * Detaching, moving and attaching are one step as far as anything outside is concerned: either the
 * instance ends up on the restored database or back on the one it had.
 */
function swapInDatabase(candidate: string): void {
    const document = dataDir.DOCUMENT_PATH;

    // Written before anything moves: from here until the restored database opens, an interruption
    // leaves files that only this marker explains.
    fs.writeFileSync(markerFor(document), "");
    getSql().detachConnection();

    try {
        exchangeDatabaseFiles(candidate, document);
        getSql().attachFromFile(document, config.General.readOnly);
    } catch (e) {
        putBack(setAsideFor(document), document);
        attachQuietly(document);

        throw new RestoreFailure("swap-failed", messageOf(e));
    }
}

/**
 * Brings the restored database up: migrates it where it is older than this version, opens it, and
 * announces it, which is what starts everything that waits on a database being there.
 *
 * Announced here rather than through `setDbAsInitialized`, which does nothing when the database says
 * it is already initialized — and a restored one does, since it was initialized before it was backed
 * up. Mirrors what the "create new document" path does for the same reason.
 */
async function openRestoredDatabase(): Promise<void> {
    const document = dataDir.DOCUMENT_PATH;

    try {
        await sqlInit.initDbConnection();
    } catch (e) {
        putBack(setAsideFor(document), document);
        attachQuietly(document);

        throw new RestoreFailure("migration-failed", messageOf(e));
    }

    eventService.emit(eventService.DB_INITIALIZED);

    // The restore is over, so neither the previous database nor the marker has anything left to say.
    fs.rmSync(setAsideFor(document), { force: true });
    fs.rmSync(markerFor(document), { force: true });
}

/** Where the database being replaced waits until the restored one has opened. */
function setAsideFor(document: string): string {
    return `${document}.pre-restore`;
}

/** Says that an exchange is under way, for a start that finds the pieces of an interrupted one. */
function markerFor(document: string): string {
    return `${document}.restore-in-progress`;
}

function report(stage: RestoreStage): void {
    if (progress) {
        progress = { ...progress, stage };
    }
}

/**
 * Deletes something that is no longer wanted, and carries on if it will not go.
 *
 * Every use of this is cleaning up after something else, on a path that is already reporting its own
 * outcome. A leftover temporary file is worth a line in the log; it is not worth replacing the answer
 * the caller was about to give, and on Windows a file another process has briefly opened — a virus
 * scanner, an indexer — is a failure that says nothing about the operation at hand.
 */
export function removeQuietly(target: string, options: { recursive?: boolean } = {}): void {
    try {
        // `recursive` is spelled out rather than passed through: `fs.rmSync` merges the options over
        // its defaults, so a property that is present and undefined replaces the default rather than
        // leaving it alone, and every call that omitted it failed its own type check.
        fs.rmSync(target, { force: true, recursive: options.recursive === true });
    } catch (e) {
        getLog().error(`Could not remove a temporary file after a restore: ${messageOf(e)}`);
    }
}

/**
 * Releases a stream's file handle and waits for the operating system to agree that it is released.
 *
 * Waiting is the point: `destroy()` only asks, and the handle is still open until `close` fires.
 * Anything that then tries to delete or replace the file on Windows fails until it does.
 */
function closeStream(stream: NodeJS.EventEmitter & { closed: boolean; destroy(): void }): Promise<void> {
    if (stream.closed) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        stream.once("close", () => resolve());
        stream.destroy();
    });
}

function stagingDirectory(): string {
    return path.join(dataDir.TMP_DIR, "restore");
}

function freshCandidatePath(): string {
    const directory = stagingDirectory();
    fs.mkdirSync(directory, { recursive: true });

    return path.join(directory, "candidate.db");
}

/**
 * Moves a file to where it is wanted, falling back to a copy across filesystem boundaries — which is
 * where a relocated temporary directory can put it.
 */
function moveInto(source: string, destination: string): void {
    try {
        fs.renameSync(source, destination);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") {
            throw e;
        }

        fs.copyFileSync(source, destination);
        fs.rmSync(source, { force: true });
    }
}

/** Puts the database that was set aside back, for a restore that got no further. */
function putBack(setAside: string, document: string): void {
    if (!fs.existsSync(setAside)) {
        return;
    }

    try {
        removeDatabaseFiles(document);
        fs.renameSync(setAside, document);
    } catch (e) {
        // Nothing else can be done from here, and the marker is still in place: the next start
        // finds it and puts the database back before anything opens it.
        getLog().error(`The previous database could not be put back: ${messageOf(e)}`);
    }
}

/** Re-attaches after a rollback. A failure here is reported, not raised: the caller is already failing. */
function attachQuietly(document: string): void {
    try {
        getSql().attachFromFile(document, config.General.readOnly);
    } catch (e) {
        getLog().error(`The database could not be re-opened after a failed restore: ${messageOf(e)}`);
    }
}

function removeDatabaseFiles(document: string): void {
    fs.rmSync(document, { force: true });
    removeSidecars(document);
}

function removeSidecars(document: string): void {
    fs.rmSync(`${document}-wal`, { force: true });
    fs.rmSync(`${document}-shm`, { force: true });
}

function asFailure(e: unknown): RestoreFailure {
    if (e instanceof RestoreFailure) {
        return e;
    }
    if (isBackupContainerError(e)) {
        return new RestoreFailure(e.reason, e.message);
    }

    return new RestoreFailure("swap-failed", messageOf(e));
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
