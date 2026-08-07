import { writeBackupContainer } from "@triliumnext/backup-container";
import type { SAHPoolUtil } from "@sqlite.org/sqlite-wasm";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    DEFAULT_DATABASE_NAME,
    readCurrentDatabaseName,
    type RestoreProgress,
    restoreDatabase,
    type RestoreTarget
} from "./database_restore.js";

const CANDIDATE_NAME = "/trilium.candidate.db";
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-standalone-restore-"));

/**
 * Bytes that start the way SQLite does, page size and all: the reader checks the header of what it
 * unwraps, and the service checks the header of what it is given.
 */
function databaseBytes(size = 8192): Uint8Array {
    const bytes = new Uint8Array(size);
    bytes.set(Uint8Array.from("SQLite format 3\0", (c) => c.charCodeAt(0)));
    // Page size, big-endian: 4096.
    bytes[16] = 0x10;
    bytes[17] = 0x00;
    bytes.fill(0x42, 100);

    return bytes;
}

/** Wraps `payload` the way a backup does, using the writer the backup service itself uses. */
async function containerOf(payload: Uint8Array, options: { passphrase?: string; compress?: boolean } = {}) {
    const filePath = path.join(tempRoot, `backup-${Math.random().toString(36).slice(2)}.tnbackup`);
    fs.writeFileSync(filePath, "");

    await writeBackupContainer(
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Node stream over the bytes.
        (await import("stream")).Readable.from([ Buffer.from(payload) ]) as any,
        fs.createWriteStream(filePath),
        {
            compress: options.compress ?? false,
            passphrase: options.passphrase,
            plaintextSize: payload.length,
            patchHeader: async (offset, data) => {
                const handle = await fsp.open(filePath, "r+");
                try {
                    await handle.write(data, 0, data.length, offset);
                } finally {
                    await handle.close();
                }
            }
        }
    );

    return new Blob([ fs.readFileSync(filePath) ]);
}

/** A pool that keeps its databases in memory and answers the checks however the test says. */
function fakePool() {
    const files = new Map<string, Uint8Array>();
    const answers = {
        integrity: "ok",
        tables: [ "options", "notes", "branches", "blobs" ],
        options: { initialized: "true", dbVersion: "240" } as Record<string, string | undefined>
    };

    class FakeDb {
        constructor(readonly name: string) {
            if (!files.has(name)) {
                throw new Error(`no such database: ${name}`);
            }
        }
        selectValue(sql: string, params?: unknown[]) {
            if (sql.includes("quick_check")) return answers.integrity;
            return answers.options[String((params ?? [])[0])];
        }
        selectValues() {
            return answers.tables;
        }
        close() { /* nothing to release */ }
    }

    const pool = {
        OpfsSAHPoolDb: FakeDb,
        getCapacity: () => 6,
        getFileCount: () => files.size,
        addCapacity: async () => 1,
        unlink: (name: string) => files.delete(name),
        importDb: async (name: string, pull: () => Promise<Uint8Array | undefined>) => {
            const chunks: Uint8Array[] = [];
            for (let chunk = await pull(); chunk; chunk = await pull()) {
                chunks.push(chunk);
            }
            files.set(name, concat(chunks));

            return files.get(name)?.length ?? 0;
        }
    };

    return { files, answers, pool: pool as unknown as SAHPoolUtil };
}

function concat(chunks: Uint8Array[]): Uint8Array {
    const total = chunks.reduce((size, chunk) => size + chunk.length, 0);
    const joined = new Uint8Array(total);
    let at = 0;
    for (const chunk of chunks) {
        joined.set(chunk, at);
        at += chunk.length;
    }

    return joined;
}

/** The database the restore acts on, recording what it was asked to do and in what order. */
function fakeTarget(pool: SAHPoolUtil, options: { failToOpen?: string } = {}) {
    const acted: string[] = [];
    const target: RestoreTarget = {
        pool,
        close: () => { acted.push("close"); },
        open: (dbName) => {
            if (dbName === options.failToOpen) {
                acted.push(`open-failed:${dbName}`);
                throw new Error("database is locked");
            }
            acted.push(`open:${dbName}`);
        }
    };

    return { target, acted };
}

/** Stands in for the origin's private filesystem, which is where the pointer lives. */
let pointer: string | undefined;

beforeEach(() => {
    pointer = undefined;
    vi.stubGlobal("navigator", {
        storage: {
            getDirectory: async () => ({
                getFileHandle: async (_name: string, opts?: { create?: boolean }) => {
                    if (pointer === undefined && !opts?.create) {
                        throw new Error("NotFoundError");
                    }

                    return {
                        getFile: async () => ({ text: async () => pointer ?? "" }),
                        createWritable: async () => ({
                            write: async (text: string) => { pointer = text; },
                            close: async () => {}
                        })
                    };
                }
            })
        }
    });
});

