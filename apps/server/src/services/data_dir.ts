/*
 * This file resolves trilium data path in this order of priority:
 * - case A) if TRILIUM_DATA_DIR environment variable exists, then its value is used as the path
 * - case B) if "trilium-data" dir exists directly in the home dir, then it is used
 * - case C) based on OS convention, if the "app data directory" exists, we'll use or create "trilium-data" directory there
 * - case D) as a fallback if the previous step fails, we'll use home dir
 */

import fs from "node:fs";
import os from "node:os";
import { dirname, join as pathJoin } from "node:path";

import { HEALTHCHECK_SOCKET_FILE, HEALTHCHECK_URL_FILE } from "./healthcheck.js";

const DIR_NAME = "trilium-data";
const FOLDER_PERMISSIONS = 0o700;

export function getTriliumDataDir(dataDirName: string) {
    // case A
    if (process.env.TRILIUM_DATA_DIR) {
        createDirIfNotExisting(process.env.TRILIUM_DATA_DIR);
        return process.env.TRILIUM_DATA_DIR;
    }

    // case B
    const homePath = pathJoin(os.homedir(), dataDirName);
    if (fs.existsSync(homePath)) {
        return homePath;
    }

    // case C
    const platformAppDataDir = getPlatformAppDataDir(os.platform(), process.env.APPDATA);
    if (platformAppDataDir && fs.existsSync(platformAppDataDir)) {
        const appDataDirPath = pathJoin(platformAppDataDir, dataDirName);
        createDirIfNotExisting(appDataDirPath);
        return appDataDirPath;
    }

    // case D
    createDirIfNotExisting(homePath);
    return homePath;
}

export function getDataDirs(TRILIUM_DATA_DIR: string) {
    const dataDirs = {
        TRILIUM_DATA_DIR,
        DOCUMENT_PATH: process.env.TRILIUM_DOCUMENT_PATH || pathJoin(TRILIUM_DATA_DIR, "document.db"),
        BACKUP_DIR: process.env.TRILIUM_BACKUP_DIR || pathJoin(TRILIUM_DATA_DIR, "backup"),
        LOG_DIR: process.env.TRILIUM_LOG_DIR || pathJoin(TRILIUM_DATA_DIR, "log"),
        TMP_DIR: process.env.TRILIUM_TMP_DIR || pathJoin(TRILIUM_DATA_DIR, "tmp"),
        ANONYMIZED_DB_DIR: process.env.TRILIUM_ANONYMIZED_DB_DIR || pathJoin(TRILIUM_DATA_DIR, "anonymized-db"),
        CONFIG_INI_PATH: process.env.TRILIUM_CONFIG_INI_PATH || pathJoin(TRILIUM_DATA_DIR, "config.ini"),
        OCR_CACHE_DIR: process.env.TRILIUM_OCR_CACHE_DIR || pathJoin(TRILIUM_DATA_DIR, "ocr-cache")
    } as const;

    createDirIfNotExisting(dataDirs.TMP_DIR);
    checkExistingEntries(dataDirs);

    Object.freeze(dataDirs);
    return dataDirs;
}

/**
 * Stops startup when entries left in the data directory cannot be used, typically because
 * an earlier run as another user (root, `sudo`, a container without `--user`) owns them.
 * Otherwise SQLite opens such a database read-only and only fails at the first write.
 */
function checkExistingEntries(dataDirs: ReturnType<typeof getDataDirs>) {
    const { R_OK, W_OK, X_OK } = fs.constants;
    const inDataDir = (name: string) => pathJoin(dataDirs.TRILIUM_DATA_DIR, name);
    const required: [ path: string, mode: number ][] = [
        [ dataDirs.DOCUMENT_PATH, R_OK | W_OK ],
        [ `${dataDirs.DOCUMENT_PATH}-wal`, R_OK | W_OK ],
        [ `${dataDirs.DOCUMENT_PATH}-shm`, R_OK | W_OK ],
        [ inDataDir(HEALTHCHECK_URL_FILE), R_OK | W_OK ],
        [ inDataDir(HEALTHCHECK_SOCKET_FILE), R_OK | W_OK ],
        [ dataDirs.LOG_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.TMP_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.BACKUP_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.ANONYMIZED_DB_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.OCR_CACHE_DIR, R_OK | W_OK | X_OK ],
        [ dataDirs.CONFIG_INI_PATH, R_OK ],
        [ inDataDir("session_secret.txt"), R_OK ]
    ];

    const unusable = required.filter(([ path, mode ]) => {
        if (!fs.existsSync(path)) {
            return false;
        }
        try {
            fs.accessSync(path, mode);
            return false;
        } catch {
            return true;
        }
    });
    if (!unusable.length) {
        return;
    }

    const user = getProcessUser();
    const lines = [
        "Trilium cannot start: the user running it cannot use these files in its data directory.",
        ""
    ];
    if (user) {
        lines.push(`Running as UID:GID ${user}.`);
    }
    for (const [ path ] of unusable) {
        lines.push(`${path} ${describeOwnership(path)}.`);
    }
    lines.push("", "To fix this, give the data directory and everything in it to the user running Trilium,");
    if (user) {
        lines.push(`for example: sudo chown -R ${user} ${dataDirs.TRILIUM_DATA_DIR}`);
    }
    lines.push(
        "In Docker, run that on the host directory mounted as the data directory, or start the",
        "container without --user."
    );
    stopStartup(lines.join("\n"));
}

