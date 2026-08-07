import { readBackupContainer } from "@triliumnext/backup-container";
import { peekBackupContainer } from "@triliumnext/backup-container/web";
import { options } from "@triliumnext/core";
import { Readable, Writable } from "stream";
import { afterEach, describe, expect, it, vi } from "vitest";

import StandaloneBackupService, {
    type BackupSqlAccess,
    type SnapshotPool
} from "./backup_provider.js";

interface NavWithStorage {
    storage?: {
        getDirectory?: () => Promise<unknown>;
        estimate?: () => Promise<{ quota?: number; usage?: number }>;
    };
}

const realStorageDescriptor = Object.getOwnPropertyDescriptor(navigator, "storage");

/**
 * An in-memory OPFS directory backed by a Map, close enough for the service: file handles carry
 * `getFile` (with `slice`, for the container header peek) and `createSyncAccessHandle` (which is
 * how backups are written).
 */
function makeOpfs(seed: Record<string, { data: Uint8Array; lastModified: number }> = {}) {
    const files = new Map(Object.entries(seed));
    const failures = { syncAccess: false };
    let clock = 1000;

    function fileHandle(name: string) {
        return {
            kind: "file" as const,
            async getFile() {
                const entry = files.get(name);
                const data = entry?.data ?? new Uint8Array();
                return {
                    lastModified: entry?.lastModified ?? 0,
                    size: data.byteLength,
                    slice(start?: number, end?: number) {
                        const part = data.slice(start, end);
                        return { async arrayBuffer() {
                            return part.buffer.slice(part.byteOffset, part.byteOffset + part.byteLength);
                        } };
                    },
                    async arrayBuffer() {
                        return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
                    }
                };
            },
            async createSyncAccessHandle() {
                if (failures.syncAccess) {
                    throw new Error("file is locked");
                }
                return {
                    write(buffer: Uint8Array, opts?: { at?: number }) {
                        const at = opts?.at ?? 0;
                        const current = files.get(name)?.data ?? new Uint8Array();
                        const grown = at + buffer.byteLength > current.byteLength
                            ? new Uint8Array(at + buffer.byteLength)
                            : current;
                        if (grown !== current) {
                            grown.set(current);
                        }
                        grown.set(buffer, at);
                        files.set(name, { data: grown, lastModified: clock++ });
                        return buffer.byteLength;
                    },
                    truncate(size: number) {
                        const current = files.get(name)?.data ?? new Uint8Array();
                        files.set(name, { data: current.slice(0, size), lastModified: clock++ });
                    },
                    flush() {},
                    close() {}
                };
            }
        };
    }

    const dir = {
        async getFileHandle(name: string, opts?: { create?: boolean }) {
            if (!files.has(name)) {
                if (!opts?.create) {
                    throw new Error(`missing ${name}`);
                }
                files.set(name, { data: new Uint8Array(), lastModified: clock++ });
            }
            return fileHandle(name);
        },
        async removeEntry(name: string) {
            if (!files.delete(name)) {
                throw new Error(`missing ${name}`);
            }
        },
        async *entries(): AsyncGenerator<[string, unknown]> {
            // A directory entry and a non-backup file exercise the listing filters.
            yield [ "nested", { kind: "directory" } ];
            for (const name of [ ...files.keys() ]) {
                yield [ name, fileHandle(name) ];
            }
        }
    };

    return { dir, files, failures, root: { async getDirectoryHandle() { return dir; } } };
}

function installOpfs(
    getDirectory: () => Promise<unknown>,
    estimate?: () => Promise<{ quota?: number; usage?: number }>
) {
    Object.defineProperty(navigator, "storage", {
        value: { getDirectory, estimate },
        configurable: true
    });
}

/** What the first page must start with: the container reader refuses payloads without it. */
const SQLITE_MAGIC = new TextEncoder().encode("SQLite format 3\u0000");

/** One fake page: filled with its own number, except that page 1 opens like a real database. */
function pageBytes(page: number, pageSize: number): Uint8Array {
    const bytes = new Uint8Array(pageSize).fill(page & 0xff);
    if (page === 1) {
        bytes.set(SQLITE_MAGIC);
        // Big-endian page size at offset 16, which the container reader checks as well.
        bytes[16] = pageSize >> 8;
        bytes[17] = pageSize & 0xff;
    }
    return bytes;
}

/**
 * A SQL provider whose pool serves `pageCount` pages of `pageSize` bytes for whatever snapshot
 * name is opened. What the service executed and unlinked is recorded for the assertions.
 */
