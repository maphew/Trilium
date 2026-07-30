import { type ComponentChildren, render, type VNode } from "preact";
import { useEffect } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";

// Hoisted with the mocks that read them: a `vi.mock` factory runs before any plain module constant.
const {
    REVISIONS_ALL, REVISIONS_TRIMMED, DELETED, UNUSED, FREE_PAGES,
    VACUUM_BEFORE, VACUUM_AFTER, MEASURED_BEFORE, MEASURED_AFTER
} = vi.hoisted(() => ({
    REVISIONS_ALL: 900,
    REVISIONS_TRIMMED: 300,
    DELETED: 100,
    UNUSED: 20,
    /** Pages already free in the file, which only a rebuild returns. */
    FREE_PAGES: 640,
    /** What the rebuild reports for itself, which is the figure a compacting run goes by. */
    VACUUM_BEFORE: 8000,
    VACUUM_AFTER: 3000,
    // Deliberately unlike any estimate above, so a toast quoting a prediction cannot pass for one
    // quoting the measurement.
    MEASURED_BEFORE: 7777,
    MEASURED_AFTER: 1111
}));

const mocks = vi.hoisted(() => ({
    getInt: vi.fn<(name: string) => number | null>(() => -1),
    storedOption: "{}",
    /** Occupied bytes handed to the run's before/after weighings, in that order. */
    weighed: [] as number[],
    save: vi.fn(async () => {}),
    get: vi.fn(),
    post: vi.fn(async (url: string, _body?: object) => (
        url === "database/vacuum-database" ? { sizeBefore: VACUUM_BEFORE, sizeAfter: VACUUM_AFTER } : undefined
    )),
    /** Takes the confirmation element, which one test renders to read what it says. */
    confirm: vi.fn(async (_message?: unknown) => true),
    showMessage: vi.fn<(message: string, timeout?: number) => void>(),
    showPersistent: vi.fn(),
    closePersistent: vi.fn()
}));

vi.mock("../../../../../services/options", () => ({
    default: {
        get: () => mocks.storedOption,
        getInt: mocks.getInt,
        save: mocks.save
    }
}));

vi.mock("../../../../../services/server", () => {
    // The aggressive reading and the trimmed one differ only in the retention they were asked for,
    // which is what the URL carries. Everything else the client loads on the way past is answered
    // emptily rather than with a usage payload it would choke on.
    const get = (url: string) => {
        mocks.get(url);

        if (url === "database/compaction-estimate") {
            return Promise.resolve({ reclaimableBytes: FREE_PAGES });
        }

        if (!url.startsWith("space-usage/")) {
            return Promise.resolve(url === "keyboard-actions" ? [] : {});
        }

        // The overview is what the run weighs itself against, before and after.
        if (url.startsWith("space-usage/overview")) {
            const size = mocks.weighed.shift() ?? MEASURED_AFTER;
            return Promise.resolve({ content: { size }, deletedNotes: { size: 0 } });
        }

        const keeping = /snapshotsToKeep=(\d+)/.exec(url)?.[1];
        return Promise.resolve({
            subtreeRevisionsContentSize: keeping === "0" ? REVISIONS_ALL : REVISIONS_TRIMMED,
            deletedNotes: { size: DELETED, noteCount: 1, attachmentCount: 0 },
            unusedAttachments: { size: UNUSED, attachmentCount: 1 }
        });
    };

    // The run's whole-database calls go through the long-timeout variants, which answer exactly as
    // their plain counterparts do here — the timeout is dropped, leaving the (url, data) the
    // assertions read.
    return {
        default: {
            get,
            getWithTimeout: get,
            post: mocks.post,
            postWithTimeout: (url: string, _timeoutMs: number, data?: object) => mocks.post(url, data)
        }
    };
});

