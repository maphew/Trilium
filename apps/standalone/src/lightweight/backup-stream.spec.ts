import { getSql } from "@triliumnext/core";
import { describe, expect, it } from "vitest";

import {
    openBackupDestination,
    type SnapshotConnection,
    type SnapshotStatement,
    streamDatabasePages,
    type SyncFileAccess
} from "./backup-stream.js";
import BrowserSqlProvider from "./sql_provider.js";

// The sqlite-wasm module can only be initialized once per worker (test_setup.ts already does it
// for core), so every provider here borrows that module rather than calling initWasm() again.
type WithSqlite3 = {
    sqlite3: {
        capi: { sqlite3_js_db_export(db: unknown): Uint8Array };
        oo1: { DB: new (filename: string, flags?: string) => SnapshotConnection };
    };
};
type WithDb = { db: SnapshotConnection };

function newProviderWithModule(): BrowserSqlProvider {
    const provider = new BrowserSqlProvider();
    (provider as unknown as WithSqlite3).sqlite3 =
        (getSql() as unknown as { dbConnection: unknown } as { dbConnection: WithSqlite3 })
            .dbConnection.sqlite3;
    return provider;
}

function rawConnection(provider: BrowserSqlProvider): SnapshotConnection {
    return (provider as unknown as WithDb).db;
}

async function drain(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            break;
        }
        chunks.push(value);
    }

    const whole = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
        whole.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return whole;
}

describe("streamDatabasePages against the real engine", () => {
    it("streams a database as its exact file bytes", async () => {
        const provider = newProviderWithModule();
        provider.loadFromMemory();
        provider.exec("CREATE TABLE t (id INTEGER PRIMARY KEY, payload BLOB)");
        // Enough rows to span several batches even at the smallest page size.
        provider.exec("INSERT INTO t (payload) SELECT randomblob(1000) "
            + "FROM (WITH RECURSIVE c(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM c WHERE n < 500) "
            + "SELECT n FROM c)");

        const connection = rawConnection(provider);
        const exported = (provider as unknown as WithSqlite3).sqlite3.capi
            .sqlite3_js_db_export(connection);

        const { byteSize, stream } = streamDatabasePages(connection);
        const streamed = await drain(stream);

        expect(byteSize).toBe(exported.byteLength);
        expect(streamed.byteLength).toBe(byteSize);
        expect(streamed).toEqual(exported);
    });

    it("round-trips through VACUUM INTO the way a backup does", async () => {
        const provider = newProviderWithModule();
        provider.loadFromMemory();
        provider.exec("CREATE TABLE notes (id INTEGER PRIMARY KEY, title TEXT)");
        provider.exec("INSERT INTO notes (title) VALUES ('first'), ('second')");
        // Deleted rows leave freelist pages behind, which the vacuum must drop.
        provider.exec("INSERT INTO notes (id, title) VALUES (99, 'doomed')");
        provider.exec("DELETE FROM notes WHERE id = 99");

        provider.exec("VACUUM INTO 'backup-stream-snapshot.db'");
        // Opened the way the backup service opens a pool snapshot, minus the pool: straight oo1.
        const sqlite3 = (provider as unknown as WithSqlite3).sqlite3;
        const snapshot = new sqlite3.oo1.DB("backup-stream-snapshot.db", "r");

        const streamed = await drain(streamDatabasePages(snapshot).stream);

        const restored = newProviderWithModule();
        restored.loadFromBuffer(streamed);
        expect(restored.prepare("SELECT count(*) FROM notes").pluck().get([])).toBe(2);
        expect(restored.prepare("SELECT title FROM notes ORDER BY id").pluck().all())
            .toEqual([ "first", "second" ]);
        restored.close();
        provider.close();
    });
});

/** A connection serving `pageCount` constant-filled pages of `pageSize` bytes. */
function fakeConnection(pageSize: number, pageCount: number): SnapshotConnection & {
    closed: number;
    finalized: number;
} {
    const self = {
        closed: 0,
        finalized: 0,
        selectValue(sql: string) {
            return sql.includes("page_size") ? pageSize : pageCount;
        },
        prepare(): SnapshotStatement {
            let bound = 0;
            return {
                bind(values: unknown[]) {
                    bound = values[0] as number;
                    return this;
                },
                step: () => bound >= 1 && bound <= pageCount,
                get: () => [ new Uint8Array(pageSize).fill(bound & 0xff) ],
                reset: () => undefined,
                finalize: () => void self.finalized++
            };
        },
        close: () => void self.closed++
    };
    return self;
}