function makeSqlAccess({ pageSize = 512, pageCount = 8, free = 1 } = {}) {
    const executed: string[] = [];
    const unlinked: string[] = [];
    const capacityAdded: number[] = [];

    class FakePoolDb {
        constructor(readonly name: string) {}
        selectValue(sql: string) {
            return sql.includes("page_size") ? pageSize : pageCount;
        }
        prepare() {
            let page = 0;
            return {
                bind: (values: unknown[]) => void (page = values[0] as number),
                step: () => page >= 1 && page <= pageCount,
                get: () => [ pageBytes(page, pageSize) ],
                reset: () => undefined,
                finalize: () => undefined
            };
        }
        close() {}
    }

    const pool = {
        OpfsSAHPoolDb: FakePoolDb,
        unlink: (name: string) => {
            unlinked.push(name);
            return true;
        },
        getFileCount: () => 6 - free,
        getCapacity: () => 6,
        addCapacity: async (entries: number) => {
            capacityAdded.push(entries);
            return 6 + entries;
        }
    } as unknown as SnapshotPool;

    const access: BackupSqlAccess = {
        exec: (sql: string) => void executed.push(sql),
        sahPool: pool
    };

    return { access, executed, unlinked, capacityAdded, pool };
}

function service(access?: BackupSqlAccess) {
    return new StandaloneBackupService(options, () => access);
}

/** Unwraps a container through the Node reader, proving the web writer's output reads back. */
async function unwrapContainer(container: Uint8Array): Promise<Uint8Array> {
    const chunks: Buffer[] = [];
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            chunks.push(chunk);
            callback();
        }
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a Node stream over the bytes.
    await readBackupContainer(Readable.from([ Buffer.from(container) ]) as any, sink);
    return new Uint8Array(Buffer.concat(chunks));
}

/** The bytes the fake pool's snapshot streams out as: pages 1..n, laid end to end. */
function expectedSnapshotBytes(pageSize = 512, pageCount = 8): Uint8Array {
    const bytes = new Uint8Array(pageSize * pageCount);
    for (let page = 1; page <= pageCount; page++) {
        bytes.set(pageBytes(page, pageSize), (page - 1) * pageSize);
    }
    return bytes;
}

afterEach(() => {
    if (realStorageDescriptor) {
        Object.defineProperty(navigator, "storage", realStorageDescriptor);
    } else {
        delete (navigator as unknown as NavWithStorage).storage;
    }
    vi.restoreAllMocks();
});

describe("StandaloneBackupService without OPFS", () => {
    function serviceWithoutOpfs() {
        delete (navigator as unknown as NavWithStorage).storage;
        return service(makeSqlAccess().access);
    }

    it("scheduleBackups is a no-op", () => {
        expect(() => serviceWithoutOpfs().scheduleBackups()).not.toThrow();
    });

    it("backupNow warns and returns the nominal path", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        expect(await serviceWithoutOpfs().backupNow("now")).toBe("/backups/backup-now.db");
        expect(warn).toHaveBeenCalled();
    });

    it("backupAs refuses outright, because its caller shows the result to the user", async () => {
        await expect(serviceWithoutOpfs().backupAs("Backup 1")).rejects.toThrow(/OPFS/);
    });

    it("listing, deleting and reading return empty results", async () => {
        const svc = serviceWithoutOpfs();
        expect(await svc.getExistingBackups()).toEqual([]);
        await expect(svc.deleteBackup("backup-x.db")).resolves.toBeUndefined();
        expect(await svc.getBackupContent("/backups/backup-x.db")).toBeNull();
    });
});

