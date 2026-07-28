import "./note_usage_donut.css";

import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useMemo, useRef } from "preact/hooks";
import type React from "react";
import { Trans } from "react-i18next";

import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";
import DonutChart, { type DonutRing } from "../../../../react/charts/DonutChart";
import { useStaticTooltip } from "../../../../react/hooks";
import { openNoteInNewTab } from "./context_menu";
import {
    buildCompositionSegments,
    noteWeight,
    subtreeWeight,
    type UsageSegmentData,
    type UsageTooltipKind
} from "./donut_segments";

export const COMPOSITION_RING_RADIUS = 133;
/** Half the children ring's: the note's own breakdown reads as the quieter, supporting ring. */
export const COMPOSITION_RING_THICKNESS = 23;

interface NoteUsageDonutProps {
    usage: SpaceUsageNoteResponse;
    /** Shown in the hole; links to the note and carries its preview tooltip. */
    title: string;
    /** Note IDs from the root (inclusive) down to the note, for the center link and its tooltip. */
    notePath: string[];
    /** Extra rings drawn around the composition ring, e.g. Browse's children ring. */
    outerRings?: DonutRing<UsageSegmentData>[];
    /** Rendered centered above the title in the hole — e.g. Browse's back button. */
    centerActions?: ComponentChildren;
    /** Right-clicking the center title, which stands for the note itself. */
    onTitleContextMenu?: (event: MouseEvent) => void;
    className?: string;
}

/**
 * The composition donut of a single note — body (blue), each attachment (yellow) and revisions
 * (gray) as ring segments, the note's name and total size in the hole. The name is a live note
 * link: it opens the note and carries the note preview tooltip. Reusable wherever one note's usage
 * needs breaking down; Browse wraps it with its children ring via {@link outerRings}.
 */
export default function NoteUsageDonut({ usage, title, notePath, outerRings = [], centerActions, onTitleContextMenu, className }: NoteUsageDonutProps) {
    const compositionRing: DonutRing<UsageSegmentData> = useMemo(() => ({
        id: "composition",
        radius: COMPOSITION_RING_RADIUS,
        thickness: COMPOSITION_RING_THICKNESS,
        segments: buildCompositionSegments(usage, {
            bodyLabel: t("space_usage.note_body"),
            makeTooltip: segmentTooltip,
            makeOthersTooltip: (count, size) =>
                t("space_usage.others_attachments", { count, size: formatSize(size) })
        })
    }), [ usage ]);


    return (
        <DonutChart<UsageSegmentData>
            rings={[ compositionRing, ...outerRings ]}
            className={clsx("note-usage-donut", className)}
            defs={<RevisionsHatch />}
        >
            {centerActions}
            <a
                className="note-usage-donut-title"
                href={`#${notePath.join("/")}`}
                onClick={(event) => {
                    // Handled here: default hash navigation would swap the settings page itself,
                    // and the dialog's link interception must not double-handle it.
                    event.preventDefault();
                    event.stopPropagation();
                    openNoteInNewTab(usage.noteId);
                }}
                onContextMenu={onTitleContextMenu}
            >{title}</a>
            {/* Each line is the total of what surrounds it, so the hole reads as the rings' legend.
                The deduplicated on-disk figures are the hints' business — they answer a different
                question (what erasing would reclaim) and would not match any drawn area. */}
            <div className="note-usage-donut-sizes">
                <SizeLine
                    i18nKey="space_usage.center_note_size"
                    hint={t("space_usage.center_note_size_hint", { size: formatSize(usage.noteContentSize) })}
                    size={noteWeight(usage)}
                />
                <SizeLine
                    i18nKey="space_usage.center_revisions_size"
                    hint={t("space_usage.center_revisions_size_hint")}
                    size={usage.subtreeRevisionsContentSize}
                />
                <SizeLine
                    i18nKey="space_usage.center_subtree_size"
                    hint={t("space_usage.center_subtree_size_hint", { size: formatSize(usage.subtreeContentSize) })}
                    size={subtreeWeight(usage)}
                />
            </div>
        </DonutChart>
    );
}

/**
 * The hatch the revisions segment is stroked with — history reads as the same gray as everything
 * else that is not live content, textured so it is told apart from a note at a glance.
 *
 * A stroke can only reach a pattern through `url(#id)`, which forces a document-wide ID. Two donuts
 * on one page would therefore both resolve to the first — harmless here, since the pattern carries
 * no per-instance state and every copy is identical.
 */
function RevisionsHatch() {
    return (
        <pattern
            id="space-usage-revisions-hatch"
            width="6"
            height="6"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
        >
            <rect className="space-usage-hatch-base" width="6" height="6" />
            <line className="space-usage-hatch-stripe" x1="0" y1="0" x2="0" y2="6" />
        </pattern>
    );
}

/**
 * One labelled center line, the value emphasized, with the app's tooltip explaining what the figure
 * covers. `<Trans>` lets translations put the value wherever their wording needs it.
 */
function SizeLine({ i18nKey, hint, size }: { i18nKey: string, hint: string, size: number }) {
    const ref = useRef<HTMLSpanElement>(null);
    useStaticTooltip(ref, useMemo(() => ({ title: hint, placement: "bottom" }), [ hint ]));

    return (
        <span ref={ref} className="note-usage-donut-size">
            <Trans
                i18nKey={i18nKey}
                components={{
                    Size: <span className="note-usage-donut-size-value">{formatSize(size)}</span> as React.ReactElement
                }}
            />
        </span>
    );
}

/** "Title (1.2 MiB)", prefixed with its case ("Attachment: ", "Child note: ") where one applies. */
export function segmentTooltip(kind: UsageTooltipKind, title: string, size: number) {
    const key = kind === "attachment" ? "space_usage.attachment_tooltip"
        : kind === "child" ? "space_usage.child_tooltip"
            : "space_usage.segment_tooltip";

    return t(key, { title, size: formatSize(size) });
}
