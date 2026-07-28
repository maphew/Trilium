import type { SpaceUsageNoteResponse } from "@triliumnext/commons";

import type { DonutSegment } from "../../../../react/charts/DonutChart";
import { hueOf } from "./overview_model";

/** What a donut segment stands for; the bucket segments ("others", "deleted") name neither. */
export interface UsageSegmentData {
    noteId?: string;
    attachmentId?: string;
}

/** Which wording a segment's tooltip gets: a plain label, or one prefixed with its case. */
export type UsageTooltipKind = "plain" | "attachment" | "child";

type MakeTooltip = (kind: UsageTooltipKind, title: string, size: number) => string;

/** Composition segments smaller than this share of the ring consolidate into "Others". */
export const MIN_COMPOSITION_SEGMENT_FRACTION = 0.02;

/** Child segments smaller than this share of the ring consolidate into "Others". */
export const MIN_CHILD_SEGMENT_FRACTION = 0.005;

interface CompositionOptions {
    bodyLabel: string;
    revisionsLabel: string;
    othersLabel: string;
    makeTooltip: MakeTooltip;
}

/**
 * The composition ring of a single note: its body, each attachment on its own, and the revisions
 * total — in that order, attachments largest-first. Empty components are dropped, and segments too
 * small to see consolidate into a trailing "Others".
 */
export function buildCompositionSegments(
    usage: SpaceUsageNoteResponse,
    { bodyLabel, revisionsLabel, othersLabel, makeTooltip }: CompositionOptions
): DonutSegment<UsageSegmentData>[] {
    const segments: DonutSegment<UsageSegmentData>[] = [];

    if (usage.ownSize > 0) {
        segments.push({
            id: "body",
            value: usage.ownSize,
            className: "space-usage-segment-body",
            tooltip: makeTooltip("plain", bodyLabel, usage.ownSize),
            data: { noteId: usage.noteId }
        });
    }

    const attachments = [ ...usage.attachments ]
        .filter((attachment) => attachment.size > 0)
        .sort((a, b) => b.size - a.size || a.attachmentId.localeCompare(b.attachmentId));

    for (const attachment of attachments) {
        segments.push({
            id: `attachment/${attachment.attachmentId}`,
            value: attachment.size,
            className: "space-usage-segment-attachment",
            tooltip: makeTooltip("attachment", attachment.title, attachment.size),
            data: { attachmentId: attachment.attachmentId }
        });
    }

    if (usage.revisionsSize > 0) {
        segments.push({
            id: "revisions",
            value: usage.revisionsSize,
            className: "space-usage-segment-revisions",
            tooltip: makeTooltip("plain", revisionsLabel, usage.revisionsSize)
        });
    }

    return consolidateSmallSegments(segments, MIN_COMPOSITION_SEGMENT_FRACTION, othersLabel, makeTooltip);
}

interface ChildrenOptions {
    getTitle: (noteId: string) => string;
    deletedNotesLabel: string;
    othersLabel: string;
    makeTooltip: MakeTooltip;
}

/**
 * The children ring: each child weighted by its whole subtree, largest first, tinted by its own
 * "random" stable hue. Slivers consolidate into "Others"; on the root, the deleted-notes bucket
 * closes the ring afterwards — deleted space is its own entry, never folded away.
 */
export function buildChildrenSegments(
    usage: SpaceUsageNoteResponse,
    { getTitle, deletedNotesLabel, othersLabel, makeTooltip }: ChildrenOptions
): DonutSegment<UsageSegmentData>[] {
    const children = [ ...usage.children ]
        .filter((child) => child.subtreeSize > 0)
        .sort((a, b) => b.subtreeSize - a.subtreeSize || a.noteId.localeCompare(b.noteId))
        .map((child) => ({
            id: `child/${child.noteId}`,
            value: child.subtreeSize,
            hue: hueOf(child.noteId),
            tooltip: makeTooltip("child", getTitle(child.noteId), child.subtreeSize),
            data: { noteId: child.noteId }
        }));

    const segments = consolidateSmallSegments(children, MIN_CHILD_SEGMENT_FRACTION, othersLabel, makeTooltip);

    if (usage.deletedNotes && usage.deletedNotes.size > 0) {
        segments.push({
            id: "/deleted-notes",
            value: usage.deletedNotes.size,
            className: "space-usage-segment-deleted",
            tooltip: makeTooltip("plain", deletedNotesLabel, usage.deletedNotes.size),
            data: {}
        });
    }

    return segments;
}

/** Replaces the segments below the given share of the ring's total with one inert "Others". */
function consolidateSmallSegments(
    segments: DonutSegment<UsageSegmentData>[],
    minFraction: number,
    othersLabel: string,
    makeTooltip: MakeTooltip
): DonutSegment<UsageSegmentData>[] {
    const total = segments.reduce((sum, segment) => sum + segment.value, 0);

    if (total <= 0) {
        return segments;
    }

    const kept: DonutSegment<UsageSegmentData>[] = [];
    let othersSize = 0;

    for (const segment of segments) {
        if (segment.value / total >= minFraction) {
            kept.push(segment);
        } else {
            othersSize += segment.value;
        }
    }

    if (othersSize > 0) {
        kept.push({
            id: "others",
            value: othersSize,
            className: "space-usage-segment-others",
            tooltip: makeTooltip("plain", othersLabel, othersSize),
            data: {}
        });
    }

    return kept;
}
