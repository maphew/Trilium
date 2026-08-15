import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// t() returns the key so assertions are deterministic and not tied to English text; a counted
// string carries its count, which is the part of those the page decides.
vi.mock("../../../services/i18n", () => ({
    t: (key: string, params?: { count?: number }) => params?.count === undefined ? key : `${key}=${params.count}`
}));

const setupMode = vi.hoisted(() => ({
    canBootToSetup: vi.fn(() => true),
    startOver: vi.fn(async () => "restarting" as string),
    isStartOverPending: vi.fn(async () => false),
    cancelStartOver: vi.fn(async () => {})
}));
vi.mock("../../../services/setup_mode", () => setupMode);

const DATABASE_INFO = {
    filePath: "/data/trilium/document.db",
    directoryPath: "/data/trilium",
    utcDateCreated: "2020-05-17 08:30:00.000Z",
    noteCount: 12,
    attachmentCount: 3,
    sizeBytes: 3 * 1024 * 1024
};

/** Set where a test needs the info card to have nothing to say. */
const failing = vi.hoisted(() => ({ info: false }));

// The info, maintenance and anonymization cards call the backend as they render and as they are used.
const server = vi.hoisted(() => ({
    get: vi.fn(async (url: string) => {
        switch (url) {
            case "database/info":
                if (failing.info) {
                    throw new Error("no answer");
                }
                return DATABASE_INFO;
            case "database/check-integrity":
                return { results: [{ integrity_check: "ok" }] };
            case "database/anonymized-databases":
                return { databases: [], anonymizedFolderPath: "/data/anonymized" };
            // Whatever the page's own imports ask for while they load, e.g. keyboard actions.
            default:
                return [];
        }
    }),
    post: vi.fn(async () => ({ success: true, anonymizedFilePath: "/data/anonymized/copy.db" })),
    postWithTimeout: vi.fn(async () => ({}))
}));
vi.mock("../../../services/server", () => ({ default: server }));

const toast = vi.hoisted(() => ({
    showMessage: vi.fn(),
    showError: vi.fn()
}));
vi.mock("../../../services/toast", () => ({ default: toast }));

// The page header renders the note's own title, which needs a note context this spec has no use for.
vi.mock("./components/OptionsPageHeader", () => ({ default: () => null }));

// Maintenance hands over to the Content Manager, which needs a note context to navigate with. Only
// that hook is replaced: the card rows still need the rest of the module, ID generation included.
const noteContext = vi.hoisted(() => ({ setNote: vi.fn(async () => {}) }));
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useNoteContext: () => ({ noteContext })
}));

const contentManager = vi.hoisted(() => ({ requestContentManagerSection: vi.fn() }));
vi.mock("./content_manager", () => contentManager);

// Opening the real dialog would measure the whole database and draw its charts; what this page
// answers for is that it opens one, and what it does with the answer.
const cleanup = vi.hoisted(() => ({ showCleanupDialog: vi.fn(async () => 1234 as number | null) }));
vi.mock("./content_manager/space_usage/cleanup_dialog", () => cleanup);

import DatabaseSettings from "./database";

let container: HTMLDivElement;

/** Preact flushes effects and state through the microtask queue plus a frame. */
const settle = () => vi.advanceTimersByTimeAsync(50);

function renderPage() {
    container = document.createElement("div");
    document.body.appendChild(container);
    render(<DatabaseSettings />, container);

    return container;
}

/** By name rather than by label: one label is a prefix of the other. */
function button(name: string): HTMLButtonElement | null {
    return container.querySelector<HTMLButtonElement>(`button[name='${name}']`);
}

beforeEach(() => {
    vi.useFakeTimers();
    setupMode.canBootToSetup.mockReset().mockReturnValue(true);
    setupMode.startOver.mockReset().mockResolvedValue("restarting");
    setupMode.isStartOverPending.mockReset().mockResolvedValue(false);
    setupMode.cancelStartOver.mockReset().mockResolvedValue(undefined);
    failing.info = false;
    noteContext.setNote.mockClear();
    contentManager.requestContentManagerSection.mockClear();
    cleanup.showCleanupDialog.mockReset().mockResolvedValue(1234);
    server.get.mockClear();
    server.post.mockClear();
    server.postWithTimeout.mockClear();
    toast.showMessage.mockClear();
    toast.showError.mockClear();
});

afterEach(() => {
    render(null, container);
    container.remove();
    vi.useRealTimers();
});

describe("what the database is", () => {
    /** The facts of the info card, in the order the card states them. */
    function infoValues() {
        return [ ...container.querySelectorAll(".database-info .database-info-value") ]
            .map((value) => value.textContent);
    }

    it("states where it lives, when it began, what it holds and how large it has grown", async () => {
        renderPage();
        await settle();

        expect(server.get).toHaveBeenCalledWith("database/info");

        const [ location, created, content, size ] = infoValues();
        // The file is named in full; the link behind it opens the folder holding it, since that is
        // what a file manager can be pointed at.
        expect(location).toBe(DATABASE_INFO.filePath);
        expect(created).toContain("2020");
        expect(content).toBe("database.info_notes=12, database.info_attachments=3");
        expect(size).toBe("3 MiB");
    });

    it("reads the figures again once the database has been compacted", async () => {
        renderPage();
        await settle();

        button("vacuum-database-button")?.click();
        await settle();

        // Compacting is the one action on the page that changes what the card states, and a size
        // left saying what it did before the rebuild would be plainly wrong.
        expect(server.get.mock.calls.filter(([ url ]) => url === "database/info")).toHaveLength(2);
    });

    it("says nothing at all where the figures cannot be had", async () => {
        failing.info = true;
        renderPage();
        await settle();

        // A card of empty rows would state no less, and rather less clearly. The rest of the page
        // stands: each card answers for itself.
        expect(container.querySelector(".database-info")).toBeNull();
        expect(button("check-integrity-button")).not.toBeNull();
    });
});

