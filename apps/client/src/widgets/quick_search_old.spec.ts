import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context.js";
import server from "../services/server.js";
import QuickSearchWidget from "./quick_search_old.js";

describe("QuickSearchWidget", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("searches for the query and hands it to the full search", async () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const widget = renderWidget();
        mockResults(1);

        widget.searchString = "#book AND tolkien";
        await widget.search();

        expect(server.get).toHaveBeenCalledWith(`quick-search/${encodeURIComponent("#book AND tolkien")}`);

        widget.$widget.find(".show-in-full-search").trigger("click");
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "#book AND tolkien" });
    });

    it("keeps the full search link pinned below the scrolling results as more load", async () => {
        const widget = renderWidget();
        mockResults(30);

        await widget.search();

        const $menu = widget.$widget.find(".dropdown-menu");
        const $results = $menu.find(".quick-search-results");
        const $footer = $menu.find(".quick-search-footer");

        // The results scroll on their own, so the footer stays visible at the bottom of the menu.
        expect($results.children(".dropdown-item").length).toBe(15);
        expect($results.find(".show-in-full-search").length).toBe(0);
        expect($menu.children().last().is($footer)).toBe(true);
        expect($footer.hasClass("hidden-ext")).toBe(false);
        expect($footer.find(".show-in-full-search").length).toBe(1);

        // happy-dom reports zero scroll metrics, which reads as "scrolled to the bottom".
        $results.trigger("scroll");
        await vi.waitFor(() => expect($results.children(".dropdown-item").length).toBe(25));

        expect($menu.children().last().is($footer)).toBe(true);
        expect($footer.find(".show-in-full-search").length).toBe(1);
    });

    it("hides the full search link while searching and when nothing matches", async () => {
        const widget = renderWidget();
        mockResults(3);
        await widget.search();

        const $footer = widget.$widget.find(".quick-search-footer");
        expect($footer.hasClass("hidden-ext")).toBe(false);

        mockResults(0);
        const search = widget.search();
        expect($footer.hasClass("hidden-ext")).toBe(true);

        await search;
        expect($footer.hasClass("hidden-ext")).toBe(true);
        expect(widget.$widget.find(".quick-search-results .dropdown-item.disabled").length).toBe(1);
    });

    it("runs the full search from the pinned link, by click and by Enter", async () => {
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const widget = renderWidget();
        mockResults(3);
        await widget.search();

        const $link = widget.$widget.find(".show-in-full-search");
        $link.trigger("click");
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "hello" });

        triggerCommand.mockClear();
        $link[0].dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "hello" });
    });
});

function renderWidget() {
    const widget = new QuickSearchWidget();
    widget.render();
    widget.$widget.appendTo(document.body);
    widget.searchString = "hello";
    return widget;
}

function mockResults(count: number) {
    const searchResults = Array.from({ length: count }, (_, index) => ({
        notePath: `note${index}`,
        noteTitle: `Note ${index}`,
        notePathTitle: `Note ${index}`,
        highlightedNotePathTitle: `Note ${index}`,
        icon: "bx bx-note"
    }));

    vi.spyOn(server, "get").mockResolvedValue({
        searchResultNoteIds: searchResults.map((result) => result.notePath),
        searchResults,
        highlightedTokens: ["hello"],
        error: ""
    } as never);
}
