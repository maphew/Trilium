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
    /**
     * Keep the tab in the strip for a note it has nothing to show, saying so in its body instead of
     * going away. For a tab whose widgets come and go with the type of the note being read: leaving
     * would take the strip's shape — and, where it is the tab on show, the pane's contents — with it,
     * so that merely moving between notes moves the tabs about under the pointer.
     */
    alwaysShown?: boolean;
}

/**
 * The groups the right pane's widgets are divided into, in the order they are offered. A tab with
 * nothing to show for the current note is left out entirely unless it asks to stay, so most notes see
 * fewer than all four.
 */
export const RIGHT_PANE_TABS: RightPaneTabDefinition[] = [
    // The outline is what a note's type decides the most: a text note has headings, a PDF has pages,
    // an image has neither. It stays put through all of them.
    { id: "outline", title: t("right_pane.tab_outline"), icon: "bx bx-list-ul", alwaysShown: true },
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
        // Centred in the row rather than run up against its start (see RightPaneTabs.css).
        <div class="right-pane-tabs">
            {/* A button group, which is how Trilium draws a choice between several things: a recessed
                track with the one on show raised out of it. The theme dresses the class; all this pane
                does is size it to a header row (see RightPaneTabs.css). */}
            <div class="btn-group right-pane-tab-group" role="tablist">
                {tabs.map((tab) => (
                    <RightPaneTab
                        key={tab.id}
                        tab={tab}
                        active={tab.id === activeTabId}
                        onSelect={() => onSelect(tab.id)}
                    />
                ))}
            </div>
        </div>
    );
}

function RightPaneTab({ tab, active, onSelect }: { tab: RightPaneTabDefinition; active: boolean; onSelect: () => void }) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    // No tab is named in the strip, the selected one included: every tab is the same icon-sized segment,
    // which is what keeps the whole group inside a pane narrow enough to only fit the icons. The name is
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
            // `icon-action` is what the button group sizes and fills its segments by; `active` is what
            // it raises the one on show with.
            class={clsx("right-pane-tab icon-action", active && "active")}
            onClick={onSelect}
        >
            <span class={clsx("right-pane-tab-icon tn-icon", tab.icon)} />
        </button>
    );
}
