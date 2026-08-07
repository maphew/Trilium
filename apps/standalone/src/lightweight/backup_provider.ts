import {
    FIXED_HEADER_BYTES,
    peekBackupContainer,
    writeBackupContainer
} from "@triliumnext/backup-container/web";
import type { DatabaseBackup, SetupExistingBackup } from "@triliumnext/commons";
import { BackupOptionsService, BackupService, getSql, sync_mutex as syncMutex } from "@triliumnext/core";

import {
    type BackupDestination,
    type DatabaseStream,
    openBackupDestination,
    type SnapshotConnection,
    streamDatabasePages,
    type SyncFileAccess
} from "./backup-stream.js";

const BACKUP_DIR_NAME = "backups";

/** Backups that are compressed are containers rather than plain database copies, as on the server. */
const CONTAINER_EXTENSION = ".tnbackup";
const DATABASE_EXTENSION = ".db";

/**
 * Marks the backup it names as still being written: `x.db.part` disowns `x.db`. Presence is the
 * whole signal, because OPFS offers no rename old enough to rely on, so a finished backup cannot
 * move into place — instead it is written under its final name and owned up to only when this
 * marker goes away.
 */
const PARTIAL_SUFFIX = ".part";

/** The pool entry `VACUUM INTO` fills. Never one of the names the live database alternates between. */
const SNAPSHOT_NAME = "/backup-snapshot.db";

/** Pool slots a snapshot needs: the file itself and the rollback journal the vacuum gives it. */
const SNAPSHOT_SLOTS = 2;

/** Space kept free beyond what a backup needs, so it never lands exactly on the quota. */
const QUOTA_MARGIN_BYTES = 32 * 1024 * 1024;

/** The slice of the SQL provider a backup needs. `BrowserSqlProvider` matches it as it stands. */
export interface BackupSqlAccess {
    exec(query: string): void;
    readonly sahPool?: SnapshotPool;
}

/** The slice of the SAH pool used here, kept structural so tests need not build a real one. */
export interface SnapshotPool {
    /**
     * Opens a database on the named entry. What comes back is used as a {@link SnapshotConnection};
     * it is typed loose only because the sqlite-wasm class's overloads defeat structural matching.
     */
    OpfsSAHPoolDb: new (filename: string) => unknown;
    unlink(filename: string): boolean;
    getFileCount(): number;
    getCapacity(): number;
    addCapacity(entries: number): Promise<number>;
}

/**
 * Standalone backup service: streams the database into a file under OPFS `/backups`.
 *
 * A backup is taken in two moves, neither of which ever holds the database whole. `VACUUM INTO`
 * writes a consistent, compacted snapshot into a scratch entry of the SAH pool, through SQLite's
 * own pager and with no more memory than its page cache. The snapshot is then streamed out page by
 * page and lands in `/backups` either as a plain `.db` copy or, when compression is on, wrapped in
 * a backup container. The whole run sits under the sync mutex, like the server's, so it never
 * snapshots a database mid-sync.
 *
 * Encryption is not offered yet: the container needs a passphrase and the browser has no keyring
 * to keep one, so encrypting waits on a flow that asks the user at backup time.
 */
export default class StandaloneBackupService extends BackupService {
    private backupDir: FileSystemDirectoryHandle | null = null;
    private opfsAvailable: boolean | null = null;

    constructor(
        options: BackupOptionsService,
        private readonly sqlAccess: () => BackupSqlAccess | undefined = () => undefined
    ) {
        super(options);
    }

    override scheduleBackups(): void {
        // No scheduled backups on standalone/mobile
    }

    override async backupNow(name: string): Promise<string> {
        // Sanitized like the server's, and to the same end: the name reaches a filename.
        const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, "") || "unnamed";
        const fileName = `backup-${sanitized}${this.backupExtension()}`;
        const nominalPath = `/${BACKUP_DIR_NAME}/${fileName}`;

        if (!this.isOpfsAvailable()) {
            console.warn(`[Backup] OPFS not available, skipping backup: ${fileName}`);
            return nominalPath;
        }