afterEach(() => vi.unstubAllGlobals());

describe("which database is the live one", () => {
    it("is the original name until a restore says otherwise", async () => {
        await expect(readCurrentDatabaseName()).resolves.toBe(DEFAULT_DATABASE_NAME);
    });

    it("is whatever the last restore wrote down", async () => {
        const { pool } = fakePool();
        const { target } = fakeTarget(pool);

        await restoreDatabase(target, new Blob([ databaseBytes() ]));

        await expect(readCurrentDatabaseName()).resolves.toBe(CANDIDATE_NAME);
    });
});

describe("restoring from a picked backup", () => {
    it("streams a plain database into the pool and makes it live", async () => {
        const { files, pool } = fakePool();
        const { target, acted } = fakeTarget(pool);
        const original = databaseBytes();

        await restoreDatabase(target, new Blob([ original ]));

        expect(files.get(CANDIDATE_NAME)).toEqual(original);
        // Closed, then written down, then opened: the pointer is what makes the swap, and nothing
        // opens until it has been made.
        expect(acted).toEqual([ "close", `open:${CANDIDATE_NAME}` ]);
        expect(pointer).toBe(CANDIDATE_NAME);
    });

    it("unwraps a container back into the database it was made from", async () => {
        const { files, pool } = fakePool();
        const { target } = fakeTarget(pool);
        const original = databaseBytes();

        await restoreDatabase(target, await containerOf(original, { compress: true }));

        expect(files.get(CANDIDATE_NAME)).toEqual(original);
    });

    it("unwraps an encrypted one when it is given the passphrase", async () => {
        const { files, pool } = fakePool();
        const { target } = fakeTarget(pool);
        const original = databaseBytes();
        const backup = await containerOf(original, { passphrase: "hunter2" });

        await restoreDatabase(target, backup, { passphrase: "hunter2" });

        expect(files.get(CANDIDATE_NAME)).toEqual(original);
    });

    it("says what it is doing as it goes", async () => {
        const { pool } = fakePool();
        const { target } = fakeTarget(pool);
        const seen: RestoreProgress[] = [];

        await restoreDatabase(target, new Blob([ databaseBytes() ]), { report: (p) => seen.push(p) });

        expect(seen.map((p) => p.stage)).toEqual(
            expect.arrayContaining([ "staging", "validating", "swapping", "done" ])
        );
    });
});

describe("a backup that cannot be restored", () => {
    it("asks for a passphrase before reading an encrypted container, and imports nothing", async () => {
        const { files, pool } = fakePool();
        const { target, acted } = fakeTarget(pool);

        await expect(restoreDatabase(target, await containerOf(databaseBytes(), { passphrase: "hunter2" })))
            .rejects.toMatchObject({ reason: "passphrase-required" });

        expect(files.size).toBe(0);
        expect(acted).toEqual([]);
        expect(pointer).toBeUndefined();
    });

    it("refuses a file that is neither a database nor a backup", async () => {
        const { pool } = fakePool();
        const { target } = fakeTarget(pool);

        await expect(restoreDatabase(target, new Blob([ "a holiday photograph" ])))
            .rejects.toMatchObject({ reason: "not-a-database" });

        expect(pointer).toBeUndefined();
    });

    it("carries the checks' verdict back, and drops the candidate it had imported", async () => {
        const { files, answers, pool } = fakePool();
        const { target, acted } = fakeTarget(pool);
        answers.options.dbVersion = "99999";

        await expect(restoreDatabase(target, new Blob([ databaseBytes() ])))
            .rejects.toMatchObject({ reason: "database-too-new" });

        expect(files.has(CANDIDATE_NAME)).toBe(false);
        // Never swapped: the live database is untouched and still the one to open.
        expect(acted).toEqual([]);
        expect(pointer).toBeUndefined();
    });

    it("puts the previous database back when the restored one will not open", async () => {
        const { pool } = fakePool();
        const { target, acted } = fakeTarget(pool, { failToOpen: CANDIDATE_NAME });

        await expect(restoreDatabase(target, new Blob([ databaseBytes() ])))
            .rejects.toMatchObject({ reason: "swap-failed" });

        expect(acted).toEqual([ "close", `open-failed:${CANDIDATE_NAME}`, `open:${DEFAULT_DATABASE_NAME}` ]);
        expect(pointer).toBe(DEFAULT_DATABASE_NAME);
    });
});
