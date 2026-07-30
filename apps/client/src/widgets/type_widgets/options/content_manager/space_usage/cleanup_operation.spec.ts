import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getInt: vi.fn<(name: string) => number | null>(() => -1),
    post: vi.fn(async (url: string, _body?: object) => (
        url === "database/vacuum-database" ? { sizeBefore: 9000, sizeAfter: 2000 } : undefined
    )),
    /** Occupied bytes, read once before the erasures and once after; shifted per test. */
    occupied: [ 5000, 3000 ],
    get: vi.fn()
}));

vi.mock("../../../../../services/options", () => ({ default: { getInt: mocks.getInt } }));
// The run reaches for the long-timeout variants throughout: every request it makes is a
// whole-database operation. The timeout itself is dropped here, leaving (url, data) as the calls
// under test.
vi.mock("../../../../../services/server", () => ({
    default: {
        // The whole-database operations reach for the long-timeout variants; recording the outcome
        // is an ordinary write and keeps the default. Both funnel here, so the assertions below read
        // the run's calls in order regardless of which variant made them.
        post: mocks.post,
        postWithTimeout: (url: string, _timeoutMs: number, data?: object) => mocks.post(url, data),
        getWithTimeout: (url: string) => {
            mocks.get(url);
            const size = mocks.occupied.shift() ?? 0;
            return Promise.resolve({ content: { size }, deletedNotes: { size: 0 } });
        }
    }
}));

import {
    type CleanupToolOptions,
    computeCleanupSizes,
    readCleanupOptions,
    runCleanup
} from "./cleanup_operation";

/** Only the fields the sizes are read from; the rest of the response is beside the point here. */
function usage(revisions: number, deleted = 0, unused = 0) {
    return {
        subtreeRevisionsContentSize: revisions,
        deletedNotes: { size: deleted, noteCount: 0, attachmentCount: 0 },
        unusedAttachments: { size: unused, attachmentCount: 0 }
    } as SpaceUsageNoteResponse;
}

const ALL_PICKED: CleanupToolOptions = {
    deletedEntities: true,
    unusedAttachments: true,
    revisionSnapshots: true,
    snapshotsToKeep: 3,
    keepNamedSnapshots: true,
    compactDatabase: false
};

beforeEach(() => {
    mocks.getInt.mockReturnValue(-1);
    mocks.occupied = [ 5000, 3000 ];
    mocks.post.mockClear();
    mocks.get.mockClear();
});

describe("readCleanupOptions", () => {
    it("picks nothing at all when the setting has never been written", () => {
        // The only safe reading of an absent answer, for an operation that deletes without recourse.
        for (const stored of [ undefined, null, {} ]) {
            expect(readCleanupOptions(stored)).toEqual({
                deletedEntities: false,
                unusedAttachments: false,
                revisionSnapshots: false,
                snapshotsToKeep: 4,
                keepNamedSnapshots: false,
                compactDatabase: false
            });
        }
    });

    it("opens on the configured revision limit, where that limit trims anything", () => {
        mocks.getInt.mockReturnValue(7);
        expect(readCleanupOptions({}).snapshotsToKeep).toBe(7);

        // -1 keeps everything and 0 keeps none: neither is an opening offer for a one-off trim.
        for (const configured of [ -1, 0 ]) {
            mocks.getInt.mockReturnValue(configured);
            expect(readCleanupOptions({}).snapshotsToKeep).toBe(4);
        }
    });

    it("reads a stored answer back as it was left, zero retention included", () => {
        expect(readCleanupOptions({ revisionSnapshots: true, snapshotsToKeep: 0, keepNamedSnapshots: true }))
            .toEqual({
                deletedEntities: false,
                unusedAttachments: false,
                revisionSnapshots: true,
                snapshotsToKeep: 0,
                keepNamedSnapshots: true,
                compactDatabase: false
            });

        // A retention that could not have been written by the dialog falls back rather than through.
        expect(readCleanupOptions({ snapshotsToKeep: -5 }).snapshotsToKeep).toBe(4);
    });
});

