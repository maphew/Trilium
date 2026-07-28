import "./index.css";

import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useState } from "preact/hooks";

import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";
import SegmentedChoice from "../../../../react/SegmentedChoice";
import OptionsPageHeader from "../../components/OptionsPageHeader";
import type { ContentManagerSectionProps } from "../index";
import Browse from "./browse";
import Overview from "./overview";
import { useSpaceUsageFetch } from "./use_space_usage_fetch";

/** Matches the server default; the treemap could not label more cells anyway. */
const OVERVIEW_LIMIT = 500;

type SpaceUsageView = "overview" | "browse";

export default function SpaceUsage({ sectionSwitcher }: ContentManagerSectionProps) {
    const [ view, setView ] = useState<SpaceUsageView>("overview");
    // Fetched in both views: the treemap consumes it, and the status line is view-independent.
    const overview = useSpaceUsageFetch<SpaceUsageOverviewResponse>(`space-usage/overview?limit=${OVERVIEW_LIMIT}`);

    return (
        <div className="space-usage-section">
            <OptionsPageHeader actions={sectionSwitcher} below={
                <SegmentedChoice options={VIEWS} currentValue={view} onChange={setView} />
            } />

            {view === "browse" && <Browse />}
            {view === "overview" && (overview
                ? <Overview overview={overview} />
                : <p className="space-usage-loading">{t("space_usage.loading")}</p>)}

            {overview && (
                <footer className="space-usage-status">
                    <span>{t("space_usage.status_total", { size: formatSize(overview.total.size) })}</span>
                    <span>{t("space_usage.status_deleted", { size: formatSize(overview.deletedNotes.size) })}</span>
                </footer>
            )}
        </div>
    );
}

const VIEWS: { value: SpaceUsageView, label: string }[] = [
    { value: "overview", label: t("space_usage.view_overview") },
    { value: "browse", label: t("space_usage.view_browse") }
];