        try {
            await this.writeBackup(fileName);
            console.log(`[Backup] Created backup: ${fileName}`);
        } catch (error) {
            // Logged rather than thrown: the callers are the scheduler and the pre-migration
            // hook, and neither must be stopped by a backup that could not be taken.
            console.error(`[Backup] Failed to create backup ${fileName}:`, error);
        }
        return nominalPath;
    }

    override async backupAs(
        baseName: string,
        onProgress?: (fraction: number) => void
    ): Promise<SetupExistingBackup> {
        if (!this.isOpfsAvailable()) {
            throw new Error("Backups need OPFS, which this browser does not provide.");
        }

        // As it stands but for path separators, which OPFS names cannot carry.
        const fileName = `${baseName.replace(/[/\\]/g, "-")}${this.backupExtension()}`;
        await this.writeBackup(fileName, onProgress);

        return {
            fileName,
            filePath: `/${BACKUP_DIR_NAME}/${fileName}`,
            directoryPath: `/${BACKUP_DIR_NAME}`,
            fileSize: await this.backupFileSize(fileName),
            encrypted: false
        };
    }

    override async getExistingBackups(): Promise<DatabaseBackup[]> {
        if (!this.isOpfsAvailable()) {
            return [];
        }

        try {
            const dir = await this.ensureBackupDirectory();
            if (!dir) {
                return [];
            }

            const entries = await fileEntriesIn(dir);
            const names = new Set(entries.map(([ name ]) => name));
            const backups: DatabaseBackup[] = [];

            for (const [ name, handle ] of entries) {
                // A file its marker disowns is mid-write or abandoned, not a backup.
                if (!isBackupFileName(name) || names.has(`${name}${PARTIAL_SUFFIX}`)) {
                    continue;
                }

                const file = await handle.getFile();
                backups.push({
                    fileName: name,
                    filePath: `/${BACKUP_DIR_NAME}/${name}`,
                    mtime: new Date(file.lastModified),
                    fileSize: file.size,
                    ...await describeContainer(file, name)
                });
            }

            // Sort by modification time, newest first
            backups.sort((a, b) => b.mtime.getTime() - a.mtime.getTime());
            return backups;
        } catch (error) {
            console.error("[Backup] Failed to list backups:", error);
            return [];
        }
    }

    /**
     * Delete a backup by filename.
     */
    async deleteBackup(fileName: string): Promise<void> {
        if (!this.isOpfsAvailable()) {
            return;
        }

        try {
            const dir = await this.ensureBackupDirectory();
            if (!dir) {
                return;
            }
            await dir.removeEntry(fileName);
            await removeEntryQuietly(dir, `${fileName}${PARTIAL_SUFFIX}`);
            console.log(`[Backup] Deleted backup: ${fileName}`);
        } catch (error) {
            console.error(`[Backup] Failed to delete backup ${fileName}:`, error);
        }
    }

    override async getBackupContent(filePath: string): Promise<Uint8Array | null> {
        if (!this.isOpfsAvailable()) {
            return null;
        }

        try {
            const dir = await this.ensureBackupDirectory();
            if (!dir) {
                return null;
            }

            // Extract fileName from filePath (e.g. "/backups/backup-now.db" -> "backup-now.db")
            const fileName = filePath.split("/").pop();
            if (!fileName || !isBackupFileName(fileName)) {
                return null;
            }

            const fileHandle = await dir.getFileHandle(fileName);
            const file = await fileHandle.getFile();
            const data = await file.arrayBuffer();
            return new Uint8Array(data);
        } catch (error) {
            console.error(`[Backup] Failed to get backup content ${filePath}:`, error);
            return null;
        }
    }

    /**
     * Streams the database into `/backups/<fileName>`, replacing what was there under that name.
     *
     * The snapshot is vacuumed into the pool, streamed out into the destination, and unlinked
     * again whatever happens; the destination is disowned by its marker for as long as it is
     * incomplete. Failing before the destination was ever opened leaves an older backup of the
     * same name exactly as it was.
     */
    private async writeBackup(
        fileName: string,
        onProgress?: (fraction: number) => void
    ): Promise<void> {
        const access = this.sqlAccess();
        const pool = access?.sahPool;
        if (!access || !pool) {
            throw new Error("The live database is not in the SAH pool, so there is nothing to back up.");
        }

        const dir = await this.ensureBackupDirectory();
        if (!dir) {
            throw new Error("The backup directory could not be opened.");
        }

        // The mutex serializes backups too, which is what lets leftovers be cleaned here.
        await syncMutex.doExclusively(async () => {
            await removeAbandonedPartials(dir);
            await this.ensureFreeSpace(this.databaseSize());

            await reserveSnapshotSlots(pool);
            removeSnapshotQuietly(pool);
            access.exec(`VACUUM INTO '${SNAPSHOT_NAME}'`);

            try {
                const connection = new pool.OpfsSAHPoolDb(SNAPSHOT_NAME) as SnapshotConnection;
                const snapshot = streamDatabasePages(connection);
                await this.writeDestination(dir, fileName, snapshot, onProgress);
            } finally {
                removeSnapshotQuietly(pool);
            }
        });

        await removeCounterpart(dir, fileName);
    }

    /** Streams the snapshot into the marker-guarded destination file, consuming it either way. */
    private async writeDestination(
        dir: FileSystemDirectoryHandle,
        fileName: string,
        snapshot: DatabaseStream,
        onProgress?: (fraction: number) => void
    ): Promise<void> {
        const marker = `${fileName}${PARTIAL_SUFFIX}`;
        let destination: BackupDestination | undefined;

        try {
            // Checked against the snapshot's exact size, which the first check could only guess at.
            await this.ensureFreeSpace(snapshot.byteSize);

            await dir.getFileHandle(marker, { create: true });
            destination = openBackupDestination(await syncAccessTo(dir, fileName));

            if (this.isContainerFormat()) {
                await writeBackupContainer(snapshot.stream, destination.writable, {
                    compress: true,
                    plaintextSize: snapshot.byteSize,
                    onProgress,
                    patchHeader: destination.patch
                });
            } else {
                await snapshot.stream.pipeTo(destination.writable);
            }

            destination.close();
            await removeEntryQuietly(dir, marker);
            onProgress?.(1);
        } catch (error) {
            await cancelQuietly(snapshot.stream);
            closeQuietly(destination);
            if (destination) {
                // Only what this run ruined: before the destination opened, an older backup of
                // the same name is still intact and stays.
                await removeEntryQuietly(dir, fileName);
            }
            await removeEntryQuietly(dir, marker);
            throw error;
        }
    }

    /**
     * Refuses work that `needed` more bytes of OPFS would not fit. A browser that cannot say is
     * not refused: a false "no" here loses a backup, while a false "yes" fails mid-write and is
     * cleaned up.
     */
    private async ensureFreeSpace(needed: number): Promise<void> {
        const estimate = await navigator.storage.estimate?.().catch(() => undefined);
        if (typeof estimate?.quota !== "number" || typeof estimate.usage !== "number") {
            return;
        }

        const available = estimate.quota - estimate.usage;
        if (available < needed + QUOTA_MARGIN_BYTES) {
            throw new Error("Not enough browser storage for a backup: it needs about "
                + `${toMiB(needed)} MiB and ${toMiB(Math.max(available, 0))} MiB are free.`);
        }
    }

    /** Whether backups are wrapped in a container, which is what compression takes. */
    private isContainerFormat(): boolean {
        return this.options.getOptionOrNull("backupEnableCompression") === "true";
    }

    private backupExtension(): string {
        return this.isContainerFormat() ? CONTAINER_EXTENSION : DATABASE_EXTENSION;
    }

    /** How many bytes the live database occupies, asked of the database rather than of a copy. */
    private databaseSize(): number {
        const size = getSql().getValue<number>(
            "SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()"
        );

        return typeof size === "number" ? size : 0;
    }

    private async backupFileSize(fileName: string): Promise<number> {
        const dir = await this.ensureBackupDirectory();
        if (!dir) {
            return 0;
        }

        const handle = await dir.getFileHandle(fileName);
        return (await handle.getFile()).size;
    }

    private isOpfsAvailable(): boolean {
        if (this.opfsAvailable === null) {
            this.opfsAvailable = typeof navigator !== "undefined"
                && navigator.storage
                && typeof navigator.storage.getDirectory === "function";
        }
        return this.opfsAvailable;
    }

    private async ensureBackupDirectory(): Promise<FileSystemDirectoryHandle | null> {
        if (!this.isOpfsAvailable()) {
            return null;
        }

        if (!this.backupDir) {
            const root = await navigator.storage.getDirectory();
            this.backupDir = await root.getDirectoryHandle(BACKUP_DIR_NAME, { create: true });
        }
        return this.backupDir;
    }
}

