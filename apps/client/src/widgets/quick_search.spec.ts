import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import server from "../services/server.js";
import QuickSearchWidget from "./quick_search.js";

describe("QuickSearchWidget", () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("moves focus from the search box to the first result on ArrowDown", async () => {
        const widget = await renderAndSearch();
        const $input = widget.$widget.find(".search-string");
        const $items = widget.$widget.find(".dropdown-menu .dropdown-item");

        expect(pressArrowDown($input[0])).toBe(true);
        expect(document.activeElement).toBe($items[0]);
    });

    it("leaves ArrowDown to the search box while the popup is closed or a modifier is held", async () => {
        const widget = await renderAndSearch();
        const $input = widget.$widget.find(".search-string");
        const $firstItem = widget.$widget.find(".dropdown-menu .dropdown-item").first();

        expect(pressArrowDown($input[0], { ctrlKey: true })).toBe(false);
        expect(pressArrowDown($input[0], { shiftKey: true })).toBe(false);
        expect(document.activeElement).not.toBe($firstItem[0]);

        widget.$widget.find(".dropdown-menu").removeClass("show");
        expect(pressArrowDown($input[0])).toBe(false);
        expect(document.activeElement).not.toBe($firstItem[0]);
    });

    it("leaves ArrowDown alone when the popup holds no result to focus", async () => {
        const widget = await renderAndSearch(0);

        expect(widget.$widget.find(".dropdown-menu .dropdown-item.disabled").length).toBe(1);
        expect(pressArrowDown(widget.$widget.find(".search-string")[0])).toBe(false);
    });
});

/** Returns whether the widget claimed the key, which is what keeps the caret from moving. */
function pressArrowDown(element: HTMLElement, modifiers: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", {
        key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true, ...modifiers
    });
    element.dispatchEvent(event);
    return event.defaultPrevented;
}

async function renderAndSearch(resultCount = 3) {
    const searchResults = Array.from({ length: resultCount }, (_, index) => ({
        notePath: `note${index}`,
        noteTitle: `Note ${index}`,
        notePathTitle: `Note ${index}`,
        highlightedNotePathTitle: `Note ${index}`,
        icon: "bx bx-note"
    }));

    vi.spyOn(server, "get").mockResolvedValue({
        searchResultNoteIds: searchResults.map((result) => result.notePath),
        searchResults,
        error: ""
    } as never);

    const widget = new QuickSearchWidget();
    widget.render();
    // Focus only moves within the document, and `show` is the class Bootstrap opens the menu with.
    widget.$widget.appendTo(document.body);
    widget.$widget.find(".search-string").val("hello");
    await widget.search();
    widget.$widget.find(".dropdown-menu").addClass("show");

    return widget;
}
