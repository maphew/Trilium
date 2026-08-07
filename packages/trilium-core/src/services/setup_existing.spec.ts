import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBackup } from "./backup.js";
import {
    backUpExistingData,
    backupNameFor,
    deleteExistingData,
    getExistingBackupProgress,
    keepExistingData
} from "./setup_existing.js";
import { enterSetupMode, initSetupPlatform, leaveSetupMode } from "./setup_mode.js";

const platform = {
    writeMarker: vi.fn(async () => {}),
    removeMarker: vi.fn(async () => {}),
    removeDatabase: vi.fn(async () => {})
};

beforeEach(() => {
    Object.values(platform).forEach((fn) => fn.mockClear());
    initSetupPlatform(platform);
    // An instance the app asked into setup, which is the only state these operations belong to.
    enterSetupMode({ lang: "en" });
});

afterEach(() => {
    leaveSetupMode();
    vi.restoreAllMocks();
});

describe("naming the backup", () => {
    it("is dated and readable, and is a filename on every platform", () => {
        expect(backupNameFor(new Date(2026, 7, 7, 10, 32, 21))).toBe("Backup 2026-08-07 10-32-21");
        // Padded, so a directory listing sorts by name and gets chronological order for free.
        expect(backupNameFor(new Date(2026, 0, 2, 3, 4, 5))).toBe("Backup 2026-01-02 03-04-05");
        // A colon is not a filename on Windows, and this one is written to a directory the user opens.
        expect(backupNameFor(new Date())).not.toContain(":");
    });
});

describe("what becomes of the existing database", () => {
    it("backs it up through the platform's own backup service", async () => {
        const written = { fileName: "Backup.tnbackup", filePath: "/b/Backup.tnbackup", fileSize: 12, encrypted: true };
        const backupAs = vi.fn(async (_name: string, _onProgress?: (fraction: number) => void) => written);
        // Assigned rather than spied: the method is optional, and a platform without one is exactly
        // what the service checks for.
        const backup = getBackup() as { backupAs?: typeof backupAs };
        const previous = backup.backupAs;
        backup.backupAs = backupAs;

        await expect(backUpExistingData(new Date(2026, 7, 7, 10, 32, 21))).resolves.toEqual(written);
        expect(backupAs).toHaveBeenCalledWith("Backup 2026-08-07 10-32-21", expect.any(Function));
        // Nothing is erased by taking a copy of it.
        expect(platform.removeDatabase).not.toHaveBeenCalled();

        backup.backupAs = previous;
    });

    it("says how far along the write is while it runs, and nothing once it is over", async () => {
        const seen: (number | null)[] = [];
        const backup = getBackup() as { backupAs?: unknown };
        const previous = backup.backupAs;
        backup.backupAs = async (_name: string, onProgress?: (fraction: number) => void) => {
            seen.push(getExistingBackupProgress());
            onProgress?.(0.5);
            seen.push(getExistingBackupProgress());
            return { fileName: "b", filePath: "/b", fileSize: 1, encrypted: false };
        };

        await backUpExistingData(new Date());

        expect(seen).toEqual([ 0, 0.5 ]);
        // Nothing is running any more, which is what the screen needs to stop drawing a bar.
        expect(getExistingBackupProgress()).toBeNull();

        backup.backupAs = previous;
    });

    it("erases it, and nothing else", async () => {
        await deleteExistingData();

        expect(platform.removeDatabase).toHaveBeenCalled();
    });

    it("puts the instance back as it was when the answer is to keep it", async () => {
        await keepExistingData();

        // The marker goes first: a start that finds one comes up as the wizard all over again.
        expect(platform.removeMarker).toHaveBeenCalled();
        expect(platform.removeDatabase).not.toHaveBeenCalled();
    });

    it("refuses every one of them where there is no existing database to act on", async () => {
        leaveSetupMode();

        await expect(backUpExistingData(new Date())).rejects.toThrow(/first time/);
        await expect(deleteExistingData()).rejects.toThrow(/first time/);
        await expect(keepExistingData()).rejects.toThrow(/first time/);
        expect(platform.removeDatabase).not.toHaveBeenCalled();
    });
});
