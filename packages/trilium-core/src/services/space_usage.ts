import {
    SpaceUsageBucket,
    SpaceUsageDeletedNotes,
    SpaceUsageNoteResponse,
    SpaceUsageOverviewResponse,
    SpaceUsageSizes
} from "@triliumnext/commons";

import becca from "../becca/becca.js";
import { getSql } from "./sql/index.js";

/**
 * Space usage reporting for the Content Manager: how much of the database each note occupies.
 *
 * All byte counting happens in a handful of grouped SQL queries — one pass over the blobs per
 * request, never a query per note. The tree walks stay on becca, which already holds the whole tree
 * in memory.
 *
 * A cloned note lives in several places but occupies space once, so every note is counted at exactly
 * one **canonical placement**: the parent through which it is first reached by a breadth-first walk
 * from the root that enters the hidden subtree last. Reachable outside the hidden subtree means the
 * note is part of the user's visible tree; everything else — launchers, options, orphans — is
 * aggregated into a "hidden" bucket rather than listed note by note.
 *
 * Sizes are `LENGTH(blobs.content)` like the existing per-note stats endpoints, so the numbers match
 * what the note info widget already shows. Blobs shared between entities through deduplication are
 * counted at each entity, so per-note numbers stay meaningful; the deleted-notes aggregate is the
 * exception — it only counts blobs no live entity still uses, i.e. what erasing would reclaim.
 */

export const DEFAULT_OVERVIEW_LIMIT = 250;
export const MAX_OVERVIEW_LIMIT = 1000;

const ROOT_NOTE_ID = "root";
const HIDDEN_ROOT_ID = "_hidden";

export function getOverview({ includeRevisions, limit }: { includeRevisions: boolean, limit: number }): SpaceUsageOverviewResponse {
    const sizes = collectSizes();
    const forest = buildForestFromBecca();
    const rankOf = (entry: SpaceUsageSizes) =>
        entry.ownSize + entry.attachmentsSize + (includeRevisions ? entry.revisionsSize : 0);

    const ranked = forest.userNoteIds
        .map((noteId) => ({ noteId, ...sizesOf(noteId, sizes) }))
        .sort((a, b) => rankOf(b) - rankOf(a) || a.noteId.localeCompare(b.noteId));

    // Zero-sized notes are never worth an individual tile, even when the tree is smaller than the
    // ranking cutoff — they go to the bucket, where they still count.
    const top: typeof ranked = [];
    const others: typeof ranked = [];
    for (const [ index, entry ] of ranked.entries()) {
        (index < limit && rankOf(entry) > 0 ? top : others).push(entry);
    }

    return {
        notes: top.map(({ noteId, ...entrySizes }) => ({
            noteId,
            notePath: buildNotePath(forest.parentByNoteId, noteId),
            ...entrySizes
        })),
        otherNotes: bucketOf(others),
        hiddenNotes: bucketOf(forest.hiddenNoteIds.map((noteId) => sizesOf(noteId, sizes))),
        deletedNotes: collectDeletedNotes(),
        total: bucketOf(ranked)
    };
}

export function getNoteUsage(noteId: string): SpaceUsageNoteResponse {
    const note = becca.getNoteOrThrow(noteId);
    const sizes = collectSizes();
    const forest = buildForestFromBecca();
    const totals = computeSubtreeTotals(forest, (id) => sizesOf(id, sizes));

    const children = (forest.childrenByNoteId.get(noteId) ?? []).map((childId) => {
        const total = totals.get(childId);

        return {
            noteId: childId,
            subtreeSize: total?.size ?? 0,
            subtreeRevisionsSize: total?.revisionsSize ?? 0,
            subtreeNoteCount: total?.noteCount ?? 0
        };
    });

    const attachmentSizes = getSql().getMap<string, number>(
        `
        SELECT attachments.attachmentId, COALESCE(LENGTH(blobs.content), 0)
        FROM attachments
        JOIN blobs ON blobs.blobId = attachments.blobId
        WHERE attachments.ownerId = ? AND attachments.isDeleted = 0`,
        [ noteId ]
    );
    const attachments = note.getAttachments().flatMap((attachment) => {
        if (!attachment.attachmentId) {
            return [];
        }

        return [ {
            attachmentId: attachment.attachmentId,
            title: attachment.getTitleOrProtected(),
            role: attachment.role,
            size: attachmentSizes[attachment.attachmentId] ?? 0
        } ];
    });

    return {
        noteId,
        ...sizesOf(noteId, sizes),
        attachments,
        children,
        // Deleted notes have no place in the tree, so they surface once, at its root.
        ...(noteId === ROOT_NOTE_ID ? { deletedNotes: collectDeletedNotes() } : {})
    };
}

/**
 * Every live note's single place in the tree. The three collections cover exactly the live notes:
 * a note is either in the user walk or in the hidden walk, and has a parent unless it is the root
 * or unreachable.
 */