export function getPlatformAppDataDir(platform: ReturnType<typeof os.platform>, ENV_APPDATA_DIR: string | undefined = process.env.APPDATA) {
    switch (true) {
        case platform === "win32" && !!ENV_APPDATA_DIR:
            return ENV_APPDATA_DIR;

        case platform === "linux":
            return `${os.homedir()}/.local/share`;

        case platform === "darwin":
            return `${os.homedir()}/Library/Application Support`;

        default:
            // if OS is not recognized
            return null;
    }
}

/**
 * Stops startup with `message`. The server prints it and exits, since a stack trace adds nothing.
 * Electron shows an uncaught main-process error in a dialog, which is the only place a desktop
 * user sees it, so there the message is thrown.
 */
function stopStartup(message: string, cause?: unknown): never {
    if (process.versions.electron) {
        throw new Error(message, { cause });
    }
    console.error(`\n${message}\n`);
    process.exit(1);
}

/** Returns the process's `UID:GID`, or `undefined` on Windows, which has neither. */
function getProcessUser() {
    if (process.getuid && process.getgid) {
        return `${process.getuid()}:${process.getgid()}`;
    }
}

/** Completes a sentence about `path`: "is owned by UID:GID 1000:1000 with permissions 700". */
function describeOwnership(path: string) {
    try {
        const stats = fs.statSync(path);
        return `is owned by UID:GID ${stats.uid}:${stats.gid} with permissions ${(stats.mode & 0o777).toString(8)}`;
    } catch {
        return "cannot be inspected";
    }
}

function failWithPermissionError(targetPath: fs.PathLike, cause: unknown): never {
    stopStartup(describePermissionError(targetPath.toString()), cause);
}

function describePermissionError(path: string) {
    const blockedDir = findUnreachableAncestor(dirname(path));
    const shownDir = blockedDir ?? dirname(path);
    const user = getProcessUser();
    const lines = [
        blockedDir
            ? `Trilium cannot start: ${path} cannot be reached.`
            : `Trilium cannot start: permission denied while creating ${path}.`,
        ""
    ];
    if (user) {
        lines.push(`Running as UID:GID ${user}.`);
    }
    lines.push(blockedDir
        ? `${shownDir} cannot be entered; it ${describeOwnership(shownDir)}.`
        : `${shownDir} ${describeOwnership(shownDir)}.`);

    lines.push(
        "",
        "To fix this, either:",
        "  - make sure the user running Trilium can enter every directory above the data directory",
        "    and write to the data directory itself",
        "  - set TRILIUM_DATA_DIR to a directory owned by that user",
        "  - in Docker, set USER_UID and USER_GID to the owner of the mounted directory, or, if the",
        "    container runs with --user, give the mounted directory to that user"
    );
    return lines.join("\n");
}

/**
 * Returns the highest directory on the way to `dir` that the process cannot enter. Every
 * directory below it fails the same check, so it is the one whose permissions need fixing.
 */
function findUnreachableAncestor(dir: string) {
    let blocked: string | undefined;
    for (let current = dir; ; current = dirname(current)) {
        try {
            fs.accessSync(current, fs.constants.X_OK);
        } catch {
            blocked = current;
        }
        if (dirname(current) === current) {
            return blocked;
        }
    }
}

function createDirIfNotExisting(path: fs.PathLike, permissionMode: fs.Mode = FOLDER_PERMISSIONS) {
    try {
        fs.mkdirSync(path, permissionMode);
    } catch (err: unknown) {
        if (err && typeof err === "object" && "code" in err) {
            const code = (err as { code: string }).code;

            if (code === "EACCES") {
                failWithPermissionError(path, err);
            } else if (code === "EEXIST") {
                // Directory already exists - verify it's actually a directory
                try {
                    if (fs.statSync(path).isDirectory()) {
                        return;
                    }
                } catch {
                    // If we can't stat it, fall through to re-throw original error
                }
            }
        }
        throw err;
    }
}

const TRILIUM_DATA_DIR = getTriliumDataDir(DIR_NAME);
const dataDirs = getDataDirs(TRILIUM_DATA_DIR);

export default dataDirs;