describe("StandaloneBackupService writing backups", () => {
    it("streams a plain .db backup out of a vacuumed pool snapshot", async () => {
        const fs = makeOpfs();
        installOpfs(async () => fs.root);
        vi.spyOn(console, "log").mockImplementation(() => {});
        const sql = makeSqlAccess();

        const path = await service(sql.access).backupNow("daily");

        expect(path).toBe("/backups/backup-daily.db");
        expect(fs.files.get("backup-daily.db")?.data).toEqual(expectedSnapshotBytes());
        expect(fs.files.has("backup-daily.db.part")).toBe(false);
        expect(sql.executed).toEqual([ "VACUUM INTO '/backup-snapshot.db'" ]);
        // Unlinked once to clear the name for the vacuum and once to clean up after.
        expect(sql.unlinked).toEqual([ "/backup-snapshot.db", "/backup-snapshot.db" ]);
        // One free slot is one short of snapshot plus journal.
        expect(sql.capacityAdded).toEqual([ 1 ]);
    });

    it("sanitizes the backup name the way the server does", async () => {
        const fs = makeOpfs();
        installOpfs(async () => fs.root);
        vi.spyOn(console, "log").mockImplementation(() => {});

        expect(await service(makeSqlAccess().access).backupNow("../evil name"))
            .toBe("/backups/backup-evilname.db");
        expect(fs.files.has("backup-evilname.db")).toBe(true);
    });

    it("wraps the backup in a compressed container when the option asks for it", async () => {
        const fs = makeOpfs({
            // A stale plain copy under the same base name, which the container must retire.
            "backup-daily.db": { data: new Uint8Array(4), lastModified: 1 }
        });
        installOpfs(async () => fs.root);
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(options, "getOptionOrNull").mockImplementation(
            (name: string) => name === "backupEnableCompression" ? "true" : null
        );

        const path = await service(makeSqlAccess().access).backupNow("daily");
        expect(path).toBe("/backups/backup-daily.tnbackup");

        const container = fs.files.get("backup-daily.tnbackup")?.data;
        if (!container) {
            throw new Error("no container was written");
        }
        const info = peekBackupContainer(container.slice(0, 256));
        expect(info?.compressed).toBe(true);
        expect(info?.encrypted).toBe(false);
        expect(info?.plaintextSize).toBe(expectedSnapshotBytes().byteLength);

        expect(await unwrapContainer(container)).toEqual(expectedSnapshotBytes());
        expect(fs.files.has("backup-daily.db")).toBe(false);
    });

    it("refuses to start when the quota cannot hold the database", async () => {
        const fs = makeOpfs();
        installOpfs(async () => fs.root, async () => ({ quota: 100, usage: 100 }));
        const error = vi.spyOn(console, "error").mockImplementation(() => {});
        const sql = makeSqlAccess();

        await service(sql.access).backupNow("daily");

        expect(sql.executed).toEqual([]);
        expect(fs.files.size).toBe(0);
        expect(error.mock.calls.join("\n")).toMatch(/browser storage/);

        await expect(service(sql.access).backupAs("Backup 1")).rejects.toThrow(/browser storage/);
    });

    it("cleans up the ruined file and marker when the stream fails mid-write", async () => {
        const fs = makeOpfs();
        installOpfs(async () => fs.root);
        vi.spyOn(console, "error").mockImplementation(() => {});
        const sql = makeSqlAccess();
        // Pages come back the wrong size, which errors the stream partway through.
        sql.pool.OpfsSAHPoolDb = class {
            selectValue(query: string) {
                return query.includes("page_size") ? 512 : 8;
            }
            prepare() {
                return {
                    bind: () => undefined,
                    step: () => true,
                    get: () => [ new Uint8Array(3) ],
                    reset: () => undefined,
                    finalize: () => undefined
                };
            }
            close() {}
        } as unknown as SnapshotPool["OpfsSAHPoolDb"];

        await service(sql.access).backupNow("daily");

        expect(fs.files.has("backup-daily.db")).toBe(false);
        expect(fs.files.has("backup-daily.db.part")).toBe(false);
        // The snapshot does not outlive the failure either.
        expect(sql.unlinked).toEqual([ "/backup-snapshot.db", "/backup-snapshot.db" ]);
    });

    it("keeps an older backup of the same name when the new file never opened", async () => {
        const previous = new Uint8Array([ 9, 9, 9 ]);
        const fs = makeOpfs({ "backup-daily.db": { data: previous, lastModified: 5 } });
        fs.failures.syncAccess = true;
        installOpfs(async () => fs.root);
        vi.spyOn(console, "error").mockImplementation(() => {});

        await service(makeSqlAccess().access).backupNow("daily");

        expect(fs.files.get("backup-daily.db")?.data).toEqual(previous);
        expect(fs.files.has("backup-daily.db.part")).toBe(false);
    });

    it("sweeps out an abandoned partial backup before writing the next one", async () => {
        const fs = makeOpfs({
            "backup-crashed.tnbackup": { data: new Uint8Array(10), lastModified: 1 },
            "backup-crashed.tnbackup.part": { data: new Uint8Array(), lastModified: 2 }
        });
        installOpfs(async () => fs.root);
        vi.spyOn(console, "log").mockImplementation(() => {});

        await service(makeSqlAccess().access).backupNow("daily");

        expect(fs.files.has("backup-crashed.tnbackup")).toBe(false);
        expect(fs.files.has("backup-crashed.tnbackup.part")).toBe(false);
        expect(fs.files.has("backup-daily.db")).toBe(true);
    });

    it("fails gracefully when no SQL access was wired in", async () => {
        installOpfs(async () => makeOpfs().root);
        const error = vi.spyOn(console, "error").mockImplementation(() => {});

        expect(await service(undefined).backupNow("daily")).toBe("/backups/backup-daily.db");
        expect(error).toHaveBeenCalled();
    });

    it("backupAs reports what it wrote and keeps path separators out of the name", async () => {
        const fs = makeOpfs();
        installOpfs(async () => fs.root);
        vi.spyOn(console, "log").mockImplementation(() => {});

        const written = await service(makeSqlAccess().access).backupAs("Backup 2026/08/07");

        expect(written).toEqual({
            fileName: "Backup 2026-08-07.db",
            filePath: "/backups/Backup 2026-08-07.db",
            directoryPath: "/backups",
            fileSize: expectedSnapshotBytes().byteLength,
            encrypted: false
        });
        expect(fs.files.has("Backup 2026-08-07.db")).toBe(true);
    });
});

