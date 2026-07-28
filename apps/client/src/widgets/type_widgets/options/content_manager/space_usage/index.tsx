import "./index.css";

import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useMemo, useRef, useState } from "preact/hooks";

import { t } from "../../../../../services/i18n";
import { formatSize } from "../../../../../services/utils";
import { useStaticTooltip } from "../../../../react/hooks";
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
    // Revisions count towards the ranking because the treemap shows them in a cell's area — asking
    // for one basis and drawing the other would hide notes whose weight is all history.
    const overview = useSpaceUsageFetch<SpaceUsageOverviewResponse>(
        `space-usage/overview?limit=${OVERVIEW_LIMIT}&includeRevisions=true`);

    return (
        <div className="space-usage-section">
            <OptionsPageHeader actions={sectionSwitcher} below={
                <div className="space-usage-toolbar">
                    <SegmentedChoice
                        className="content-manager-view-choice"
                        options={VIEWS}
                        currentValue={view}
                        onChange={setView}
                    />
                </div>
            } />

            {view === "browse" && <Browse />}
            {view === "overview" && (overview
                ? <Overview overview={overview} />
                : <p className="space-usage-loading">{t("space_usage.loading")}</p>)}

            {overview && (
                <footer className="space-usage-status">
                    <StatusEntry
                        text={t("space_usage.status_content", {
                            count: overview.content.noteCount,
                            size: formatSize(overview.content.size),
                            revisionsSize: formatSize(overview.content.revisionsSize),
                            attachmentsSize: formatSize(overview.content.attachmentsSize)
                        })}
                        hint={t("space_usage.status_content_hint")}
                    />
                    <span className="space-usage-status-separator" aria-hidden="true">–</span>
                    <StatusEntry
                        text={t("space_usage.status_deleted", {
                            count: overview.deletedNotes.noteCount,
                            size: formatSize(overview.deletedNotes.size)
                        })}
                        hint={t("space_usage.status_deleted_hint")}
                    />
                </footer>
            )}
        </div>
    );
}

/**
 * One figure of the status line, with the app's tooltip explaining how it is measured — the
 * distinctions between the figures (deduplicated vs per entity, what each covers) are worth a
 * sentence, but not one taking up the bar itself.
 */
function StatusEntry({ text, hint }: { text: string, hint: string }) {
    const ref = useRef<HTMLSpanElement>(null);
    useStaticTooltip(ref, useMemo(() => ({ title: hint, placement: "top" }), [ hint ]));

    return <span ref={ref}>{text}</span>;
}

const VIEWS: { value: SpaceUsageView, label: string }[] = [
    { value: "overview", label: t("space_usage.view_overview") },
    { value: "browse", label: t("space_usage.view_browse") }
];