describe("streamDatabasePages error handling", () => {
    it("refuses a database that reports no usable page size", () => {
        const connection = fakeConnection(0, 4);
        expect(() => streamDatabasePages(connection)).toThrow(/page_size/);
    });

    it("names sqlite_dbpage when the statement cannot be prepared", () => {
        const connection = fakeConnection(512, 4);
        connection.prepare = () => {
            throw new Error("no such table: sqlite_dbpage");
        };
        expect(() => streamDatabasePages(connection)).toThrow(/sqlite_dbpage/);
    });

    it("errors the stream and releases the connection when a page goes missing", async () => {
        const connection = fakeConnection(512, 4);
        const statement = connection.prepare("");
        statement.step = () => false;
        connection.prepare = () => statement;

        const { stream } = streamDatabasePages(connection);
        await expect(drain(stream)).rejects.toThrow(/page 1/);
        expect(connection.closed).toBe(1);
        expect(connection.finalized).toBe(1);
    });

    it("errors the stream when a page comes back the wrong size", async () => {
        const connection = fakeConnection(512, 4);
        const statement = connection.prepare("");
        statement.get = () => [ new Uint8Array(100) ];
        connection.prepare = () => statement;

        await expect(drain(streamDatabasePages(connection).stream)).rejects.toThrow(/malformed/);
        expect(connection.closed).toBe(1);
    });

    it("releases the connection exactly once when the stream is cancelled", async () => {
        const connection = fakeConnection(512, 4);
        const { stream } = streamDatabasePages(connection);

        const reader = stream.getReader();
        await reader.read();
        await reader.cancel();

        expect(connection.closed).toBe(1);
        expect(connection.finalized).toBe(1);
    });
});

/** An in-memory file recording every write, able to act short or full on demand. */
function fakeFile(maxWrite = Number.POSITIVE_INFINITY): SyncFileAccess & {
    bytes: Uint8Array;
    truncated: number[];
    flushes: number;
    closes: number;
} {
    const self = {
        bytes: new Uint8Array(0),
        truncated: [] as number[],
        flushes: 0,
        closes: 0,
        write(buffer: Uint8Array, options?: { at?: number }) {
            const at = options?.at ?? 0;
            const count = Math.min(buffer.byteLength, maxWrite);
            if (at + count > self.bytes.byteLength) {
                const grown = new Uint8Array(at + count);
                grown.set(self.bytes);
                self.bytes = grown;
            }
            self.bytes.set(buffer.subarray(0, count), at);
            return count;
        },
        truncate: (size: number) => void self.truncated.push(size),
        flush: () => void self.flushes++,
        close: () => void self.closes++
    };
    return self;
}

describe("openBackupDestination", () => {
    it("writes sequentially, patches at an offset after close, and releases once", async () => {
        const file = fakeFile();
        const destination = openBackupDestination(file);
        expect(file.truncated).toEqual([ 0 ]);

        const writer = destination.writable.getWriter();
        await writer.write(new Uint8Array([ 1, 2, 3 ]));
        await writer.write(new Uint8Array([ 4, 5 ]));
        await writer.close();

        // The patch lands while the file is still open, as the container's digest fixup does.
        destination.patch(1, new Uint8Array([ 9, 9 ]));
        destination.close();
        destination.close();

        expect(Array.from(file.bytes)).toEqual([ 1, 9, 9, 4, 5 ]);
        expect(file.closes).toBe(1);
        expect(file.flushes).toBeGreaterThan(0);
    });

    it("loops short writes until the chunk is fully written", async () => {
        const file = fakeFile(2);
        const destination = openBackupDestination(file);

        const writer = destination.writable.getWriter();
        await writer.write(new Uint8Array([ 1, 2, 3, 4, 5 ]));
        await writer.close();
        destination.close();

        expect(Array.from(file.bytes)).toEqual([ 1, 2, 3, 4, 5 ]);
    });

    it("reports a file that stops accepting writes instead of spinning", async () => {
        const file = fakeFile(0);
        const destination = openBackupDestination(file);

        const writer = destination.writable.getWriter();
        await expect(writer.write(new Uint8Array([ 1 ]))).rejects.toThrow(/stopped accepting/);
        destination.close();
    });
});