describe("StandaloneBackupService listing and reading", () => {
    it("lists backups of both shapes newest-first, with container metadata", async () => {
        const fs = makeOpfs({
            "backup-old.db": { data: new Uint8Array(3), lastModified: 100 },
            "notes.txt": { data: new Uint8Array(), lastModified: 300 }
        });
        installOpfs(async () => fs.root);
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(options, "getOptionOrNull").mockImplementation(
            (name: string) => name === "backupEnableCompression" ? "true" : null
        );

        await service(makeSqlAccess().access).backupNow("new");
        const backups = await service(makeSqlAccess().access).getExistingBackups();

        expect(backups.map((backup) => backup.fileName))
            .toEqual([ "backup-new.tnbackup", "backup-old.db" ]);
        expect(backups[0].compressed).toBe(true);
        expect(backups[0].encrypted).toBe(false);
        expect(backups[0].plaintextSize).toBe(expectedSnapshotBytes().byteLength);
        expect(backups[1].compressed).toBeUndefined();
        expect(backups[1].filePath).toBe("/backups/backup-old.db");
    });

    it("does not list a backup its marker disowns", async () => {
        const fs = makeOpfs({
            "backup-good.db": { data: new Uint8Array(3), lastModified: 100 },
            "backup-half.tnbackup": { data: new Uint8Array(5), lastModified: 200 },
            "backup-half.tnbackup.part": { data: new Uint8Array(), lastModified: 201 }
        });
        installOpfs(async () => fs.root);

        const backups = await service(makeSqlAccess().access).getExistingBackups();
        expect(backups.map((backup) => backup.fileName)).toEqual([ "backup-good.db" ]);
    });

    it("reads and deletes a backup by path/name, marker included", async () => {
        const fs = makeOpfs({
            "backup-keep.tnbackup": { data: new Uint8Array([ 1, 2, 3 ]), lastModified: 1 },
            "backup-keep.tnbackup.part": { data: new Uint8Array(), lastModified: 2 }
        });
        installOpfs(async () => fs.root);
        vi.spyOn(console, "log").mockImplementation(() => {});

        const svc = service(makeSqlAccess().access);
        const content = await svc.getBackupContent("/backups/backup-keep.tnbackup");
        expect(content && Array.from(content)).toEqual([ 1, 2, 3 ]);

        await svc.deleteBackup("backup-keep.tnbackup");
        expect(fs.files.has("backup-keep.tnbackup")).toBe(false);
        expect(fs.files.has("backup-keep.tnbackup.part")).toBe(false);
    });

    it("returns null when the requested file name is not a backup", async () => {
        installOpfs(async () => makeOpfs().root);
        expect(await service(makeSqlAccess().access).getBackupContent("/backups/secrets.txt"))
            .toBeNull();
    });

    it("handles a missing backup directory handle gracefully", async () => {
        // root.getDirectoryHandle resolves to undefined → every operation degrades quietly.
        const root = { async getDirectoryHandle() { return undefined; } };
        installOpfs(async () => root);
        vi.spyOn(console, "error").mockImplementation(() => {});

        const svc = service(makeSqlAccess().access);
        expect(await svc.backupNow("x")).toBe("/backups/backup-x.db");
        expect(await svc.getExistingBackups()).toEqual([]);
        await expect(svc.deleteBackup("backup-x.db")).resolves.toBeUndefined();
        expect(await svc.getBackupContent("/backups/backup-x.db")).toBeNull();
    });

    it("swallows OPFS errors on every operation but backupAs", async () => {
        const boom = async () => {
            throw new Error("opfs down");
        };
        installOpfs(boom);
        vi.spyOn(console, "error").mockImplementation(() => {});

        const svc = service(makeSqlAccess().access);
        expect(await svc.backupNow("x")).toBe("/backups/backup-x.db");
        expect(await svc.getExistingBackups()).toEqual([]);
        await expect(svc.deleteBackup("backup-x.db")).resolves.toBeUndefined();
        expect(await svc.getBackupContent("/backups/backup-x.db")).toBeNull();
        await expect(svc.backupAs("Backup 1")).rejects.toThrow("opfs down");
    });
});
