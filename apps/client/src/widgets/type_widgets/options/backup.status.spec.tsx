import { render, VNode } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    bootToSetup: vi.fn(),
    canBootToSetup: vi.fn(() => true)
}));

vi.mock("../../../services/setup_mode", () => ({
    bootToSetup: mocks.bootToSetup,
    canBootToSetup: () => mocks.canBootToSetup()
}));

// i18next is never initialized in the client tests, so its `t` returns undefined; echo the key instead.
vi.mock("../../../services/i18n", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/i18n")>()),
    t: (key: string) => key
}));

// Import AFTER the mocks (vi.mock is hoisted, but the component import must resolve the mocked deps).
import { BackupStatus } from "./backup";

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
