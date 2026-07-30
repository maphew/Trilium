import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    getInt: vi.fn<(name: string) => number | null>(() => -1),
    post: vi.fn(async (_url: string, _body?: object) => {})
}));

vi.mock("../../../../../services/options", () => ({ default: { getInt: mocks.getInt } }));
vi.mock("../../../../../services/server", () => ({ default: { post: mocks.post } }));

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
    keepNamedSnapshots: true
};

beforeEach(() => {
    mocks.getInt.mockReturnValue(-1);
    mocks.post.mockClear();
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
                keepNamedSnapshots: false
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
                keepNamedSnapshots: true
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
        expect(sizes.perItem).toEqual({ deletedEntities: 100, unusedAttachments: 20, revisionSnapshots: 300 });
        expect(sizes.selected).toBe(300 + 100 + 20);
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
        // purges those, so it has to run after the two that create the orphans.
        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([
            "revisions/erase-all-excess-revisions",
            "notes/erase-unused-attachments-now",
            "notes/erase-deleted-notes-now"
        ]);
        expect(mocks.post.mock.calls[0][1]).toEqual({ snapshotsToKeep: 3, keepNamedSnapshots: true });
    });

    it("asks for nothing that was not picked", async () => {
        await runCleanup({ ...ALL_PICKED, revisionSnapshots: false, deletedEntities: false });
        expect(mocks.post.mock.calls.map(([ url ]) => url)).toEqual([ "notes/erase-unused-attachments-now" ]);

        mocks.post.mockClear();
        await runCleanup({ ...ALL_PICKED, deletedEntities: false, unusedAttachments: false, revisionSnapshots: false });
        expect(mocks.post).not.toHaveBeenCalled();
    });
});
