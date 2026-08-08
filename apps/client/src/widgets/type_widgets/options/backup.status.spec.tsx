import { render, VNode } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    bootToSetup: vi.fn(),
    canBootToSetup: vi.fn(() => true),
    confirm: vi.fn(async () => true)
}));

vi.mock("../../../services/setup_mode", () => ({
    bootToSetup: mocks.bootToSetup,
    canBootToSetup: () => mocks.canBootToSetup()
}));

vi.mock("../../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));

// i18next is never initialized in the client tests, so its `t` returns undefined; echo the key instead.
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n")>()),
    t: (key: string) => key
}));

// Import AFTER the mocks (vi.mock is hoisted, but the component import must resolve the mocked deps).
import { BackupStatus, StandaloneBackupSection } from "./backup";

let container: HTMLDivElement | undefined;

function renderInto(vnode: VNode) {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(vnode, container);

    return container;
}

function restoreButton(): HTMLButtonElement | null {
    return container?.querySelector<HTMLButtonElement>("button[name='restore-backup-button']") ?? null;
}

beforeEach(() => {
    mocks.bootToSetup.mockReset().mockResolvedValue(undefined);
    mocks.canBootToSetup.mockReset().mockReturnValue(true);
    mocks.confirm.mockReset().mockResolvedValue(true);
});

afterEach(() => {
    if (container) {
        render(null, container);
        container.remove();
        container = undefined;
    }
});

describe("restoring a backup from the options", () => {
    it("sends the app into the setup screen, at the restore step", () => {
        renderInto(<BackupStatus backups={[]} refreshCallback={vi.fn()} />);

        restoreButton()?.click();

        expect(mocks.bootToSetup).toHaveBeenCalledWith({ targetScreen: "restore-backup" });
    });

    it("is not offered where the app cannot start itself again", () => {
        // A browser talking to a server: the reload would leave the server, and its database, up.
        mocks.canBootToSetup.mockReturnValue(false);
        renderInto(<BackupStatus backups={[]} refreshCallback={vi.fn()} />);

        expect(restoreButton()).toBeNull();
        // The action that has always been there is untouched by any of this.
        expect(container?.querySelector("button[name='backup-database-now-button']")).not.toBeNull();
    });
});

describe("backing up where a backup is a download (standalone)", () => {
    function backupNowButton(): HTMLButtonElement | null {
        return container?.querySelector<HTMLButtonElement>("button[name='backup-database-now-button']") ?? null;
    }

    /** Lets the click's own promise chain settle, since confirming is asynchronous. */
    const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

    it("asks before restarting, then goes to the setup screen's backup step", async () => {
        renderInto(<StandaloneBackupSection />);

        backupNowButton()?.click();
        await settle();

        // Asked first: the restart is the surprising part, not the backup.
        expect(mocks.confirm).toHaveBeenCalledWith("backup.restart_for_backup");
        expect(mocks.bootToSetup).toHaveBeenCalledWith({ targetScreen: "backup-database" });
    });

    it("does nothing at all when the restart is declined", async () => {
        mocks.confirm.mockResolvedValue(false);
        renderInto(<StandaloneBackupSection />);

        backupNowButton()?.click();
        await settle();

        expect(mocks.bootToSetup).not.toHaveBeenCalled();
    });

    it("offers neither action where the app cannot start itself again", () => {
        // Both of them restart the application, so neither can be honoured without that.
        mocks.canBootToSetup.mockReturnValue(false);
        renderInto(<StandaloneBackupSection />);

        expect(backupNowButton()).toBeNull();
        expect(restoreButton()).toBeNull();
    });
});
