import type { SpaceUsageBucket, SpaceUsageOverviewNote, SpaceUsageOverviewResponse } from "@triliumnext/commons";

import type { TreemapItem } from "../../../../react/charts/Treemap";

const ROOT_NOTE_ID = "root";

/** What a treemap cell stands for; the bucket cells ("other", "deleted") name no note at all. */
export interface OverviewCell {
    noteId?: string;
    /** Note IDs from the root (inclusive) down to the note, as the cell's actions need it. */
    notePath?: string[];
}

interface OverviewModelOptions {
    otherNotesLabel: string;
    hiddenNotesLabel: string;
    deletedNotesLabel: string;
    /** Folds revision sizes into each cell's weight. */
    includeRevisions: boolean;
    /**
     * Wording for the size a note cell contributes to its hover tooltip, given the weight its area
     * encodes. Omit to leave the cells silent about their size.
     */
    makeSizeDetail?: (size: number) => string;
}

/**
 * Arranges the overview entries into the treemap hierarchy: every entry sits at its canonical tree
 * location, pass-through ancestors shaping the layout without drawing anything, so large notes
 * appear near their siblings and share their parent's hue. An entry that is itself an ancestor of
 * other entries keeps its own weight as a nested self-cell inside its area. The "other notes",
 * "hidden notes" and "deleted notes" buckets join at the top level as inert cells, so every byte
 * the status line counts has a cell somewhere.
 *
 * The cells carry no text — identity comes from hovering: note cells get the note preview tooltip
 * via `data-href`, the bucket cells the chart's own tooltip naming the crowd they stand for.
 */
export function buildOverviewModel(
    overview: SpaceUsageOverviewResponse,
    { otherNotesLabel, hiddenNotesLabel, deletedNotesLabel, includeRevisions, makeSizeDetail }: OverviewModelOptions
): TreemapItem<OverviewCell> {
    const root: TreemapItem<OverviewCell> = { id: "root", children: [] };
    const nodesByNoteId = new Map<string, TreemapItem<OverviewCell>>();

    const ensureNode = (noteId: string, parent: TreemapItem<OverviewCell>) => {
        const existing = nodesByNoteId.get(noteId);

        if (existing) {
            return existing;
        }

        const node: TreemapItem<OverviewCell> = { id: noteId };
        (parent.children ??= []).push(node);
        nodesByNoteId.set(noteId, node);

        return node;
    };

    const entries: { node: TreemapItem<OverviewCell>, entry: SpaceUsageOverviewNote, path: string[] }[] = [];

    for (const entry of overview.notes) {
        const path = pathOf(entry);
        let parent = root;

        for (const noteId of path) {
            parent = ensureNode(noteId, parent);
        }

        entries.push({ node: parent, entry, path });
    }

    // Weights and looks are assigned only after all entries are placed: whether a note needs a
    // nested self-cell depends on whether some later entry turned it into a group.
    for (const { node, entry, path } of entries) {
        const weight = weightOf(entry, includeRevisions);

        if (weight <= 0) {
            continue;
        }

        // The server omits the root from its paths, but a note path the app can act on starts there.
        const cell: OverviewCell = { noteId: entry.noteId, notePath: [ ROOT_NOTE_ID, ...path ] };
        const attributes = {
            "data-href": `#${cell.notePath?.join("/")}`,
            // The note preview tooltip shows this under the title, which is how a cell states its
            // size without any text of its own — and without a second tooltip competing with it.
            ...(makeSizeDetail ? { "data-tooltip-detail": makeSizeDetail(weight) } : {})
        };

        if (node.children?.length) {
            node.children.push({
                id: `${entry.noteId}/own`,
                value: weight,
                // The self-cell sits among the note's own children, so it wears their group hue.
                hue: hueOf(entry.noteId),
                data: cell,
                attributes
            });
        } else {
            node.value = weight;
            node.hue = hueOf(path.at(-2) ?? ROOT_NOTE_ID);
            node.data = cell;
            node.attributes = attributes;
        }
    }

    root.children?.push(
        {
            id: "/other-notes",
            value: bucketWeight(overview.otherNotes, includeRevisions),
            className: "treemap-cell-other",
            tooltip: otherNotesLabel,
            data: {}
        },
        {
            id: "/hidden-notes",
            value: bucketWeight(overview.hiddenNotes, includeRevisions),
            className: "treemap-cell-hidden",
            tooltip: hiddenNotesLabel,
            data: {}
        },
        {
            id: "/deleted-notes",
            value: overview.deletedNotes.size,
            className: "treemap-cell-deleted",
            tooltip: deletedNotesLabel,
            data: {}
        }
    );

    return root;
}

/**
 * The area a bucket's cell takes. Exported so the caller's tooltip can quote the same figure the
 * cell draws, rather than reproducing the rule and drifting from it.
 */
export function bucketWeight(bucket: SpaceUsageBucket, includeRevisions: boolean) {
    return bucket.size + (includeRevisions ? bucket.revisionsSize : 0);
}

/**
 * The tint shared by all cells under one parent: an arbitrary but stable hue hashed from the
 * parent's ID, so the coloring survives reloads and refreshes unchanged.
 */
export function hueOf(noteId: string): number {
    let hash = 5381;

    for (let i = 0; i < noteId.length; i++) {
        hash = ((hash << 5) + hash + noteId.charCodeAt(i)) | 0;
    }

    return Math.abs(hash) % 360;
}

/** The server omits the root from paths, so an entry for the root itself arrives with an empty one. */
function pathOf(entry: SpaceUsageOverviewNote): string[] {
    return entry.notePath.length ? entry.notePath : [ entry.noteId ];
}

function weightOf(entry: SpaceUsageOverviewNote, includeRevisions: boolean) {
    return entry.ownSize + entry.attachmentsSize + (includeRevisions ? entry.revisionsSize : 0);
}
