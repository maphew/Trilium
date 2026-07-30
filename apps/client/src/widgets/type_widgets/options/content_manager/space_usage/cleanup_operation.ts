import type { SpaceUsageNoteResponse } from "@triliumnext/commons";

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
 * Erases what the settings ask for, one endpoint per item.
 *
 * Ordered rather than issued at once, and deliberately: erasing revisions or attachments deletes the
 * rows but leaves the blobs they held, which only the deleted-entity sweep purges. Running that last
 * is therefore what actually hands the space back — and when it is not picked, the blobs the other
 * two orphan wait for the hourly cleanup instead.
 */
export async function runCleanup(options: CleanupToolOptions): Promise<void> {
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
}