/** Mirrors the server's listing filter, capitals and all: setup backups start with one. */
function isBackupFileName(name: string): boolean {
    return name.toLowerCase().includes("backup")
        && (name.endsWith(DATABASE_EXTENSION) || name.endsWith(CONTAINER_EXTENSION));
}

/**
 * What a container is, read from its own header rather than from today's options: a backup keeps
 * the shape it was written in, whatever the settings have since become. A file whose header does
 * not parse is listed as a plain one rather than not at all.
 */
async function describeContainer(file: Blob, fileName: string): Promise<Partial<DatabaseBackup>> {
    if (!fileName.endsWith(CONTAINER_EXTENSION)) {
        return {};
    }

    try {
        const head = new Uint8Array(await file.slice(0, FIXED_HEADER_BYTES).arrayBuffer());
        const info = peekBackupContainer(head);
        if (!info) {
            return {};
        }

        return {
            compressed: info.compressed,
            encrypted: info.encrypted,
            // Recorded as 0 when the writer did not know it, which reads the same as "not stated".
            plaintextSize: info.plaintextSize > 0 ? info.plaintextSize : undefined
        };
    } catch {
        return {};
    }
}

/** Every file in the directory, gathered so the listing can look names up while it walks them. */
async function fileEntriesIn(dir: FileSystemDirectoryHandle): Promise<[string, FileSystemFileHandle][]> {
    const entries: [string, FileSystemFileHandle][] = [];
    for await (const [ name, handle ] of dir.entries()) {
        if (handle.kind === "file") {
            entries.push([ name, handle as FileSystemFileHandle ]);
        }
    }
    return entries;
}

