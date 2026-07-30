import type { SpaceUsageNoteResponse, SpaceUsageOverviewResponse } from "@triliumnext/commons";

import optionService from "../../../../../services/options";
import server from "../../../../../services/server";

/** The cleanup's items, in the order they are both listed and drawn. */
export const CLEANUP_ITEMS = [
    { id: "deletedEntities", labelKey: "space_usage.cleanup_deleted_entities" },
    { id: "unusedAttachments", labelKey: "space_usage.cleanup_unused_attachments" },
    { id: "revisionSnapshots", labelKey: "space_usage.cleanup_revision_snapshots" }
] as const;

export type CleanupItemId = (typeof CLEANUP_ITEMS)[number]["id"];

/**
 * What the cleanup tool is set to erase, persisted as JSON in the `cleanupToolOptions` option so the
 * next run opens on the last answer rather than on a fresh set of defaults.
 */
export interface CleanupToolOptions {
    deletedEntities: boolean;
    unusedAttachments: boolean;
    revisionSnapshots: boolean;
    /** Revision snapshots kept per note; 0 erases the history outright. */
    snapshotsToKeep: number;
    keepNamedSnapshots: boolean;
}

/** Where the snapshots field starts when no useful limit is configured. */
export const FALLBACK_SNAPSHOTS_TO_KEEP = 4;

/**
 * Fills a stored setting out into the full set the dialog works with. Nothing is picked unless it
 * was picked before — an uninitialized setting erases nothing, which is the only safe reading of an
 * absent answer for an operation that deletes without recourse.
 */
export function readCleanupOptions(stored: Partial<CleanupToolOptions> | null | undefined): CleanupToolOptions {
    const snapshotsToKeep = stored?.snapshotsToKeep;

    return {
        deletedEntities: stored?.deletedEntities === true,
        unusedAttachments: stored?.unusedAttachments === true,
        revisionSnapshots: stored?.revisionSnapshots === true,
        snapshotsToKeep: Number.isInteger(snapshotsToKeep) && Number(snapshotsToKeep) >= 0
            ? Number(snapshotsToKeep)
            : defaultSnapshotsToKeep(),
        keepNamedSnapshots: stored?.keepNamedSnapshots === true
    };
}

/**
 * How many snapshots the field offers to keep before anything has been stored: whatever the note
 * revision limit is set to, so the cleanup opens proposing the retention the user already chose. A
 * limit of -1 keeps everything and 0 keeps none — neither is a useful opening offer for a one-off
 * trim, so both fall back to a figure that plainly trims something without gutting the history.
 */
export function defaultSnapshotsToKeep(): number {
    const configured = optionService.getInt("revisionSnapshotNumberLimit") ?? -1;

    return configured > 0 ? configured : FALLBACK_SNAPSHOTS_TO_KEEP;
}

export interface CleanupSizes {
    /** What erasing each item would free, the revisions measured as the settings would trim them. */
    perItem: Record<CleanupItemId, number>;
    /** Everything reclaimable, the revisions measured at their most aggressive — see below. */
    total: number;
    /** What the picked items would free. */
    selected: number;
}

/**
 * The figures the dialog reads out, from the root's usage measured two ways.
 *
 * The whole is measured with the history erased outright, because that is the most any of these
 * settings can ever reclaim: keeping snapshots only takes away from it. Anything else would leave
 * the reading growing when the user asks to keep *less*, which is not what "of" can mean.
 *
 * @param everything root usage measured at `snapshotsToKeep=0`.
 * @param trimmed root usage measured as the current settings would trim it; the same reading as
 *                {@link everything} whenever those settings are the aggressive ones.
 */
export function computeCleanupSizes(
    everything: SpaceUsageNoteResponse | null,
    trimmed: SpaceUsageNoteResponse | null,
    options: CleanupToolOptions
): CleanupSizes {
    const perItem: Record<CleanupItemId, number> = {
        deletedEntities: everything?.deletedNotes?.size ?? 0,
        unusedAttachments: everything?.unusedAttachments?.size ?? 0,
        revisionSnapshots: trimmed?.subtreeRevisionsContentSize ?? 0
    };

    return {
        perItem,
        total: perItem.deletedEntities + perItem.unusedAttachments + (everything?.subtreeRevisionsContentSize ?? 0),
        selected: CLEANUP_ITEMS.reduce((sum, item) => sum + (options[item.id] ? perItem[item.id] : 0), 0)
    };
}

/**
 * Erases what the settings ask for, one endpoint per item, and reports what that actually freed.
 *
 * The figure is measured rather than estimated: the database is weighed on either side of the run
 * and the difference reported, so what the user is told matches what happened rather than what was
 * predicted. That costs two full measurements on top of the erasures, which is the price of quoting
 * a number that is true.
 *
 * The erasures run one after another rather than at once: each ends by purging the content it
 * orphaned, and there is nothing to be gained by having two of those scan the blobs at the same
 * time. Their order carries no weight beyond that — every one of them hands its own space back.
 *
 * @returns bytes reclaimed, never negative: a note saved by another client mid-run must not read as
 *          the cleanup having given space back.
 */
export async function runCleanup(options: CleanupToolOptions): Promise<number> {
    const before = await measureOccupiedBytes();

    if (options.revisionSnapshots) {
        await server.post("revisions/erase-all-excess-revisions", {
            snapshotsToKeep: options.snapshotsToKeep,
            keepNamedSnapshots: options.keepNamedSnapshots
        });
    }

    if (options.unusedAttachments) {
        await server.post("notes/erase-unused-attachments-now");
    }

    if (options.deletedEntities) {
        await server.post("notes/erase-deleted-notes-now");
    }

    const reclaimed = Math.max(before - await measureOccupiedBytes(), 0);

    // Recorded on the server as well as shown here: this erased content past recovery, and the log
    // is where that is answerable for afterwards.
    await server.post("space-usage/cleanup-completed", { reclaimedBytes: reclaimed });

    return reclaimed;
}

/**
 * Every blob the space report accounts for: the live content plus what deleted entities still hold.
 * Blobs referenced by nothing at all are outside both, which is what makes this the right thing to
 * weigh — a snapshot erased but not yet purged has stopped being content and is on its way out, so
 * the reading falls by its size exactly as the estimate said it would.
 */
async function measureOccupiedBytes(): Promise<number> {
    // The smallest ranking the endpoint will do: the totals are whole-database figures either way,
    // and the listing this would return is of no use here.
    const overview = await server.get<SpaceUsageOverviewResponse>("space-usage/overview?limit=1");

    return overview.content.size + overview.deletedNotes.size;
}
