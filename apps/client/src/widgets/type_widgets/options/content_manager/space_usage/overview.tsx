import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useMemo } from "preact/hooks";

import appContext from "../../../../../components/app_context";
import { t } from "../../../../../services/i18n";
import Treemap, { type TreemapItem } from "../../../../react/charts/Treemap";
import { buildOverviewModel, type OverviewCell } from "./overview_model";

/** The treemap over the whole database: every large note at its tree location. */
export default function Overview({ overview }: { overview: SpaceUsageOverviewResponse }) {
    const model = useMemo(() => buildOverviewModel(overview, {
        otherNotesLabel: t("space_usage.other_notes"),
        hiddenNotesLabel: t("space_usage.hidden_notes"),
        deletedNotesLabel: t("space_usage.deleted_notes"),
        includeRevisions: false
    }), [ overview ]);

    return (
        <div className="space-usage-overview">
            <Treemap<OverviewCell> root={model} onItemClick={openCellNote} />
        </div>
    );
}

/**
 * Opens the clicked note in a new tab, leaving the settings page in place. The bucket cells carry
 * no note and do nothing.
 */
function openCellNote(item: TreemapItem<OverviewCell>) {
    const noteId = item.data?.noteId;

    if (!noteId) {
        return;
    }

    void appContext.tabManager.openContextWithNote(noteId, {
        activate: true,
        hoistedNoteId: appContext.tabManager.getActiveContext()?.hoistedNoteId ?? null
    });
}
