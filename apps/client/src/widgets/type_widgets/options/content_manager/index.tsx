import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";

import { t } from "../../../../services/i18n";
import SegmentedChoice from "../../../react/SegmentedChoice";
import type { TypeWidgetProps } from "../../type_widget";
import ActiveContent from "./active_content";
import SpaceUsage from "./space_usage";

type ContentManagerSection = "activeContent" | "spaceUsage";

/** What the shell hands each section: the page's own props plus the switcher between sections. */
export interface ContentManagerSectionProps extends TypeWidgetProps {
    /**
     * Rendered by the section inside its own header's title row, so the choice stays visible while
     * the section's content scrolls beneath it.
     */
    sectionSwitcher: ComponentChildren;
}

/**
 * The Content Manager page: a shell hosting the Active Content listing and the Space Usage tooling,
 * switched by a segmented button. Each section owns its header and toolbar — the shell holds nothing
 * but the choice, which starts over on Active Content each time the page opens.
 */
export default function ContentManagerSettings(props: TypeWidgetProps) {
    const [ section, setSection ] = useState<ContentManagerSection>("activeContent");
    const sectionSwitcher = (
        <SegmentedChoice options={SECTIONS} currentValue={section} onChange={setSection} />
    );

    return section === "spaceUsage"
        ? <SpaceUsage {...props} sectionSwitcher={sectionSwitcher} />
        : <ActiveContent {...props} sectionSwitcher={sectionSwitcher} />;
}

const SECTIONS: { value: ContentManagerSection, label: string }[] = [
    { value: "activeContent", label: t("content_manager.section_active_content") },
    { value: "spaceUsage", label: t("content_manager.section_space_usage") }
];