vi.mock("../../../../../services/dialog", () => ({ default: { confirm: mocks.confirm } }));
vi.mock("../../../../../services/toast", () => ({
    default: {
        showMessage: mocks.showMessage,
        showPersistent: mocks.showPersistent,
        closePersistent: mocks.closePersistent
    }
}));

// The real modal reports its close once the animation is done; the stub reports it as soon as it is
// told to hide, which is the signal the dialog's own flow keys off.
vi.mock("../../../../react/Modal", () => ({
    default: function ModalStub({ children, footer, show, onHidden }: {
        children: ComponentChildren, footer: ComponentChildren, show: boolean, onHidden: () => void
    }) {
        useEffect(() => {
            if (!show) {
                onHidden();
            }
            // Keyed on the visibility alone: the dialog hands down a fresh closure each render, and
            // following that identity would report the same close over and over.
            // eslint-disable-next-line react-hooks/exhaustive-deps
        }, [ show ]);

        return show ? <div className="modal-stub">{children}<div className="footer-stub">{footer}</div></div> : null;
    }
}));

import { CLEANUP_TOAST_ID, showCleanupDialog } from "./cleanup_dialog";

function rows() {
    return Array.from(document.body.querySelectorAll<HTMLElement>(".cleanup-item:not(.cleanup-item-nested)"));
}

function nestedRows() {
    return Array.from(document.body.querySelectorAll<HTMLElement>(".cleanup-item-nested"));
}

function titlesOf(sections: HTMLElement[]) {
    return sections.map((section) => section.querySelector(".cleanup-item-title")?.textContent);
}

function textOf(selector: string) {
    return document.body.querySelector<HTMLElement>(selector)?.textContent ?? "";
}

function buttons() {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>(".footer-stub button"));
}

const cancelButton = () => buttons()[0];
const cleanButton = () => buttons()[1];

/**
 * Opens the dialog and lets its opening measurements land. The pending close is handed back wrapped:
 * returned bare, awaiting this helper would adopt it and wait for the dialog to finish.
 */
async function openDialog() {
    const closed = showCleanupDialog();
    // Two measurements land, each through its own effect and state update: a macrotask turn drains
    // the microtasks between them, which flushing promises alone does not.
    await settle();
    await settle();
    return { closed };
}