export interface CanonicalForest {
    /** Canonical parent per note; the root and unreachable notes are absent. */
    parentByNoteId: Map<string, string>;
    /** Canonical children in tree order; a cloned note appears under its canonical parent only. */
    childrenByNoteId: Map<string, string[]>;
    /** Notes reachable outside the hidden subtree, in breadth-first order starting at the root. */
    userNoteIds: string[];
    /** Notes reachable only through the hidden subtree, then any note not reachable at all. */
    hiddenNoteIds: string[];
}

/**
 * Assigns every note its canonical placement: two breadth-first walks, the visible tree first and
 * the hidden subtree second, each note adopted by the parent that reaches it first. A note cloned
 * into both worlds therefore counts as a user note, which is what keeps bookmarks — clones under
 * the hidden bookmarks folder — in the visible listing.
 *
 * @param getChildNoteIds child note IDs in tree order; queried for every visited note.
 * @param allNoteIds every live note, so the walks can sweep up the unreachable leftovers.
 */
export function buildCanonicalForest(
    getChildNoteIds: (noteId: string) => string[],
    allNoteIds: Iterable<string>,
    rootNoteId = ROOT_NOTE_ID,
    hiddenRootId = HIDDEN_ROOT_ID
): CanonicalForest {
    const parentByNoteId = new Map<string, string>();
    const childrenByNoteId = new Map<string, string[]>();
    // Pre-marking the hidden root keeps the first walk out of the hidden subtree.
    const visited = new Set<string>([ rootNoteId, hiddenRootId ]);

    /** Walks breadth-first from the queued notes, recording each adoption. The queue is its own
     *  cursor-scanned array — `shift()` would make the walk quadratic. */
    const walk = (queue: string[]) => {
        for (let i = 0; i < queue.length; i++) {
            const noteId = queue[i];

            for (const childId of getChildNoteIds(noteId)) {
                if (visited.has(childId)) {
                    continue;
                }

                visited.add(childId);
                parentByNoteId.set(childId, noteId);
                childrenByNoteId.set(noteId, [ ...(childrenByNoteId.get(noteId) ?? []), childId ]);
                queue.push(childId);
            }
        }

        return queue;
    };

    const allIds = new Set(allNoteIds);
    const userNoteIds = walk([ rootNoteId ]);
    const hiddenNoteIds: string[] = [];

    if (allIds.has(hiddenRootId)) {
        parentByNoteId.set(hiddenRootId, rootNoteId);
        // Appended after the user children, so the hidden subtree lists last under the root.
        childrenByNoteId.set(rootNoteId, [ ...(childrenByNoteId.get(rootNoteId) ?? []), hiddenRootId ]);
        appendAll(hiddenNoteIds, walk([ hiddenRootId ]));
    }

    // A note reachable from nowhere still occupies space: adopt each such subtree so it is at least
    // counted in the hidden bucket, even though nothing links to it.
    for (const noteId of allIds) {
        if (!visited.has(noteId)) {
            visited.add(noteId);
            appendAll(hiddenNoteIds, walk([ noteId ]));
        }
    }

    return { parentByNoteId, childrenByNoteId, userNoteIds, hiddenNoteIds };
}

/** Spreading can overflow the argument limit on a huge walk, so appending stays a loop. */
function appendAll(target: string[], items: string[]) {
    for (const item of items) {
        target.push(item);
    }
}

/** The aggregate of a note's whole canonical subtree, the note itself included. */
export interface SubtreeTotal {
    /** Bodies plus attachments; revisions kept apart so clients can toggle them. */
    size: number;
    revisionsSize: number;
    noteCount: number;
}

/**
 * Sums every canonical subtree in one linear pass: children strictly follow their parent in each
 * breadth-first order, so walking the orders backwards folds each finished subtree into its parent.
 * The hidden order goes first because its root folds into the tree root, which the user order still
 * has to fold children into afterwards — additions commute, only completeness matters. Iterative on
 * purpose: a pathologically deep tree must not blow the stack.
 */
export function computeSubtreeTotals(
    forest: CanonicalForest,
    getSizes: (noteId: string) => SpaceUsageSizes
): Map<string, SubtreeTotal> {
    const totals = new Map<string, SubtreeTotal>();

    for (const noteId of [ ...forest.userNoteIds, ...forest.hiddenNoteIds ]) {
        const { ownSize, attachmentsSize, revisionsSize } = getSizes(noteId);
        totals.set(noteId, { size: ownSize + attachmentsSize, revisionsSize, noteCount: 1 });
    }

    for (const order of [ forest.hiddenNoteIds, forest.userNoteIds ]) {
        for (let i = order.length - 1; i >= 0; i--) {
            const total = totals.get(order[i]);
            const parentId = forest.parentByNoteId.get(order[i]);
            const parentTotal = parentId === undefined ? undefined : totals.get(parentId);

            if (!total || !parentTotal) {
                continue;
            }

            parentTotal.size += total.size;
            parentTotal.revisionsSize += total.revisionsSize;
            parentTotal.noteCount += total.noteCount;
        }
    }

    return totals;
}

