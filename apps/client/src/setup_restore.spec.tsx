import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({ t: (key: string) => key }));

const serverMock = vi.hoisted(() => ({
    // The default serves what transitively imported modules ask for as they load (keyboard_actions
    // fetches its shortcut list on import); the routing installed in beforeEach overrides it.
    get: vi.fn(async (url: string): Promise<unknown> => (url === "keyboard-actions" ? [] : {})),
    post: vi.fn(async (): Promise<unknown> => ({}))
}));
vi.mock("./services/server", () => ({ default: serverMock }));

const uploadMock = vi.hoisted(() => ({ uploadInChunks: vi.fn() }));
vi.mock("./services/chunked_upload", () => uploadMock);

import RestoreFromBackup from "./setup_restore";

const BACKUPS = [
    { fileName: "backup-daily.db", filePath: "/data/backup/backup-daily.db", mtime: "2026-08-01T10:00:00Z", fileSize: 2048, encrypted: false },
    { fileName: "backup-weekly.tnbackup", filePath: "/data/backup/backup-weekly.tnbackup", mtime: "2026-08-05T10:00:00Z", fileSize: 1024, encrypted: true }
];

let container: HTMLDivElement;
let restore: { stage: string; error?: string; reason?: string } | null;

function renderRestore(props: Partial<{ onBack: () => void; onRestored: () => void }> = {}) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<RestoreFromBackup onBack={props.onBack ?? vi.fn()} onRestored={props.onRestored ?? vi.fn()} />, container);

    return container;
}

const flushEffects = () => vi.advanceTimersByTimeAsync(50);
const nextPoll = () => vi.advanceTimersByTimeAsync(1000);

/** The row for a backup, which is the whole clickable section rather than a button inside it. */
function backupRow(name: string) {
    return [ ...container.querySelectorAll<HTMLElement>(".restore-backup-row") ]
        .find((row) => row.textContent?.includes(name));
}

beforeEach(() => {
    vi.useFakeTimers();
    restore = null;
    serverMock.get.mockImplementation(async (url: string) => {
        if (url === "database/backups") {
            return { backups: BACKUPS, backupFolderPath: "/data/backup" };
        }
        if (url === "keyboard-actions") {
            return [];
        }
        return { restore };
    });
    serverMock.post.mockResolvedValue({ started: true });
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
    vi.clearAllMocks();
});

describe("picking a backup", () => {
    it("lists what is on the device, newest first, and starts restoring the one that is picked", async () => {
        renderRestore();
        await flushEffects();

        const names = [ ...container.querySelectorAll(".restore-backup-name") ].map((row) => row.textContent);
        expect(names).toEqual([ "backup-weekly.tnbackup", "backup-daily.db" ]);

        backupRow("backup-daily.db")?.click();
        await flushEffects();

        expect(serverMock.post).toHaveBeenCalledWith("setup/restore/start", {
            source: "existing",
            filePath: "/data/backup/backup-daily.db",
            passphrase: undefined
        });
        expect(container.querySelector(".restore-stages")).toBeTruthy();
    });

    it("asks for the password first when the backup is encrypted, and sends it with the restore", async () => {
        renderRestore();
        await flushEffects();

        backupRow("backup-weekly.tnbackup")?.click();
        await flushEffects();

        expect(serverMock.post).not.toHaveBeenCalled();
        const input = container.querySelector<HTMLInputElement>("input[type=password]");
        expect(input).toBeTruthy();

        if (input) {
            input.value = "hunter2";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        }
        await flushEffects();
        container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
        await flushEffects();

        expect(serverMock.post).toHaveBeenCalledWith("setup/restore/start", {
            source: "existing",
            filePath: "/data/backup/backup-weekly.tnbackup",
            passphrase: "hunter2"
        });
    });

    it("still offers a file when the backups cannot be listed", async () => {
        serverMock.get.mockRejectedValueOnce(new Error("no backup directory"));

        renderRestore();
        await flushEffects();

        expect(container.querySelector(".restore-file-input")).toBeTruthy();
        expect(container.textContent).toContain("setup.restore-no-backups");
    });
});

