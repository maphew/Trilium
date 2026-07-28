import "./RightPaneTabs.css";

import clsx from "clsx";
import { useRef } from "preact/hooks";

import { t } from "../../services/i18n";
import { useStaticTooltip } from "../react/hooks";

export type RightPaneTabId = "outline" | "attributes" | "chat" | "widgets";

export interface RightPaneTabDefinition {
    id: RightPaneTabId;
    title: string;
    icon: string;
}

/**
 * The groups the right pane's widgets are divided into, in the order they are offered. A tab with
 * nothing to show for the current note is left out entirely, so most notes see fewer than all four.
 */
export const RIGHT_PANE_TABS: RightPaneTabDefinition[] = [
    { id: "outline", title: t("right_pane.tab_outline"), icon: "bx bx-list-ul" },
    { id: "attributes", title: t("right_pane.tab_attributes"), icon: "bx bx-hash" },
    { id: "chat", title: t("right_pane.tab_chat"), icon: "bx bx-bot" },
    // Widgets contributed by the user's own scripts, which belong to none of the groups above.
    { id: "widgets", title: t("right_pane.tab_widgets"), icon: "bx bx-extension" }
];

interface RightPaneTabsProps {
    tabs: RightPaneTabDefinition[];
    activeTabId?: RightPaneTabId;
    onSelect: (tabId: RightPaneTabId) => void;
}

/**
 * The right pane's header: which group of widgets is on show. It doubles as the row the pane's own
 * pin/close actions sit in, so it is rendered whenever the pane is open.
 */
export default function RightPaneTabs({ tabs, activeTabId, onSelect }: RightPaneTabsProps) {
    return (
        <div class="right-pane-tabs" role="tablist">
            {tabs.map((tab) => (
                <RightPaneTab
                    key={tab.id}
                    tab={tab}
                    active={tab.id === activeTabId}
                    onSelect={() => onSelect(tab.id)}
                />
            ))}
        </div>
    );
}

function RightPaneTab({ tab, active, onSelect }: { tab: RightPaneTabDefinition; active: boolean; onSelect: () => void }) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    // No tab is named in the strip, the selected one included: every tab is the same icon-sized square,
    // which is what keeps the whole strip inside a pane narrow enough to only fit the icons. The name is
    // the tooltip, and it is the only place it appears.
    useStaticTooltip(buttonRef, {
        title: tab.title,
        placement: "bottom",
        fallbackPlacements: [ "bottom" ],
        animation: false
    });

    return (
        <button
            ref={buttonRef}
            type="button"
            role="tab"
            aria-selected={active}
            aria-label={tab.title}
            class={clsx("right-pane-tab", active && "active")}
            onClick={onSelect}
        >
            <span class={clsx("right-pane-tab-icon tn-icon", tab.icon)} />
        </button>
    );
}
