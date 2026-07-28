import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import options from "../../services/options";
import server from "../../services/server";
import RightPanelWidget, { CollapsibleWidgets } from "./RightPanelWidget";

describe("RightPanelWidget", () => {
    let container: HTMLElement;

    beforeEach(() => {
        // Both widgets below are remembered as collapsed, which only one of them is free to honour.
        options.set("rightPaneCollapsedItems", JSON.stringify([ "solitary", "shared" ]));
        server.put = vi.fn(async () => ({})) as typeof server.put;
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("offers no collapsing when it is the only widget of its tab, remembered collapse and all", async () => {
        await act(async () => render(
            <CollapsibleWidgets.Provider value={false}>
                <RightPanelWidget id="solitary" title="Attributes">the body</RightPanelWidget>
            </CollapsibleWidgets.Provider>, container));

        expect(container.querySelector(".card-header > .icon-action")).toBeNull();
        expect(container.querySelector(".card")?.className).toContain("not-collapsible");
        // Expanded despite being remembered as collapsed: with no chevron there is no way back.
        expect(container.querySelector(".card-body")?.textContent).toBe("the body");

        // And its header is not something to press.
        await act(async () => container.querySelector<HTMLElement>(".card-header")?.click());
        expect(container.querySelector(".card-body")).not.toBeNull();
    });

    it("collapses, and expands again, on a press of its header when it shares its tab", async () => {
        await act(async () => render(
            <CollapsibleWidgets.Provider value={true}>
                <RightPanelWidget id="shared" title="Table of Contents">the body</RightPanelWidget>
            </CollapsibleWidgets.Provider>, container));

        // Starts collapsed, as it was remembered.
        expect(container.querySelector(".card")?.className).toContain("collapsed");
        expect(container.querySelector(".card-body")).toBeNull();
        expect(container.querySelector(".card-header > .icon-action")).not.toBeNull();

        await act(async () => container.querySelector<HTMLElement>(".card-header")?.click());
        expect(container.querySelector(".card")?.className).not.toContain("collapsed");
        expect(container.querySelector(".card-body")?.textContent).toBe("the body");

        await act(async () => container.querySelector<HTMLElement>(".card-header")?.click());
        expect(container.querySelector(".card-body")).toBeNull();
    });
});