/** The note's canonical ancestor chain, root excluded, ending with the note itself. */
export function buildNotePath(parentByNoteId: Map<string, string>, noteId: string, rootNoteId = ROOT_NOTE_ID): string[] {
    const path: string[] = [];

    for (let current: string | undefined = noteId; current !== undefined && current !== rootNoteId; current = parentByNoteId.get(current)) {
        path.push(current);
    }

    return path.reverse();
}

interface SizeLookup {
    own: Record<string, number>;
    attachments: Record<string, number>;
    revisions: Record<string, number>;
}

/** One grouped pass per component over the blobs — the whole request's byte counting. */
function collectSizes(): SizeLookup {
    const sql = getSql();

    const own = sql.getMap<string, number>(`
        SELECT notes.noteId, COALESCE(LENGTH(blobs.content), 0)
        FROM notes
        JOIN blobs ON blobs.blobId = notes.blobId
        WHERE notes.isDeleted = 0`);

    // Owners that are revisions rather than notes simply never match a live noteId here; their
    // attachments are picked up by the revisions query below.
    const attachments = sql.getMap<string, number>(`
        SELECT attachments.ownerId, SUM(COALESCE(LENGTH(blobs.content), 0))
        FROM attachments
        JOIN blobs ON blobs.blobId = attachments.blobId
        WHERE attachments.isDeleted = 0
        GROUP BY attachments.ownerId`);

    const revisions = sql.getMap<string, number>(`
        SELECT noteId, SUM(size)
        FROM (
            SELECT revisions.noteId AS noteId, COALESCE(LENGTH(blobs.content), 0) AS size
            FROM revisions
            JOIN blobs ON blobs.blobId = revisions.blobId
            UNION ALL
            SELECT revisions.noteId, COALESCE(LENGTH(blobs.content), 0)
            FROM attachments
            JOIN revisions ON revisions.revisionId = attachments.ownerId
            JOIN blobs ON blobs.blobId = attachments.blobId
            WHERE attachments.isDeleted = 0
        )
        GROUP BY noteId`);

    return { own, attachments, revisions };
}

function sizesOf(noteId: string, sizes: SizeLookup): SpaceUsageSizes {
    return {
        ownSize: sizes.own[noteId] ?? 0,
        attachmentsSize: sizes.attachments[noteId] ?? 0,
        revisionsSize: sizes.revisions[noteId] ?? 0
    };
}

function bucketOf(entries: SpaceUsageSizes[]): SpaceUsageBucket {
    const bucket = { size: 0, revisionsSize: 0, noteCount: entries.length };

    for (const entry of entries) {
        bucket.size += entry.ownSize + entry.attachmentsSize;
        bucket.revisionsSize += entry.revisionsSize;
    }

    return bucket;
}

/**
 * What erasing would actually reclaim: blobs referenced by deleted entities and by no live one.
 * Deduplicated by blobId — several deleted clones of the same content free that content once.
 *
 * Every `NOT IN` subquery must filter out NULL blob IDs: a single NULL in the set makes `NOT IN`
 * evaluate to NULL for every row, silently emptying the whole result.
 */
function collectDeletedNotes(): SpaceUsageDeletedNotes {
    const sql = getSql();

    const size = sql.getValue<number | null>(`
        SELECT SUM(COALESCE(LENGTH(blobs.content), 0))
        FROM blobs
        WHERE blobs.blobId IN (
            SELECT blobId FROM notes WHERE isDeleted = 1
            UNION SELECT blobId FROM attachments WHERE isDeleted = 1
            UNION SELECT revisions.blobId FROM revisions
                JOIN notes ON notes.noteId = revisions.noteId
                WHERE notes.isDeleted = 1
        ) AND blobs.blobId NOT IN (
            SELECT blobId FROM notes WHERE isDeleted = 0 AND blobId IS NOT NULL
            UNION SELECT blobId FROM attachments WHERE isDeleted = 0 AND blobId IS NOT NULL
            UNION SELECT revisions.blobId FROM revisions
                JOIN notes ON notes.noteId = revisions.noteId
                WHERE notes.isDeleted = 0 AND revisions.blobId IS NOT NULL
        )`) ?? 0;

    const noteCount = sql.getValue<number>(`
        SELECT COUNT(*)
        FROM notes
        JOIN blobs ON blobs.blobId = notes.blobId
        WHERE notes.isDeleted = 1`);

    return { size, noteCount };
}

function buildForestFromBecca(): CanonicalForest {
    return buildCanonicalForest(
        (noteId) => {
            const note = becca.notes[noteId];
            if (!note) {
                return [];
            }

            return note.getChildBranches()
                .flatMap((branch) => branch ? [ branch ] : [])
                // Sorted here rather than trusting cache order, so the canonical choice between
                // equally deep clones is the same on every instance of a sync cluster.
                .sort((a, b) => a.notePosition - b.notePosition || a.noteId.localeCompare(b.noteId))
                .map((branch) => branch.noteId);
        },
        Object.keys(becca.notes)
    );
}
