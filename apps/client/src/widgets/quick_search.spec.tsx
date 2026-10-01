import type { EditorView } from "@codemirror/view";
import type { QuickSearchResponse } from "@triliumnext/commons";
import { options, type VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context";
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

    it("searches on Enter and lists every result with its highlighted snippets", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue(response(30, [ "hello" ]));
        const { editor } = await mount();

        typeQuery(editor, "  hello ");
        pressEnter(editor);

        expect(get).toHaveBeenCalledWith("quick-search/hello");
        const [ first ] = await waitForResults(30);

        expect(first.getAttribute("href")).toBe(calculateHash({
            notePath: "root/note0",
            viewScope: { searchTerms: [ "hello" ] }
        }));
        // The row already shows the note's path and snippets, so the hover preview stays away.
        expect(first.classList.contains("no-tooltip-preview")).toBe(true);
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

    it("opens and closes the results from the search button", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { container, editor } = await mount();
        const button = container.querySelector<HTMLButtonElement>(".search-button");
        if (!button) throw new Error("The search button did not render.");

        typeQuery(editor, "hello");
        await act(async () => button.click());
        await waitForResults(3);
        expect(get).toHaveBeenCalledWith("quick-search/hello");
        expect(button.classList.contains("active")).toBe(true);

        await act(async () => button.click());
        await vi.waitFor(() => expect(menu()).toBeNull());
        expect(button.classList.contains("active")).toBe(false);
    });

    it("moves between the results with Up and Down, and gives the field focus back on Escape", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { editor } = await mount();

        typeQuery(editor, "hello");
        pressEnter(editor);
        const [ first, second ] = await waitForResults(3);

        const press = (target: HTMLElement, key: string) => act(() => {
            target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        });
        first.focus();
        press(first, "ArrowDown");
        expect(document.activeElement).toBe(second);
        press(second, "ArrowUp");
        expect(document.activeElement).toBe(first);

        press(first, "Escape");
        await vi.waitFor(() => expect(menu()).toBeNull());
        expect(editor.hasFocus).toBe(true);
    });

    it("steps from the field into the first result on ArrowDown, and back on ArrowUp", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { editor } = await mount();

        typeQuery(editor, "hello");
        pressEnter(editor);
        const [ first ] = await waitForResults(3);
        editor.focus();

        // A modifier leaves the key to the field.
        pressArrowDown(editor, { ctrlKey: true });
        pressArrowDown(editor, { shiftKey: true });
        expect(editor.hasFocus).toBe(true);

        pressArrowDown(editor);
        expect(document.activeElement).toBe(first);

        act(() => {
            first.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true, cancelable: true }));
        });
        expect(editor.hasFocus).toBe(true);
        expect(menu()).not.toBeNull();
    });

    it("lets the keys and the pointer take turns marking a result", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(3, []));
        const { editor } = await mount();

        typeQuery(editor, "hello");
        pressEnter(editor);
        const [ first, , third ] = await waitForResults(3);
        editor.focus();

        // With focus in the field, a pointer moving over a result leaves the focus there.
        movePointer(third, 4);
        expect(editor.hasFocus).toBe(true);

        // The keys mark their row and silence the hover a resting pointer would add.
        pressArrowDown(editor);
        expect(document.activeElement).toBe(first);
        expect(menu()?.classList.contains("tn-menu-keyboard")).toBe(true);

        // A pointer that does not move, as when a row slides under it, changes nothing.
        movePointer(third, 0);
        expect(document.activeElement).toBe(first);

        // A pointer that moves takes over: its row gets the focus, so the keys go on from there.
        movePointer(third, 4);
        expect(document.activeElement).toBe(third);
        expect(menu()?.classList.contains("tn-menu-keyboard")).toBe(false);
    });

    it("leaves ArrowDown to the field while the results are closed or hold nothing to focus", async () => {
        const get = vi.spyOn(server, "get").mockResolvedValue(response(0, []));
        const { editor } = await mount();

        typeQuery(editor, "nothing");
        editor.focus();
        pressArrowDown(editor);
        expect(editor.hasFocus).toBe(true);
        expect(menu()).toBeNull();

        pressEnter(editor);
        await vi.waitFor(() => expect(get).toHaveBeenCalled());
        await vi.waitFor(() => expect(placeholderItems()[0]?.querySelector(".bx-loader")).toBeNull());
        pressArrowDown(editor);
        expect(editor.hasFocus).toBe(true);
    });

    it("hands the query to the full search from a footer below the results, and on Ctrl+Enter", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(30, []));
        const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        const { editor } = await mount();

        typeQuery(editor, " #book AND tolkien ");
        pressEnter(editor);
        await waitForResults(30);

        // Pinned below the scroller rather than at the end of the list, so it is always in reach.
        const footer = menu()?.lastElementChild;
        expect(footer?.classList.contains("quick-search-footer")).toBe(true);
        const button = footer?.querySelector<HTMLButtonElement>("button");
        if (!button) throw new Error("The footer has no button.");

        await act(async () => button.click());
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "#book AND tolkien" });
        await vi.waitFor(() => expect(menu()).toBeNull());

        // From the field too, with the results closed.
        triggerCommand.mockClear();
        act(() => {
            editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter", ctrlKey: true, bubbles: true, cancelable: true
            }));
        });
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "#book AND tolkien" });
        expect(menu()).toBeNull();
    });

    it("leaves the open results alone while the query is typed", async () => {
        vi.spyOn(server, "get").mockResolvedValue(response(15, []));
        const { editor } = await mount();

        typeQuery(editor, "h");
        pressEnter(editor);
        await waitForResults(15);

        let resultRenders = 0;
        const previousDiffed = options.diffed;
        options.diffed = (vnode: VNode) => {
            if (typeof vnode.type === "function" && vnode.type.name === "QuickSearchResult") resultRenders++;
            previousDiffed?.(vnode);
        };
        try {
            typeQuery(editor, "he");
            typeQuery(editor, "hel");
            typeQuery(editor, "hell");
        } finally {
            options.diffed = previousDiffed;
        }
        expect(resultRenders).toBe(0);
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

function pressArrowDown(editor: EditorView, modifiers: KeyboardEventInit = {}) {
    act(() => {
        editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
            key: "ArrowDown", code: "ArrowDown", bubbles: true, cancelable: true, ...modifiers
        }));
    });
}

function movePointer(target: HTMLElement, movement: number) {
    act(() => {
        target.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, movementX: movement }));
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
