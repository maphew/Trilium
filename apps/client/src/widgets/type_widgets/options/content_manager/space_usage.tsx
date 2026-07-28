import { t } from "../../../../services/i18n";
import NoItems from "../../../react/NoItems";
import OptionsPageHeader from "../components/OptionsPageHeader";
import type { ContentManagerSectionProps } from "./index";

/** Placeholder section until the Space Usage views (overview treemap, browse charts) land. */
export default function SpaceUsage({ sectionSwitcher }: ContentManagerSectionProps) {
    return (
        <>
            <OptionsPageHeader actions={sectionSwitcher} />
            <NoItems icon="bx bx-pie-chart-alt-2" text={t("space_usage.coming_soon")} />
        </>
    );
}
