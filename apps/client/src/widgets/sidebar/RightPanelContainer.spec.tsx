import { describe, expect, it } from "vitest";

import { groupIntoTabs, RightPanelWidgetDefinition } from "./RightPanelContainer";

describe("groupIntoTabs", () => {
    it("keeps the enabled widgets only, in position order, and drops the tabs left empty", () => {
        const toc = widget("outline");
        const highlights = widget("outline");
        const attributes = widget("attributes");
        const chat = widget("chat", { position: 1000 });

        const tabs = groupIntoTabs([
            // Declared out of order, and with a widget of its own in a tab that ends up empty.
            highlights,
            widget("widgets", { enabled: false }),
            chat,
            attributes,
            toc
        ]);

        expect(tabs.map((tab) => tab.id)).toEqual([ "outline", "attributes", "chat" ]);
        // Positions are handed out in declaration order, so `highlights` precedes `toc`.
        expect(tabs[0].items).toEqual([ highlights.el, toc.el ]);
        expect(tabs[1].items).toEqual([ attributes.el ]);
        expect(tabs[2].items).toEqual([ chat.el ]);
    });

    it("has nothing to show when no widget is enabled", () => {
        expect(groupIntoTabs([ widget("outline", { enabled: false }) ])).toEqual([]);
    });

    it("keeps a tab that asks to stay, empty, so that reading another note does not move the strip", () => {
        const attributes = widget("attributes");
        const tabs = groupIntoTabs([ attributes, widget("outline", { enabled: false }) ], true);

        // The outline is the tab that asks; the chat and the widgets go as they did.
        expect(tabs.map((tab) => tab.id)).toEqual([ "outline", "attributes" ]);
        expect(tabs[0].items).toEqual([]);
        expect(tabs[1].items).toEqual([ attributes.el ]);
    });
});

function widget(tab: RightPanelWidgetDefinition["tab"], overrides: Partial<RightPanelWidgetDefinition> = {}) {
    return { el: <div class={tab} />, enabled: true, tab, ...overrides };
}
