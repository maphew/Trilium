/**
 * Streams a database between the SAH pool and a plain OPFS file without ever holding it whole.
 *
 * The pool has no streaming read: its `exportFile` builds the entire file as one array, which for
 * a database measured in gigabytes is the difference between a backup and a crashed tab. What it
 * does have is SQLite itself, and SQLite can serve its own file a page at a time through the
 * `sqlite_dbpage` table, the same mechanism the official `sqlite3_rsync` utility is built on. For
 * a quiesced, freshly `VACUUM INTO`-ed database the pages in order *are* the file, byte for byte,
 * and SQLite hands them over without this code knowing anything about their layout.
 *
 * The two halves here are deliberately dumb pipes: {@link streamDatabasePages} turns an open
 * database into a `ReadableStream` of page batches, and {@link openBackupDestination} turns a
 * synchronous OPFS file handle into the `WritableStream`-plus-random-access the backup container
 * writer needs. What flows between them, and whether a container wraps it, is the caller's story.
 *
 * @module
 */

/** How many pages travel per stream chunk: 1 MiB at the default 8 KiB page size. */
const BATCH_PAGES = 128;

/** What the page streamer asks of a database connection. `oo1.DB` matches it as it stands. */
export interface SnapshotConnection {
    selectValue(sql: string, bind?: unknown[]): unknown;
    prepare(sql: string): SnapshotStatement;
    close(): void;
}

/** The slice of a prepared statement the page reads use. */
export interface SnapshotStatement {
    bind(values: unknown[]): unknown;
    step(): boolean;
    get(target: unknown[]): unknown[];
    reset(): unknown;
    finalize(): unknown;
}

export interface DatabaseStream {
    /** Exact size of the streamed database, known before the first byte flows. */
    byteSize: number;
    stream: ReadableStream<Uint8Array>;
}

/**
 * Streams the database open on `db` as its exact file bytes, a batch of pages at a time.
 *
 * The connection is taken over: it is closed when the stream ends, errors, or is cancelled, and
 * must not be used by anyone else meanwhile. The database must be quiescent and not in WAL mode,
 * which is what `VACUUM INTO` produces; a database being written to mid-stream would hand over
 * pages of two different files.
 *
 * @throws Error before any stream exists when the engine lacks `sqlite_dbpage`, so a caller fails
 *   before it has created a destination to clean up.
 */
export function streamDatabasePages(db: SnapshotConnection): DatabaseStream {
    let pageSize: number;
    let pageCount: number;
    let statement: SnapshotStatement;
    try {
        pageSize = countOf(db.selectValue("PRAGMA page_size"), "page_size");
        pageCount = countOf(db.selectValue("PRAGMA page_count"), "page_count");
        statement = preparePageReader(db);
    } catch (e) {
        // The connection was taken over, so it is not left open on the way out either.
        db.close();
        throw e;
    }

    let nextPage = 1;
    let released = false;
    const release = () => {
        if (!released) {
            released = true;
            statement.finalize();
            db.close();
        }
    };

    return {
        byteSize: pageSize * pageCount,
        stream: new ReadableStream<Uint8Array>({
            pull(controller) {
                try {
                    if (nextPage > pageCount) {
                        release();
                        controller.close();
                        return;
                    }

                    const pages = Math.min(BATCH_PAGES, pageCount - nextPage + 1);
                    const batch = new Uint8Array(pages * pageSize);
                    for (let index = 0; index < pages; index++, nextPage++) {
                        batch.set(readPage(statement, nextPage, pageSize), index * pageSize);
                    }
                    controller.enqueue(batch);
                } catch (e) {
                    release();
                    controller.error(e);
                }
            },
            cancel: release
        })
    };
}

/** The slice of `FileSystemSyncAccessHandle` a backup write needs, kept structural for tests. */
export interface SyncFileAccess {
    write(buffer: Uint8Array, options?: { at?: number }): number;
    truncate(newSize: number): void;
    flush(): void;
    close(): void;
}

export interface BackupDestination {
    /** Takes the payload in order. Closing it flushes but keeps the file open for {@link patch}. */
    writable: WritableStream<Uint8Array>;
    /** Writes at an absolute offset: the digest a container learns only after its payload. */
    patch(offset: number, data: Uint8Array): void;
    /** Flushes and releases the file. Safe to call more than once, and meant for a `finally`. */
    close(): void;
}

/**
 * Turns a synchronous OPFS file handle into a backup destination.
 *
 * The handle is truncated on open, so a leftover from an interrupted attempt is overwritten rather
 * than appended to, and it stays open across the writable's own close: the container writer patches
 * its header digest *after* it has ended the payload stream, and reopening the file between the two
 * would be a second handle on a file the first still locks.
 */
export function openBackupDestination(access: SyncFileAccess): BackupDestination {
    access.truncate(0);
    let offset = 0;
    let open = true;

    return {
        writable: new WritableStream<Uint8Array>({
            write(chunk) {
                offset += writeFully(access, chunk, offset);
            },
            close() {
                access.flush();
            }
        }),
        patch(at, data) {
            writeFully(access, data, at);
        },
        close() {
            if (open) {
                open = false;
                access.flush();
                access.close();
            }
        }
    };
}

function preparePageReader(db: SnapshotConnection): SnapshotStatement {
    try {
        return db.prepare("SELECT data FROM sqlite_dbpage WHERE pgno = ?");
    } catch (e) {
        throw new Error("This SQLite build cannot serve database pages (sqlite_dbpage is "
            + `missing), so nothing can be backed up: ${messageOf(e)}`);
    }
}

/** One page, checked to be exactly a page: anything else means the file is not what it claims. */
function readPage(statement: SnapshotStatement, pageNumber: number, pageSize: number): Uint8Array {
    statement.bind([ pageNumber ]);
    try {
        if (!statement.step()) {
            throw new Error(`The database did not serve page ${pageNumber}.`);
        }

        const data = statement.get([])[0];
        if (!(data instanceof Uint8Array) || data.byteLength !== pageSize) {
            throw new Error(`Page ${pageNumber} came back malformed.`);
        }
        return data;
    } finally {
        statement.reset();
    }
}

/** A pragma answer as the positive integer it must be, or the reason it is not a database. */
function countOf(value: unknown, name: string): number {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
        throw new Error(`The database reports no usable ${name} (got ${String(value)}).`);
    }
    return value;
}

/**
 * Writes all of `data` at `at`, looping in case the handle takes it piecemeal. The specification
 * lets `write` return short; a handle doing so repeatedly without progress is reported rather than
 * spun on.
 */
function writeFully(access: SyncFileAccess, data: Uint8Array, at: number): number {
    let written = 0;
    while (written < data.byteLength) {
        const count = access.write(data.subarray(written), { at: at + written });
        if (!(count > 0)) {
            throw new Error("The backup file stopped accepting writes.");
        }
        written += count;
    }
    return written;
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