describe("uploading a backup", () => {
    /** Drives the file input the "choose a file" button opens. */
    async function chooseFile(file: File) {
        const input = container.querySelector<HTMLInputElement>(".restore-file-input");
        Object.defineProperty(input, "files", { value: [ file ], configurable: true });
        input?.dispatchEvent(new Event("change", { bubbles: true }));
        await flushEffects();
    }

    it("sends the file in chunks, shows how far it has got, and restores it once it is there", async () => {
        uploadMock.uploadInChunks.mockImplementation(async ({ onProgress }: { onProgress: (p: unknown) => void }) => {
            onProgress({ sentBytes: 512, totalBytes: 1024, fraction: 0.5 });
            return { fileName: "backup.db", encrypted: false };
        });
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "database bytes" ], "backup.db"));

        expect(uploadMock.uploadInChunks).toHaveBeenCalledWith(expect.objectContaining({
            endpoint: "setup/restore/upload",
            fileName: "backup.db"
        }));
        expect(serverMock.post).toHaveBeenCalledWith("setup/restore/start", {
            source: "uploaded",
            filePath: undefined,
            passphrase: undefined
        });
    });

    it("asks for the password when what arrived turns out to be encrypted", async () => {
        uploadMock.uploadInChunks.mockResolvedValue({ fileName: "backup.tnbackup", encrypted: true });
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "container bytes" ], "backup.tnbackup"));

        expect(serverMock.post).not.toHaveBeenCalled();
        expect(container.querySelector("input[type=password]")).toBeTruthy();
    });

    it("goes back to the picker with the reason when the upload fails", async () => {
        uploadMock.uploadInChunks.mockRejectedValue(new Error("the disk is full"));
        renderRestore();
        await flushEffects();

        await chooseFile(new File([ "database bytes" ], "backup.db"));

        expect(container.textContent).toContain("setup.restore-upload-failed");
        expect(container.querySelector(".restore-file-input")).toBeTruthy();
    });
});

describe("following the restore", () => {
    async function startRestore() {
        renderRestore({ onRestored });
        await flushEffects();
        backupRow("backup-daily.db")?.click();
        await flushEffects();
    }

    let onRestored: () => void;

    beforeEach(() => { onRestored = vi.fn(); });

    it("moves through the stages the server reports", async () => {
        await startRestore();

        restore = { stage: "validating" };
        await nextPoll();

        const active = container.querySelector(".restore-stages .active");
        expect(active?.textContent).toContain("setup.restore-stage-validating");
    });

    it("finishes setup once the restore is done", async () => {
        await startRestore();

        restore = { stage: "done" };
        await nextPoll();

        expect(onRestored).toHaveBeenCalled();
    });

    it("survives the moment the database is detached and no request can be answered", async () => {
        await startRestore();

        serverMock.get.mockRejectedValueOnce(new Error("DB not open."));
        await nextPoll();

        expect(container.querySelector(".restore-stages")).toBeTruthy();

        restore = { stage: "done" };
        await nextPoll();
        expect(onRestored).toHaveBeenCalled();
    });

    it("goes back to the password when that is what was wrong, rather than to the start", async () => {
        await startRestore();

        restore = { stage: "failed", reason: "wrong-passphrase-or-damaged-header", error: "Verifier tag did not match." };
        await nextPoll();

        expect(container.querySelector("input[type=password]")).toBeTruthy();
        expect(container.textContent).toContain("setup.restore-wrong-passphrase");
    });

    it("reports a failure nothing can be done about, back at the picker", async () => {
        await startRestore();

        restore = { stage: "failed", reason: "database-too-new", error: "The database is version 999." };
        await nextPoll();

        expect(container.textContent).toContain("The database is version 999.");
        expect(container.querySelector(".restore-file-input")).toBeTruthy();
    });
});
