import { app_info as appInfo } from "@triliumnext/core";
import Database from "better-sqlite3";
import fs from "fs";

/**
 * Decides whether a file is a Trilium database this version can open, before anything is done that
 * depends on the answer.
 *
 * A restore replaces the document the whole application is about, and the file it replaces it with
 * arrived from outside: an upload, a directory listing, a file the user picked. "It has a .db
 * extension" says nothing, and finding out later is not an option, because the code that would find
 * out is the migration, and a migration that cannot proceed calls `crash()` — which on the server is
 * `process.exit(1)`. By then the original database has already been moved aside.
 *
 * So every reason the database could turn out to be unusable is checked here, on a copy nothing is
 * attached to yet, and turned into an answer the user can act on.
 *
 * @module
 */

/** The oldest database the migrations can still take, from `migration.migrate`. */
export const OLDEST_SUPPORTED_DB_VERSION = 214;

const REQUIRED_TABLES = [ "options", "notes", "branches", "blobs" ];
const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");

export type DatabaseRejection =
    /** Not a SQLite database at all. */
    | "not-a-database"
    /** SQLite, but corrupt. */
    | "damaged-database"
    /** A SQLite database, but not one of ours. */
    | "not-a-trilium-database"
    /** Ours, but from a setup that never finished, so there is nothing to restore. */
    | "database-not-initialized"
    /** From a version so old the migrations no longer reach back to it. */
    | "database-too-old"
    /** From a newer version, which this one cannot read. */
    | "database-too-new";

export type DatabaseValidation =
    | { valid: true; dbVersion: number; needsMigration: boolean }
    | { valid: false; rejection: DatabaseRejection; message: string };

/**
 * Reads `filePath` and reports whether it can become this instance's database.
 *
 * The file is opened read-only through its own connection, so nothing here touches the database the
 * application is currently attached to.
 *
 * `PRAGMA quick_check` reads the whole file, which for a large database is not instant. It is worth
 * it: a restore that succeeds and leaves the user with a corrupt document is worse than one that
 * takes another minute to say no.
 */
export function validateDatabaseFile(filePath: string): DatabaseValidation {
    if (!hasSqliteHeader(filePath)) {
        return reject("not-a-database", "The file is not a SQLite database.");
    }

    let db: Database.Database;
    try {
        db = new Database(filePath, {
            readonly: true,
            fileMustExist: true,
            nativeBinding: process.env.BETTERSQLITE3_NATIVE_PATH || undefined
        });
    } catch (e) {
        return reject("not-a-database", `The database could not be opened: ${messageOf(e)}`);
    }

    try {
        return inspect(db);
    } catch (e) {
        return reject("damaged-database", `The database could not be read: ${messageOf(e)}`);
    } finally {
        db.close();
    }
}

function inspect(db: Database.Database): DatabaseValidation {
    const integrity = db.pragma("quick_check", { simple: true });
    if (integrity !== "ok") {
        return reject("damaged-database", `The database failed its integrity check: ${integrity}`);
    }

    const tables = new Set(
        db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").pluck().all() as string[]
    );
    const missing = REQUIRED_TABLES.filter((table) => !tables.has(table));
    if (missing.length > 0) {
        return reject(
            "not-a-trilium-database",
            `The database is missing the ${missing.join(", ")} table${missing.length > 1 ? "s" : ""}.`
        );
    }

    const readOption = db.prepare("SELECT value FROM options WHERE name = ?").pluck();
    if (readOption.get("initialized") !== "true") {
        return reject(
            "database-not-initialized",
            "The database is from a setup that never finished, so it holds nothing to restore."
        );
    }

    const dbVersion = Number(readOption.get("dbVersion"));
    if (!Number.isInteger(dbVersion)) {
        return reject("not-a-trilium-database", "The database does not state which version it is from.");
    }
    if (dbVersion < OLDEST_SUPPORTED_DB_VERSION) {
        return reject(
            "database-too-old",
            `The database is version ${dbVersion}; the oldest that can still be migrated is ${OLDEST_SUPPORTED_DB_VERSION}.`
        );
    }
    if (dbVersion > appInfo.dbVersion) {
        return reject(
            "database-too-new",
            `The database is version ${dbVersion}, which is newer than this application's ${appInfo.dbVersion}.`
        );
    }

    return { valid: true, dbVersion, needsMigration: dbVersion < appInfo.dbVersion };
}

/**
 * Checks the file starts the way a SQLite database does, which costs sixteen bytes and spares the
 * user an error about a malformed database when what they picked was a photograph.
 */
function hasSqliteHeader(filePath: string): boolean {
    const head = Buffer.alloc(SQLITE_MAGIC.length);
    let descriptor: number | undefined;

    try {
        descriptor = fs.openSync(filePath, "r");
        const read = fs.readSync(descriptor, head, 0, head.length, 0);

        return read === head.length && head.equals(SQLITE_MAGIC);
    } catch {
        return false;
    } finally {
        if (descriptor !== undefined) {
            fs.closeSync(descriptor);
        }
    }
}

function reject(rejection: DatabaseRejection, message: string): DatabaseValidation {
    return { valid: false, rejection, message };
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
