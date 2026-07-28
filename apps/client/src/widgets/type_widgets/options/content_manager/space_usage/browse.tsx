import "./browse.css";

import type { SpaceUsageNoteResponse } from "@triliumnext/commons";
import { Fragment } from "preact";
import { useCallback, useEffect, useMemo, useState } from "preact/hooks";

import froca from "../../../../../services/froca";
import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";
import ActionButton from "../../../../react/ActionButton";
import type { DonutRing } from "../../../../react/charts/DonutChart";
import { buildChildrenSegments, type UsageSegmentData } from "./donut_segments";
import NoteUsageDonut, { segmentTooltip } from "./note_usage_donut";
import { useSpaceUsageFetch } from "./use_space_usage_fetch";

const CHILDREN_RING_RADIUS = 180;
const CHILDREN_RING_THICKNESS = 46;

/**
 * The Browse view: the composition donut of the current note wrapped by its children ring, entered
 * from the root and navigated by clicking children. The breadcrumb mirrors the descent and jumps
 * anywhere back up; the back button pops one level.
 */
export default function Browse() {
    const [ stack, setStack ] = useState([ "root" ]);
    const noteId = stack[stack.length - 1];
    const usage = useSpaceUsageFetch<SpaceUsageNoteResponse>(`space-usage/note/${noteId}`);
    const titles = useNoteTitles(stack, usage);
    const getTitle = useCallback((id: string) => titles.get(id) ?? id, [ titles ]);

    const childrenRing: DonutRing<UsageSegmentData> = useMemo(() => ({
        id: "children",
        radius: CHILDREN_RING_RADIUS,
        thickness: CHILDREN_RING_THICKNESS,
        segments: usage ? buildChildrenSegments(usage, {
            getTitle,
            deletedNotesLabel: t("space_usage.deleted_notes"),
            makeTooltip: segmentTooltip,
            makeOthersTooltip: (count, size) =>
                t("space_usage.others_notes", { count, size: formatSize(size) })
        }) : [],
        onSegmentClick: (segment) => {
            const childId = segment.data?.noteId;

            if (childId) {
                setStack((current) => [ ...current, childId ]);
            }
        }
    }), [ usage, getTitle ]);

    return (
        <div className="space-usage-browse">
            <nav className="space-usage-breadcrumb">
                {stack.map((id, index) => (
                    <Fragment key={`${index}/${id}`}>
                        {index > 0 && <span className="space-usage-crumb-separator" aria-hidden="true">›</span>}
                        {index < stack.length - 1 ? (
                            <button
                                type="button"
                                className="space-usage-crumb"
                                onClick={() => setStack((current) => current.slice(0, index + 1))}
                            >{getTitle(id)}</button>
                        ) : (
                            <span className="space-usage-crumb space-usage-crumb-current">{getTitle(id)}</span>
                        )}
                    </Fragment>
                ))}
            </nav>

            {usage ? (
                <div className="space-usage-browse-chart">
                    <NoteUsageDonut
                        usage={usage}
                        title={getTitle(usage.noteId)}
                        notePath={stack}
                        outerRings={[ childrenRing ]}
                        centerActions={
                            <ActionButton
                                className="space-usage-back"
                                icon="bx bx-arrow-back"
                                text={t("space_usage.back")}
                                disabled={stack.length === 1}
                                onClick={() => setStack((current) => current.length > 1 ? current.slice(0, -1) : current)}
                            />
                        }
                    />
                </div>
            ) : (
                <p className="space-usage-loading">{t("space_usage.loading")}</p>
            )}
        </div>
    );
}

/**
 * Batch-loads the titles the view needs — the breadcrumb's path and the children ring's tooltips.
 * Until (or unless) a title arrives, the ID stands in.
 */
function useNoteTitles(stack: string[], usage: SpaceUsageNoteResponse | null) {
    const [ titles, setTitles ] = useState(new Map<string, string>());

    useEffect(() => {
        const noteIds = [ ...stack, ...(usage?.children.map((child) => child.noteId) ?? []) ];
        let cancelled = false;

        // Silent: a note deleted since the usage was computed must not fail the whole view.
        void froca.getNotes(noteIds, true).then((notes) => {
            if (!cancelled) {
                setTitles(new Map(notes.map((note) => [ note.noteId, note.title ])));
            }
        });

        return () => {
            cancelled = true;
        };
    }, [ stack, usage ]);

    return titles;
}
