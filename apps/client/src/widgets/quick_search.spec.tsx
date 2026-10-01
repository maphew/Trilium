import type { EditorView } from "@codemirror/view";
import type { QuickSearchResponse } from "@triliumnext/commons";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import Component from "../components/component";
import { calculateHash } from "../services/link";
import server from "../services/server";
import { renderInto } from "../test/render";
import QuickSearch from "./quick_search";
import { ParentComponent } from "./react/react_utils";

// The completions fetch attribute names and values through the server; nothing here opens the popup.
vi.mock("./ribbon/search_completions", () => ({
    searchCompletionSource: () => null,
    searchCompletionIcon: () => undefined,
    searchCompletionReactivates: () => false
}));

describe("QuickSearch", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("renders the search field, focuses it on the quickSearch shortcut and marks a typed query", async () => {
        const host = new Component();
        const { container, editor } = await mount(host);
        const root = container.querySelector(".quick-search");

        expect(root?.querySelector(".search-string .cm-editor")).not.toBeNull();

        expect(editor.hasFocus).toBe(false);
        await act(async () => {
            await host.handleEvent("quickSearch", {});
        });
        expect(editor.hasFocus).toBe(true);

        expect(root?.classList.contains("has-query")).toBe(false);
        typeQuery(editor, "hello");
        expect(root?.classList.contains("has-query")).toBe(true);
        typeQuery(editor, "");
        expect(root?.classList.contains("has-query")).toBe(false);
    });

    it("searches on Enter and lists the first results with their highlighted snippets", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue(response(30, [ "hello" ]));
        const { editor } = await mount();

        typeQuery(editor, "  hello ");
        pressEnter(editor);

        expect(get).toHaveBeenCalledWith("quick-search/hello");
        const [ first ] = await waitForResults(15);

        expect(first.getAttribute("href")).toBe(calculateHash({
            notePath: "root/note0",
            viewScope: { searchTerms: [ "hello" ] }
        }));
        expect(first.querySelector(".quick-search-item-icon")?.classList.contains("bx-note")).toBe(true);
        expect(first.querySelector(".search-result-title")?.innerHTML).toBe("<b>Note</b> 0");
        expect(first.querySelector(".search-result-attributes")?.innerHTML).toBe("#year=1954 #author=tolkien");
        expect(first.querySelector(".search-result-content")?.innerHTML).toBe("about <b>hello</b>");
    });

    it("links to the plain note path when the search highlighted nothing", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(1, []));
        const { editor } = await mount();

        typeQuery(editor, "#book");
        pressEnter(editor);

        const [ first ] = await waitForResults(1);
        expect(first.getAttribute("href")).toBe(calculateHash({ notePath: "root/note0" }));
    });

    it("shows progress while searching, then says when nothing matches", async () => {
        const pending = deferred<QuickSearchResponse>();
        vi.spyOn(server, "get").mockReturnValue(pending.promise as never);
        const { editor } = await mount();

        typeQuery(editor, "nothing");
        pressEnter(editor);

        await vi.waitFor(() => expect(placeholderItems()).toHaveLength(1));
        expect(placeholderItems()[0].querySelector(".bx-loader")).not.toBeNull();

        await act(async () => pending.resolve(response(0, [])));
        await vi.waitFor(() => expect(placeholderItems()[0]?.querySelector(".bx-loader")).toBeNull());
        expect(placeholderItems()).toHaveLength(1);
        expect(resultItems()).toHaveLength(0);
    });

    it("keeps the results of the latest search when an earlier one answers last", async () => {
        const earlier = deferred<QuickSearchResponse>();
        const later = deferred<QuickSearchResponse>();
        vi.spyOn(server, "get")
            .mockReturnValueOnce(earlier.promise as never)
            .mockReturnValueOnce(later.promise as never);
        const { editor } = await mount();

        typeQuery(editor, "first");
        pressEnter(editor);
        await vi.waitFor(() => expect(menu()).not.toBeNull());

        // Enter on open results runs the search again.
        typeQuery(editor, "second");
        pressEnter(editor);

        await act(async () => later.resolve(response(2, [])));
        await act(async () => earlier.resolve(response(5, [])));
        await waitForResults(2);
    });

    it("leaves the results closed for an empty query, and closes them when one is opened", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { editor } = await mount();

        typeQuery(editor, "   ");
        pressEnter(editor);
        await act(async () => {});
        expect(get).not.toHaveBeenCalled();
        expect(menu()).toBeNull();

        typeQuery(editor, "hello");
        pressEnter(editor);
        const [ first ] = await waitForResults(3);

        await act(async () => first.click());
        await vi.waitFor(() => expect(menu()).toBeNull());
    });

    it("stands the results under the search box, which a press does not close them from", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        // happy-dom lays nothing out, so the viewport is given a size to place the popup in.
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
        const { container, editor } = await mount();
        const box = container.querySelector<HTMLElement>(".quick-search-box");
        if (!box) throw new Error("The search box did not render.");
        vi.spyOn(box, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 20, y: 40, width: 300, height: 30 }));

        typeQuery(editor, "hello");
        pressEnter(editor);
        await waitForResults(3);
        await vi.waitFor(() => expect(menu()?.style.left).toBe("20px"));

        await act(async () => {
            editor.contentDOM.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        });
        expect(menu()).not.toBeNull();
    });
});

