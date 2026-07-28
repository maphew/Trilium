import "./index.css";

import type { SpaceUsageOverviewResponse } from "@triliumnext/commons";
import { useCallback, useMemo, useRef, useState } from "preact/hooks";

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
    // Browse's position lives here so that "Show details", offered on any note either view draws,
    // can land the user on that note — switching the view along the way when it comes from Overview.
    const [ browsePath, setBrowsePath ] = useState([ "root" ]);
    const showDetails = useCallback((notePath: string[]) => {
        setBrowsePath(notePath);
        setView("browse");
    }, []);
    // Fetched in both views: the treemap consumes it, and the status line is view-independent.
    // Revisions stay out of the ranking so it shares the basis of the areas the treemap draws —
    // asking for one basis and drawing the other would rank in notes the cells then shrink away.
    const overview = useSpaceUsageFetch<SpaceUsageOverviewResponse>(
        `space-usage/overview?limit=${OVERVIEW_LIMIT}`);

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

            {view === "browse" && <Browse path={browsePath} onPathChange={setBrowsePath} />}
            {view === "overview" && (overview
                ? <Overview overview={overview} onShowDetails={showDetails} />
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
