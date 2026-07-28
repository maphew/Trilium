import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useMemo } from "preact/hooks";

import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";
import Treemap, { type TreemapItem } from "../../../../react/charts/Treemap";
import { openSpaceUsageContextMenu, quickEditNote, type ShowDetailsHandler } from "./context_menu";
import { bucketWeight, buildOverviewModel, type OverviewCell } from "./overview_model";

/**
 * A cell's area covers a note's body and attachments, leaving history out; its tooltip says the
 * same. Per-note revision sizes are counted per entity rather than deduplicated, so a revision
 * snapshotting an unchanged body reports its full size while costing the database nothing — folding
 * that into the areas would inflate cells by bytes that were never spent. The status line reports
 * the deduplicated revisions total instead.
 */
const INCLUDE_REVISIONS = false;

interface OverviewProps {
    overview: SpaceUsageOverviewResponse;
    onShowDetails: ShowDetailsHandler;
}

/** The treemap over the whole database: every large note at its tree location. */
export default function Overview({ overview, onShowDetails }: OverviewProps) {
    // The labels are formatted here rather than in the model, which stays free of i18n: a bucket
    // stands for a crowd, so its tooltip names how many notes it holds and how much they take.
    const model = useMemo(() => buildOverviewModel(overview, {
        otherNotesLabel: withSize(
            t("space_usage.other_notes", { count: overview.otherNotes.noteCount }),
            bucketWeight(overview.otherNotes, INCLUDE_REVISIONS)
        ),
        hiddenNotesLabel: withSize(
            t("space_usage.hidden_notes", { count: overview.hiddenNotes.noteCount }),
            bucketWeight(overview.hiddenNotes, INCLUDE_REVISIONS)
        ),
        deletedNotesLabel: withSize(
            t("space_usage.deleted_notes", { count: overview.deletedNotes.noteCount }),
            overview.deletedNotes.size
        ),
        includeRevisions: INCLUDE_REVISIONS,
        makeSizeDetail: (size) => t("space_usage.cell_size", { size: formatSize(size) })
    }), [ overview ]);

    return (
        <div className="space-usage-overview">
            <Treemap<OverviewCell>
                root={model}
                onItemClick={(item) => withCellPath(item, quickEditNote)}
                onItemContextMenu={(item, event) => withCellPath(item, (notePath) =>
                    void openSpaceUsageContextMenu(event, notePath, onShowDetails))}
            />
        </div>
    );
}

/**
 * "Other 1928 notes (512 MiB)" — the same "name (size)" wording the donut segments use, so a
 * bucket reads alike wherever it appears. Composed here rather than baked into the count keys,
 * which Browse reuses on its own and appends the size to itself.
 */
function withSize(name: string, size: number) {
    return t("space_usage.segment_tooltip", { title: name, size: formatSize(size) });
}

/** Runs an action on the cell's note, if it has one — the bucket cells stand for a crowd and stay inert. */
function withCellPath(item: TreemapItem<OverviewCell>, action: (notePath: string[]) => void) {
    const notePath = item.data?.notePath;

    if (notePath?.length) {
        action(notePath);
    }
}
