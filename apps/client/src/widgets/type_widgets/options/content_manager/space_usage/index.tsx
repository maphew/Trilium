import "./index.css";

import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import debounce from "../../../../../services/debounce";
import { t } from "../../../../../services/i18n";
import server from "../../../../../services/server";
import { formatSize } from "../../../../../services/utils";
import { useTriliumEvent } from "../../../../react/hooks";
import OptionsPageHeader from "../../components/OptionsPageHeader";
import type { ContentManagerSectionProps } from "../index";
import Overview from "./overview";

/** Matches the server default; the treemap could not label more cells anyway. */
const OVERVIEW_LIMIT = 500;

/** One reload per burst — a subtree delete floods entity changes. */
const REFRESH_DEBOUNCE_MS = 1000;

export default function SpaceUsage({ sectionSwitcher }: ContentManagerSectionProps) {
    const overview = useOverview();

    return (
        <div className="space-usage-section">
            <OptionsPageHeader actions={sectionSwitcher} />
            {overview ? (
                <>
                    <Overview overview={overview} />
                    <footer className="space-usage-status">
                        <span>{t("space_usage.status_total", { size: formatSize(overview.total.size) })}</span>
                        <span>{t("space_usage.status_deleted", { size: formatSize(overview.deletedNotes.size) })}</span>
                    </footer>
                </>
            ) : (
                <p className="space-usage-loading">{t("space_usage.loading")}</p>
            )}
        </div>
    );
}

/**
 * Fetches the overview and keeps it current: content changes anywhere — deletes, moves, uploads —
 * shift the sizes, so any note/branch/attachment change schedules one debounced reload. `null`
 * until the first response, so the loading state is distinguishable from an empty database.
 */
function useOverview() {
    const [ overview, setOverview ] = useState<SpaceUsageOverviewResponse | null>(null);
    const latestRequest = useRef(0);

    const refresh = useCallback(async () => {
        const requestId = ++latestRequest.current;
        const response = await server.get<SpaceUsageOverviewResponse>(`space-usage/overview?limit=${OVERVIEW_LIMIT}`);

        // A stale response must not repaint over a newer one.
        if (requestId === latestRequest.current) {
            setOverview(response);
        }
    }, []);

    useEffect(() => { void refresh(); }, [ refresh ]);

    const delayedRefresh = useMemo(() => debounce(() => void refresh(), REFRESH_DEBOUNCE_MS), [ refresh ]);
    useEffect(() => () => delayedRefresh.clear(), [ delayedRefresh ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getNoteIds().length || loadResults.getBranchRows().length || loadResults.getAttachmentRows().length) {
            delayedRefresh();
        }
    });

    return overview;
}