describe("computeCleanupSizes", () => {
    it("weighs the whole at the most aggressive trim, and the offer at the chosen one", () => {
        const sizes = computeCleanupSizes(usage(900, 100, 20), usage(300), ALL_PICKED);

        // Keeping snapshots can only take away from what erasing the history outright would free,
        // so the whole stays put while the item's own figure follows the settings.
        expect(sizes.total).toBe(900 + 100 + 20);
        expect(sizes.compaction).toBe(0);
        expect(sizes.perItem).toEqual({ deletedEntities: 100, unusedAttachments: 20, revisionSnapshots: 300 });
        expect(sizes.selected).toBe(300 + 100 + 20);
    });

    it("adds what a rebuild would return, which no content figure describes", () => {
        const withCompaction = computeCleanupSizes(usage(900, 100, 20), usage(300), ALL_PICKED, 500);

        // Free pages are what erasing already finished with; the figures above weigh content still
        // to be erased. Neither ever describes the same byte, so the whole is their sum.
        expect(withCompaction.compaction).toBe(500);
        expect(withCompaction.total).toBe(900 + 100 + 20 + 500);
        // Not on offer until compacting is picked, though.
        expect(withCompaction.selected).toBe(300 + 100 + 20);
        expect(computeCleanupSizes(usage(900, 100, 20), usage(300),
            { ...ALL_PICKED, compactDatabase: true }, 500).selected).toBe(300 + 100 + 20 + 500);
    });

    it("counts only what is picked, and nothing at all before the measurements arrive", () => {
        const sizes = computeCleanupSizes(usage(900, 100, 20), usage(300),
            { ...ALL_PICKED, deletedEntities: false, revisionSnapshots: false });
        expect(sizes.selected).toBe(20);

        const unmeasured = computeCleanupSizes(null, null, ALL_PICKED);
        expect(unmeasured.total).toBe(0);
        expect(unmeasured.selected).toBe(0);
    });
});

describe("runCleanup", () => {
    it("erases what is picked, sweeping the orphaned blobs last", async () => {
        await runCleanup(ALL_PICKED);

        // Erasing revisions or attachments leaves the blobs they held; only the deleted-entity sweep
        // purges those, so it has to run after the two that create the orphans. The outcome is
        // recorded last of all, once there is a measured figure to record.
        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([
            "revisions/erase-all-excess-revisions",
            "notes/erase-unused-attachments-now",
            "notes/erase-deleted-notes-now",
            "space-usage/cleanup-completed"
        ]);
        expect(mocks.post.mock.calls[0][1]).toEqual({ snapshotsToKeep: 3, keepNamedSnapshots: true });
    });

    it("reports what the database actually gave back, not what was predicted", async () => {
        mocks.occupied = [ 5000, 1200 ];

        // Weighed on either side of the erasures — the whole point of the two extra readings.
        await expect(runCleanup(ALL_PICKED)).resolves.toBe(3800);
        expect(mocks.get.mock.calls.map(([ url ]) => url))
            .toEqual([ "space-usage/overview?limit=1", "space-usage/overview?limit=1" ]);
        expect(mocks.post).toHaveBeenCalledWith("space-usage/cleanup-completed", { reclaimedBytes: 3800 });
    });

    it("never reports a gain when the database grew under it", async () => {
        // Another client saving a note mid-run must not read as the cleanup handing space back.
        mocks.occupied = [ 3000, 4000 ];
        await expect(runCleanup(ALL_PICKED)).resolves.toBe(0);
    });

    it("rebuilds the file last, and reports the file's own before and after", async () => {
        // The rebuild returns 9000 → 2000; the content readings would have said 2000. The file is
        // the truer figure and subsumes the erasures, whose pages the rebuild is what hands back.
        await expect(runCleanup({ ...ALL_PICKED, compactDatabase: true })).resolves.toBe(7000);

        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([
            "revisions/erase-all-excess-revisions",
            "notes/erase-unused-attachments-now",
            "notes/erase-deleted-notes-now",
            "database/vacuum-database",
            "space-usage/cleanup-completed"
        ]);
        expect(mocks.post).toHaveBeenCalledWith("space-usage/cleanup-completed", { reclaimedBytes: 7000 });
        // And the content weighings are skipped entirely, being two readings of the whole database
        // for a figure that is not going to be used.
        expect(mocks.get).not.toHaveBeenCalled();
    });

    it("compacts on its own, for a run that erases nothing at all", async () => {
        mocks.occupied = [ 5000, 5000 ];
        const nothingErased = {
            ...ALL_PICKED,
            deletedEntities: false,
            unusedAttachments: false,
            revisionSnapshots: false,
            compactDatabase: true
        };

        await runCleanup(nothingErased);

        expect(mocks.post.mock.calls.map(([ url ]) => url))
            .toEqual([ "database/vacuum-database", "space-usage/cleanup-completed" ]);
    });

    it("asks for nothing that was not picked", async () => {
        await runCleanup({ ...ALL_PICKED, revisionSnapshots: false, deletedEntities: false });
        expect(mocks.post.mock.calls.map(([ url ]) => url))
            .toEqual([ "notes/erase-unused-attachments-now", "space-usage/cleanup-completed" ]);

        mocks.post.mockClear();
        mocks.occupied = [ 5000, 5000 ];
        await runCleanup({ ...ALL_PICKED, deletedEntities: false, unusedAttachments: false, revisionSnapshots: false });
        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([ "space-usage/cleanup-completed" ]);
    });
});