/** Sweeps out markers and the unfinished backups they disown, from runs that never got to. */
async function removeAbandonedPartials(dir: FileSystemDirectoryHandle): Promise<void> {
    for (const [ name ] of await fileEntriesIn(dir)) {
        if (name.endsWith(PARTIAL_SUFFIX)) {
            await removeEntryQuietly(dir, name.slice(0, -PARTIAL_SUFFIX.length));
            await removeEntryQuietly(dir, name);
        }
    }
}

/** One backup name, one file: a container retires the plain copy it replaces, and vice versa. */
async function removeCounterpart(dir: FileSystemDirectoryHandle, fileName: string): Promise<void> {
    const counterpart = fileName.endsWith(CONTAINER_EXTENSION)
        ? `${fileName.slice(0, -CONTAINER_EXTENSION.length)}${DATABASE_EXTENSION}`
        : `${fileName.slice(0, -DATABASE_EXTENSION.length)}${CONTAINER_EXTENSION}`;

    await removeEntryQuietly(dir, counterpart);
}

async function syncAccessTo(dir: FileSystemDirectoryHandle, name: string): Promise<SyncFileAccess> {
    const handle = await dir.getFileHandle(name, { create: true });
    return await handle.createSyncAccessHandle();
}

/** Adds slots when the pool is too full for a snapshot and the journal the vacuum gives it. */
async function reserveSnapshotSlots(pool: SnapshotPool): Promise<void> {
    const free = pool.getCapacity() - pool.getFileCount();
    if (free < SNAPSHOT_SLOTS) {
        await pool.addCapacity(SNAPSHOT_SLOTS - free);
    }
}

/** Removes the snapshot entry, if it is there at all. Never the reason a backup fails. */
function removeSnapshotQuietly(pool: SnapshotPool): void {
    try {
        pool.unlink(SNAPSHOT_NAME);
    } catch {
        // A leftover entry costs a pool slot, which the next backup reclaims here anyway.
    }
}

async function removeEntryQuietly(dir: FileSystemDirectoryHandle, name: string): Promise<void> {
    try {
        await dir.removeEntry(name);
    } catch {
        // Already absent, which is what removing it was for.
    }
}

/** Releases an unconsumed snapshot stream; one already consumed or errored refuses, done is done. */
async function cancelQuietly(stream: ReadableStream<Uint8Array>): Promise<void> {
    try {
        await stream.cancel();
    } catch {
        // Locked or errored: whoever consumed it has released it.
    }
}

/** Closes on the failure path, where a second error would only mask the one being reported. */
function closeQuietly(destination: BackupDestination | undefined): void {
    try {
        destination?.close();
    } catch {
        // The write failure being thrown past this is the story; a broken flush on top is not.
    }
}

function toMiB(bytes: number): number {
    return Math.round(bytes / (1024 * 1024));
}
