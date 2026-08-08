import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({ t: (key: string) => key }));

const mocks = vi.hoisted(() => ({
    startBackupDownload: vi.fn(async () => ({ status: "done" }) as { status: string; message?: string })
}));

vi.mock("./services/backup_download", () => ({
    backupDownloadFileName: () => "Backup 2026-08-08 10-00-00.tnbackup",
    isBackupDownloadSupported: () => true,
    startBackupDownload: mocks.startBackupDownload
}));

import SetupBackupDatabase from "./setup_backup";

let container: HTMLDivElement;
const onDone = vi.fn();

/** Preact flushes effects and state through the microtask queue plus a frame. */
const settle = () => vi.advanceTimersByTimeAsync(50);

function renderScreen() {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<SetupBackupDatabase onDone={onDone} />, container);

    return container;
}

function button(label: string): HTMLButtonElement | undefined {
    return [ ...container.querySelectorAll("button") ]
        .find((element) => element.textContent?.includes(label));
}

beforeEach(() => {
    vi.useFakeTimers();
    onDone.mockReset();
    mocks.startBackupDownload.mockReset().mockResolvedValue({ status: "done" });
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
});

describe("backing up from the setup screen", () => {
    it("names the file up front and downloads nothing until asked", async () => {
        renderScreen();
        await settle();

        expect(container.textContent).toContain("setup.backup-data");
        // The name is on the screen before the download, since it is what the user goes looking
        // for afterwards, and it is the one part of the line that is not boilerplate.
        expect(container.querySelector(".backup-download-file strong")?.textContent)
            .toBe("Backup 2026-08-08 10-00-00.tnbackup");
        expect(mocks.startBackupDownload).not.toHaveBeenCalled();
        // Nothing here is destructive, so leaving is available from the start.
        expect(button("setup.backup-finish")?.disabled).toBe(false);
    });

    it("downloads on request, and says so while it runs and once it is done", async () => {
        let finish: (result: { status: string }) => void = () => {};
        mocks.startBackupDownload.mockImplementation(() => new Promise((resolve) => {
            finish = resolve;
        }));
        renderScreen();
        await settle();

        button("setup.backup-download")?.click();
        await settle();

        expect(mocks.startBackupDownload).toHaveBeenCalledWith("Backup 2026-08-08 10-00-00.tnbackup");
        expect(container.textContent).toContain("setup.backup-downloading");
        // Said while it runs, because leaving the screen is exactly what would break it.
        expect(container.textContent).toContain("setup.backup-do-not-close");
        // The running download has the screen to itself: nothing to press, nothing to re-read.
        expect(button("setup.backup-download")).toBeUndefined();
        expect(container.querySelector(".backup-download-file")).toBeNull();
        // Leaving mid-stream would abandon the download, so that one moment is held.
        expect(button("setup.backup-finish")?.disabled).toBe(true);

        finish({ status: "done" });
        await settle();
        // The outcome is stated where it cannot be missed, and taking another copy is offered again.
        expect(container.querySelector(".backup-download-outcome")?.textContent)
            .toContain("setup.backup-downloaded");
        expect(container.textContent).not.toContain("setup.backup-do-not-close");
        expect(button("setup.backup-download")?.disabled).toBe(false);
        expect(container.querySelector(".backup-download-file")).not.toBeNull();
        expect(button("setup.backup-finish")?.disabled).toBe(false);
    });

    it("shows what stopped a failed download, and offers another go", async () => {
        mocks.startBackupDownload.mockResolvedValue({ status: "failed", message: "the stream broke" });
        renderScreen();
        await settle();

        button("setup.backup-download")?.click();
        await settle();

        expect(container.querySelector(".backup-download-outcome")?.textContent)
            .toContain("the stream broke");
        // Trying again is the way out, so the button and the name it writes are both back.
        expect(button("setup.backup-download")?.disabled).toBe(false);
        expect(container.querySelector(".backup-download-file")).not.toBeNull();
        // Still not trapped: the way back to the notes stays open through a failure.
        expect(button("setup.backup-finish")?.disabled).toBe(false);
    });

    it("hands back to the application when it is done with", async () => {
        renderScreen();
        await settle();

        button("setup.backup-finish")?.click();
        await settle();

        expect(onDone).toHaveBeenCalled();
    });
});