/** Renders the component and waits for the CodeMirror modules it imports on demand. */
async function mount(host = new Component()) {
    let container: HTMLDivElement | undefined;
    act(() => {
        container = renderInto(
            <ParentComponent.Provider value={host}>
                <QuickSearch />
            </ParentComponent.Provider>
        );
    });
    if (!container) {
        throw new Error("The component did not render.");
    }

    const { EditorView } = await import("@codemirror/view");
    let editor: EditorView | null = null;
    for (let attempt = 0; attempt < 50 && !editor; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const dom = container.querySelector(".cm-editor");
        editor = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
    }

    if (!editor) {
        throw new Error(`The editor did not mount: ${container.innerHTML}`);
    }

    return { container, editor };
}

function typeQuery(editor: EditorView, value: string) {
    act(() => {
        editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
    });
}

function pressEnter(editor: EditorView) {
    act(() => {
        editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter", code: "Enter", bubbles: true, cancelable: true
        }));
    });
}

/** The popup is portaled to `<body>`, outside the rendered container. */
function menu() {
    return document.querySelector<HTMLElement>(".quick-search-menu");
}

function resultItems() {
    return Array.from(menu()?.querySelectorAll<HTMLAnchorElement>(".quick-search-results > a.dropdown-item") ?? []);
}

async function waitForResults(count: number) {
    return vi.waitFor(() => {
        const items = resultItems();
        expect(items).toHaveLength(count);
        return items;
    });
}

/** The disabled row that stands in for results while searching, or when nothing matches. */
function placeholderItems() {
    return Array.from(menu()?.querySelectorAll(".dropdown-item.disabled") ?? []);
}

function response(count: number, highlightedTokens: string[]): QuickSearchResponse {
    const searchResults = Array.from({ length: count }, (_, index) => ({
        noteId: `note${index}`,
        notePath: `root/note${index}`,
        noteTitle: `Note ${index}`,
        notePathTitle: `Note ${index}`,
        highlightedNotePathTitle: `<b>Note</b> ${index}`,
        highlightedAttributeSnippet: "#year=1954<br>#author=tolkien",
        highlightedContentSnippet: "about <b>hello</b>",
        icon: "bx bx-note"
    }));

    return {
        searchResultNoteIds: searchResults.map((result) => result.noteId),
        searchResults,
        highlightedTokens,
        error: null
    };
}

function deferred<T>() {
    let resolve: (value: T) => void = () => {};
    const promise = new Promise<T>((r) => {
        resolve = r;
    });
    return { promise, resolve };
}
