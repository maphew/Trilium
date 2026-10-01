import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../components/component";
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
    it("renders the search field and focuses it on the quickSearch shortcut", async () => {
        const host = new Component();
        const { container, editor } = await mount(host);

        expect(container.querySelector(".quick-search .search-string .cm-editor")).not.toBeNull();

        expect(editor.hasFocus).toBe(false);
        await act(async () => {
            await host.handleEvent("quickSearch", {});
        });
        expect(editor.hasFocus).toBe(true);
    });
});

/** Renders the component and waits for the CodeMirror modules it imports on demand. */
async function mount(host: Component) {
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
    let editor: InstanceType<typeof EditorView> | null = null;
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