describe("database maintenance", () => {
    it("hands the two tools over to the Content Manager rather than repeating them", async () => {
        renderPage();
        await settle();

        button("analyze-space-usage-button")?.click();
        await settle();

        // The Content Manager opens on Active Content unless asked otherwise, and the page is
        // reached through this page's own note context — Options can itself be a dialog.
        expect(contentManager.requestContentManagerSection).toHaveBeenCalledWith("spaceUsage");
        expect(noteContext.setNote).toHaveBeenCalledWith("_optionsContentManager", { keepActiveDialog: true });

        button("cleanup-button")?.click();
        await settle();

        expect(cleanup.showCleanupDialog).toHaveBeenCalled();
        // Erasing changes what the database holds, so the card above states it again.
        expect(server.get.mock.calls.filter(([ url ]) => url === "database/info")).toHaveLength(2);
    });

    it("leaves the figures alone when the cleanup was called off", async () => {
        cleanup.showCleanupDialog.mockResolvedValue(null);
        renderPage();
        await settle();

        button("cleanup-button")?.click();
        await settle();

        expect(server.get.mock.calls.filter(([ url ]) => url === "database/info")).toHaveLength(1);
    });

    it("runs each check against its own endpoint, and says how it went", async () => {
        renderPage();
        await settle();

        button("check-integrity-button")?.click();
        button("fix-consistency-issues-button")?.click();
        button("vacuum-database-button")?.click();
        await settle();

        expect(server.get).toHaveBeenCalledWith("database/check-integrity");
        expect(server.post).toHaveBeenCalledWith("database/find-and-fix-consistency-issues");
        // With a timeout of its own: a rebuild outlives the default one on a large database.
        expect(server.postWithTimeout).toHaveBeenCalledWith("database/vacuum-database", expect.any(Number));
        expect(toast.showMessage).toHaveBeenCalledWith("database_integrity_check.integrity_check_succeeded");
    });
});

describe("anonymized copies", () => {
    it("reads the existing copies on arrival, and lists the new one it makes", async () => {
        renderPage();
        await settle();

        expect(server.get).toHaveBeenCalledWith("database/anonymized-databases");

        button("light-anonymization-button")?.click();
        await settle();

        expect(server.post).toHaveBeenCalledWith("database/anonymize/light");
        // The copy is a file beside the database, so the list is the only way back to it.
        expect(server.get.mock.calls.filter(([url]) => url === "database/anonymized-databases")).toHaveLength(2);
    });

    it("says so when the copy could not be made, and asks the list for nothing", async () => {
        server.post.mockResolvedValueOnce({ success: false, anonymizedFilePath: "" });
        renderPage();
        await settle();

        button("full-anonymization-button")?.click();
        await settle();

        expect(toast.showError).toHaveBeenCalledWith("database_anonymization.error_creating_anonymized_database");
        expect(server.get.mock.calls.filter(([url]) => url === "database/anonymized-databases")).toHaveLength(1);
    });
});

describe("starting over from Options", () => {
    it("offers the button, and asks nothing of its own before handing over", async () => {
        renderPage();
        await settle();

        // The confirmation is the operating system's or the browser's, not one of this page's.
        expect(container.querySelector(".start-over-pending")).toBeNull();

        button("start-over-button")?.click();
        await settle();

        expect(setupMode.startOver).toHaveBeenCalled();
    });

    it("does not ask a build that restarts itself whether anything is pending", async () => {
        // There is nothing to wait for: the request is acted on by the restart it causes.
        renderPage();
        await settle();

        expect(setupMode.isStartOverPending).not.toHaveBeenCalled();
    });

    it("says a request is standing where the restart is somebody else's to make", async () => {
        setupMode.canBootToSetup.mockReturnValue(false);
        setupMode.startOver.mockResolvedValue("pending");
        renderPage();
        await settle();

        button("start-over-button")?.click();
        await settle();

        // Above the card, since a request left standing is the state of the whole page from here on.
        const notice = container.querySelector(".start-over-pending");
        expect(notice?.textContent).toContain("database.start_over_pending");
        expect(notice?.compareDocumentPosition(container.querySelector(".start-over") as Node))
            .toBe(Node.DOCUMENT_POSITION_FOLLOWING);

        // The button that made it stays where it was, so the row still reads as a whole — but it is
        // out of reach, since the request it would make has already been made.
        expect(button("start-over-button")?.disabled).toBe(true);
    });

    it("takes it back, which is all a server owner can do until they restart", async () => {
        setupMode.canBootToSetup.mockReturnValue(false);
        setupMode.isStartOverPending.mockResolvedValue(true);
        renderPage();
        await settle();

        // Read on arrival: the request outlives the page that made it, so reopening Options is
        // otherwise no way to find out that one is waiting.
        expect(container.querySelector(".start-over-pending")).not.toBeNull();

        button("cancel-start-over-button")?.click();
        await settle();

        expect(setupMode.cancelStartOver).toHaveBeenCalled();
        expect(container.querySelector(".start-over-pending")).toBeNull();
    });

    it("says nothing where the pending question cannot be answered", async () => {
        setupMode.canBootToSetup.mockReturnValue(false);
        setupMode.isStartOverPending.mockRejectedValue(new Error("no answer"));
        renderPage();
        await settle();

        // What is lost is a notice; the button below it is what the page is for.
        expect(container.querySelector(".start-over-pending")).toBeNull();
        expect(button("start-over-button")?.disabled).toBe(false);
    });
});