function settle() {
    return act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/** Flips the switch of a row, the way a click on it does. */
async function toggle(row: HTMLElement | undefined) {
    await act(async () => {
        row?.querySelector<HTMLInputElement>(".switch-toggle")?.dispatchEvent(new Event("input", { bubbles: true }));
    });
}

async function click(button: HTMLButtonElement | undefined) {
    await act(async () => {
        button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
}

beforeEach(() => {
    mocks.storedOption = "{}";
    mocks.weighed = [ MEASURED_BEFORE, MEASURED_AFTER ];
    mocks.getInt.mockReturnValue(-1);
    mocks.confirm.mockResolvedValue(true);
    vi.clearAllMocks();
});

afterEach(() => {
    document.body.innerHTML = "";
});

describe("showCleanupDialog", () => {
    it("opens with nothing picked when the setting has never been written", async () => {
        await openDialog();

        expect(rows().every((row) => !row.querySelector<HTMLInputElement>(".switch-toggle")?.checked)).toBe(true);
        // Nothing picked is nothing to gain, so the button that erases without recourse stays out.
        expect(cleanButton()?.disabled).toBe(true);
        // And the revision qualifiers are beside the point until that item is actually being run.
        expect(nestedRows()).toEqual([]);
    });

    it("reads a stored answer back, qualifiers and all", async () => {
        mocks.storedOption = JSON.stringify({ revisionSnapshots: true, snapshotsToKeep: 2, keepNamedSnapshots: true });
        await openDialog();

        expect(titlesOf(nestedRows())).toEqual([
            t("space_usage.cleanup_snapshots_to_keep") ?? "",
            t("space_usage.cleanup_keep_named") ?? ""
        ]);
        expect(document.body.querySelector<HTMLInputElement>(".cleanup-item-number")?.value).toBe("2");
        expect(cleanButton()?.disabled).toBe(false);
    });

    it("weighs the offer against everything reclaimable, and writes each pick back", async () => {
        mocks.storedOption = JSON.stringify({ revisionSnapshots: true, snapshotsToKeep: 2 });
        await openDialog();

        // The whole is the history erased outright plus the rest; the offer, only what is picked.
        expect(textOf(".cleanup-chart-total")).toBe(
            t("space_usage.cleanup_amount_of", { total: formatSize(REVISIONS_ALL + DELETED + UNUSED) }) ?? "");
        expect(textOf(".cleanup-chart-amount")).toBe(formatSize(REVISIONS_TRIMMED));

        await toggle(rows()[0]);
        expect(textOf(".cleanup-chart-amount")).toBe(formatSize(REVISIONS_TRIMMED + DELETED));
        expect(mocks.save).toHaveBeenCalledWith("cleanupToolOptions", expect.stringContaining('"deletedEntities":true'));
    });

    it("runs only once confirmed, after the dialog is out of the way, and reports what it freed", async () => {
        mocks.storedOption = JSON.stringify({ unusedAttachments: true });
        const { closed } = await openDialog();

        await click(cleanButton());
        // The confirmation is the last chance to back out of something with no recovery.
        expect(mocks.confirm).toHaveBeenCalledOnce();

        // Weighed, not predicted: the estimate on screen was the attachments' own figure, while what
        // is reported is what the database actually gave back.
        const measured = MEASURED_BEFORE - MEASURED_AFTER;
        expect(measured).not.toBe(UNUSED);
        await expect(closed).resolves.toBe(measured);
        expect(mocks.post.mock.calls.map(([ url ]) => url)).toContain("notes/erase-unused-attachments-now");
        // Given longer than the couple of seconds an ordinary message gets: this is the only account
        // of the run the user will see.
        expect(mocks.showMessage).toHaveBeenCalledWith(
            t("space_usage.cleanup_done", { size: formatSize(measured) }), expect.any(Number));
        expect(mocks.showMessage.mock.calls[0][1]).toBeGreaterThan(2000);
        // Gone from the page: it is mounted for the run and unmounted with it.
        expect(document.body.querySelector(".modal-stub")).toBeNull();
    });

    it("offers compacting as a row of its own, with a figure and an arc to match", async () => {
        await openDialog();

        const compact = document.body.querySelector<HTMLElement>(".cleanup-item-compact");
        expect(compact?.querySelector(".cleanup-item-title")?.textContent)
            .toBe(t("space_usage.cleanup_compact_database") ?? "");
        // The pages already free inside the file, standing for space as surely as the content
        // above — so it takes an arc, which is what its swatch beside it names.
        expect(compact?.querySelector(".cleanup-item-size")?.textContent).toBe(formatSize(FREE_PAGES));
        expect(document.body.querySelectorAll(".donut-segment").length).toBe(4);
        expect(document.body.querySelector(".cleanup-segment-compactDatabase")).not.toBeNull();
    });

    it("counts a rebuild into the whole, and into the offer once it is picked", async () => {
        await openDialog();

        // Present in the whole from the start: it is reclaimable whether or not it is asked for.
        expect(textOf(".cleanup-chart-total")).toBe(t("space_usage.cleanup_amount_of", {
            total: formatSize(REVISIONS_ALL + DELETED + UNUSED + FREE_PAGES)
        }) ?? "");
        expect(textOf(".cleanup-chart-amount")).toBe(formatSize(0));

        // Picked on its own, it is the whole of the offer — and worth running, though it erases
        // nothing, so the button has to allow it.
        await toggle(document.body.querySelector<HTMLElement>(".cleanup-item-compact") ?? undefined);
        expect(textOf(".cleanup-chart-amount")).toBe(formatSize(FREE_PAGES));
        expect(cleanButton()?.disabled).toBe(false);
    });

    it("keeps a spinner up for the run, naming the rebuild while it holds the server", async () => {
        mocks.storedOption = JSON.stringify({ unusedAttachments: true, compactDatabase: true });
        const { closed } = await openDialog();

        await click(cleanButton());
        // The rebuild's own before/after is what a compacting run reports, not the content readings.
        await expect(closed).resolves.toBe(VACUUM_BEFORE - VACUUM_AFTER);

        const raised = mocks.showPersistent.mock.calls.map(([ options ]) => options);
        // One toast, its message swapped as the run moves on — the id is what keeps it the same one.
        expect(raised.map((options) => options.id)).toEqual([ CLEANUP_TOAST_ID, CLEANUP_TOAST_ID ]);
        // Compared against the same t() calls; unlike DOM text these are the raw values, so no
        // empty-string coercion to allow for.
        expect(raised.map((options) => options.message)).toEqual([
            t("space_usage.cleanup_running"),
            t("space_usage.cleanup_compacting")
        ]);
        // A spinner rather than a bar: none of this can say how far along it is. And no close
        // button, there being nothing here to cancel.
        expect(raised[0].icon).toBe("bx bx-loader-circle bx-spin");
        expect(raised[0].dismissible).toBe(false);

        expect(mocks.closePersistent).toHaveBeenCalledWith(CLEANUP_TOAST_ID);
    });

    it("reports the file's own reduction as the whole of what a compacting run reclaimed", async () => {
        mocks.storedOption = JSON.stringify({ unusedAttachments: true, compactDatabase: true });
        const { closed } = await openDialog();

        await click(cleanButton());

        // The rebuild returns the pages the erasures freed along with everything else, so its own
        // reduction already covers them — one figure, not one per step.
        await expect(closed).resolves.toBe(VACUUM_BEFORE - VACUUM_AFTER);
        expect(mocks.showMessage).toHaveBeenLastCalledWith(
            t("space_usage.cleanup_done", { size: formatSize(VACUUM_BEFORE - VACUUM_AFTER) }),
            expect.any(Number));
    });

    it("warns what compacting costs, only when it is being asked for", async () => {
        /** The confirmation is handed over as an element; rendering it is how its content is read. */
        const confirmationHtml = async () => {
            const [ message ] = mocks.confirm.mock.calls.at(-1) ?? [];
            const host = document.createElement("div");
            render(message as VNode, host);
            await settle();
            return host.innerHTML;
        };

        mocks.storedOption = JSON.stringify({ unusedAttachments: true });
        await openDialog();
        await click(cleanButton());

        // An erasure-only run is over in seconds; there is nothing to warn about waiting for.
        expect(await confirmationHtml()).not.toContain("admonition");

        mocks.storedOption = JSON.stringify({ unusedAttachments: true, compactDatabase: true });
        await openDialog();
        await click(cleanButton());

        const warned = await confirmationHtml();
        expect(warned).toContain("admonition");
        expect(warned).toContain("warning");
    });

    it("erases nothing when the confirmation is declined, and stays open to be reconsidered", async () => {
        mocks.storedOption = JSON.stringify({ unusedAttachments: true });
        await openDialog();
        mocks.confirm.mockResolvedValue(false);

        await click(cleanButton());

        expect(mocks.post).not.toHaveBeenCalled();
        expect(document.body.querySelector(".modal-stub")).not.toBeNull();
    });

    it("resolves with nothing when the dialog is dismissed, having touched nothing", async () => {
        mocks.storedOption = JSON.stringify({ unusedAttachments: true });
        const { closed } = await openDialog();

        await click(cancelButton());

        await expect(closed).resolves.toBeNull();
        expect(mocks.post).not.toHaveBeenCalled();
        expect(mocks.showMessage).not.toHaveBeenCalled();
    });
});
