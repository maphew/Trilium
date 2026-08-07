import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text.
vi.mock("./services/i18n", () => ({ t: (key: string) => key }));

const serverMock = vi.hoisted(() => ({
    get: vi.fn(async (url: string): Promise<unknown> =>
        (url === "setup/existing/status" ? { fraction: null } : url === "keyboard-actions" ? [] : {})),
    post: vi.fn(async (_url: string): Promise<unknown> => ({})),
    // The backup runs for minutes, so it asks for a timeout of its own rather than the default one.
    postWithTimeout: vi.fn(async (_url: string, _timeoutMs: number): Promise<unknown> => ({}))
}));
vi.mock("./services/server", () => ({ default: serverMock }));

import ExistingData from "./setup_existing";

const BACKUP = {
    fileName: "Backup 2026-08-07 10-32-21.tnbackup",
    filePath: "/mnt/usb/trilium/Backup 2026-08-07 10-32-21.tnbackup",
    fileSize: 209715200,
    encrypted: false
};

let container: HTMLDivElement;
const onProceed = vi.fn();
const onKept = vi.fn();

function renderScreens() {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<ExistingData onProceed={onProceed} onKept={onKept} />, container);

    return container;
}

/** Preact flushes effects and state through the microtask queue plus a frame. */
const settle = () => vi.advanceTimersByTimeAsync(50);

function choose(value: string) {
    const radio = container.querySelector<HTMLInputElement>(`input[type=radio][value='${value}']`);
    radio?.click();
    radio?.dispatchEvent(new Event("change", { bubbles: true }));
}

function button(label: string): HTMLButtonElement | undefined {
    return [ ...container.querySelectorAll("button") ]
        .find((element) => element.textContent?.includes(label));
}

beforeEach(() => {
    vi.useFakeTimers();
    onProceed.mockReset();
    onKept.mockReset();
    serverMock.post.mockReset().mockResolvedValue(undefined);
    serverMock.postWithTimeout.mockReset().mockResolvedValue(undefined);
    serverMock.get.mockClear();
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
});

describe("choosing what happens to the existing knowledge base", () => {
    it("will not continue until one of the two has been chosen", async () => {
        renderScreens();
        await settle();

        expect(button("setup.continue")?.disabled).toBe(true);

        choose("back-up");
        await settle();
        expect(button("setup.continue")?.disabled).toBe(false);
    });

    it("warns about erasure only once erasure is what was chosen", async () => {
        renderScreens();
        await settle();

        expect(container.querySelector(".existing-data-warning")).toBeNull();

        choose("delete");
        await settle();
        expect(container.querySelector(".existing-data-warning")?.textContent)
            .toContain("setup.existing-data-delete-warning");

        // Changing one's mind takes the warning away with it.
        choose("back-up");
        await settle();
        expect(container.querySelector(".existing-data-warning")).toBeNull();
    });

    it("erases and moves on when that is the answer", async () => {
        renderScreens();
        await settle();

        choose("delete");
        await settle();
        button("setup.continue")?.click();
        await settle();

        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/delete");
        expect(onProceed).toHaveBeenCalled();
        // Nothing was backed up, since nothing was asked to be.
        expect(serverMock.postWithTimeout).not.toHaveBeenCalled();
    });

    it("leaves everything alone and reopens the database on cancel", async () => {
        renderScreens();
        await settle();

        button("setup.existing-data-cancel")?.click();
        await settle();

        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/keep");
        expect(onKept).toHaveBeenCalled();
    });
});

describe("backing it up first", () => {
    it("says what was written, and erases nothing until that is confirmed", async () => {
        serverMock.postWithTimeout.mockResolvedValue(BACKUP);
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        await settle();

        expect(serverMock.postWithTimeout).toHaveBeenCalledWith("setup/existing/backup", 3600000);
        // The path in full: the option holding a custom backup directory is in the database that is
        // about to go, so this may be the last chance to read it.
        expect(container.textContent).toContain(BACKUP.fileName);
        expect(container.textContent).toContain(BACKUP.filePath);
        expect(container.textContent).toContain("200 MiB");
        expect(serverMock.post).not.toHaveBeenCalledWith("setup/existing/delete");

        button("setup.continue")?.click();
        await settle();
        expect(serverMock.post).toHaveBeenCalledWith("setup/existing/delete");
        expect(onProceed).toHaveBeenCalled();
    });

    it("shows how far along the write is, once the writer has said anything", async () => {
        // The backup answers only when it is finished, so this screen would otherwise show a spinner
        // and nothing else for the minutes a large knowledge base takes.
        let resolveBackup: (value: unknown) => void = () => {};
        serverMock.postWithTimeout.mockImplementation(() => new Promise((resolve) => { resolveBackup = resolve; }));
        serverMock.get.mockResolvedValue({ fraction: 0.42 });
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        await settle();

        await vi.advanceTimersByTimeAsync(1000);
        expect(container.querySelector("progress")?.value).toBeCloseTo(0.42);
        expect(container.textContent).toContain("42%");

        resolveBackup(BACKUP);
    });

    it("says to keep the backup password where the backup needs one", async () => {
        serverMock.postWithTimeout.mockResolvedValue({ ...BACKUP, encrypted: true });
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        await settle();

        expect(container.querySelector(".existing-data-warning")?.textContent)
            .toContain("setup.existing-data-encrypted-warning");
    });

    it("goes back to the question when the backup fails, having erased nothing", async () => {
        // Rejected the way the client's request layer rejects: the response body, not an Error.
        serverMock.postWithTimeout.mockRejectedValue('{"message":"the disk is full"}');
        renderScreens();
        await settle();

        choose("back-up");
        await settle();
        button("setup.continue")?.click();
        await settle();

        expect(container.querySelector(".page-error")?.textContent).toContain("the disk is full");
        expect(container.querySelector("input[type=radio]")).not.toBeNull();
        expect(onProceed).not.toHaveBeenCalled();
    });
});
