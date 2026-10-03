import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFieldEditor, type FieldEditor, type FieldEditorConfig } from "../field_editor.js";
import { hostedCompletion, type HostedCompletionList, type HostedCompletionState } from "./hosted_completion.js";

let editor: FieldEditor | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
    vi.restoreAllMocks();
});

interface TestMatch {
    from: number;
    query: string;
    explicit: boolean;
}

/**
 * An `@` where a value can stand, the query running to whitespace, as the search field has it; and
 * when asked explicitly, the word before the caret, empty as it can be.
 */
function match(before: string, explicit: boolean): TestMatch | null {
    const mention = /(?:^|\s)@([^\s@]*)$/.exec(before);
    if (mention) {
        const from = before.length - mention[1].length - 1;
        return { from, query: mention[1], explicit };
    }

    const word = /\w*$/.exec(before)?.[0] ?? "";
    return explicit ? { from: before.length - word.length, query: word, explicit } : null;
}

describe("hostedCompletion", () => {
    it("shows what matches before the caret as it changes, and hides the list once nothing does", async () => {
        const { list, shown } = build();

        type("#book @");
        await vi.waitFor(() => expect(shown()?.match.query).toBe(""));
        expect(shown()?.editable).toBe(editor?.dom);

        type("Fo");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("Fo"));
        expect(list.show).toHaveBeenCalledTimes(2);

        // Neither a selection change that keeps the text before the caret nor an empty update shows
        // it again.
        editor?.dispatch({ selection: EditorSelection.cursor(9) });
        editor?.dispatch({});
        await settle();
        expect(list.show).toHaveBeenCalledTimes(2);

        type(" ");
        expect(list.hide).toHaveBeenCalledOnce();

        // Neither inside a word nor over a selection.
        type("#foo@");
        // Set while blurred: happy-dom reports a range set in a focused editor during the update.
        editor?.contentDOM.blur();
        editor?.dispatch({ changes: { from: 0, insert: "@" }, selection: EditorSelection.range(0, 1) });
        editor?.focus();
        await settle();
        expect(list.show).toHaveBeenCalledTimes(2);
    });

    it("puts what the list commits in place of the match, and reads the result again as typing", async () => {
        const { list, shown } = build({ doc: "#book\n" });

        // Typed faster than the list is shown, the older text is never shown.
        type("@F");
        type("o");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("Fo"));
        expect(list.show).toHaveBeenCalledOnce();
        // On the second line, the match starts past the first.
        shown()?.commit("abc123");

        expect(editor?.state.doc.toString()).toBe("#book\nabc123");
        expect(editor?.state.selection.main.head).toBe(12);
        expect(list.hide).toHaveBeenCalledOnce();

        // The list it was shown for has closed, so a late commit changes nothing.
        shown()?.commit("def456");
        expect(editor?.state.doc.toString()).toBe("#book\nabc123");

        // A commit that leaves something to complete opens the list on it.
        type(" @Ba");
        await vi.waitFor(() => expect(shown()?.match.query).toBe("Ba"));
        const before = shown();
        shown()?.commit("x @");
        await vi.waitFor(() => expect(shown()).not.toBe(before));
        expect(shown()?.match.query).toBe("");
        expect(editor?.state.doc.toString()).toBe("#book\nabc123 x @");

        // An edit before an open list's match shows it again, and its commit lands on the match.
        const moved = shown();
        editor?.dispatch({ changes: { from: 0, insert: "~author " } });
        await vi.waitFor(() => expect(shown()).not.toBe(moved));
        shown()?.commit("def456");
        expect(editor?.state.doc.toString()).toBe("~author #book\nabc123 x def456");
    });

    it("forwards the keys to the open list, which takes them from the field", async () => {
        const onArrowDown = vi.fn(() => true);
        const { list, shown } = build({ onArrowDown });

        // Closed, the field has the key.
        expect(press("ArrowDown")).toBe(true);
        expect(onArrowDown).toHaveBeenCalledOnce();

        type("@");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        vi.mocked(list.handleKeyDown).mockReturnValueOnce(true);
        expect(press("ArrowDown")).toBe(true);
        expect(onArrowDown).toHaveBeenCalledOnce();

        // A key the list declines reaches the field, and so does any while an IME composes.
        expect(press("ArrowDown")).toBe(true);
        expect(onArrowDown).toHaveBeenCalledTimes(2);
        vi.mocked(list.handleKeyDown).mockClear();
        press("ArrowDown", { isComposing: true });
        expect(list.handleKeyDown).not.toHaveBeenCalled();
    });

    it("closes on Escape for that match alone, and leaves Escape to the field while the list shows nothing", async () => {
        const onEscape = vi.fn(() => true);
        const { list, shown, setElement } = build({ onEscape });

        type("@");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        expect(press("Escape")).toBe(true);
        expect(onEscape).toHaveBeenCalledOnce();
        expect(list.hide).not.toHaveBeenCalled();

        setElement(document.createElement("div"));
        expect(press("Escape")).toBe(true);
        expect(onEscape).toHaveBeenCalledOnce();
        expect(list.hide).toHaveBeenCalledOnce();

        // Typing on in the same match, even past an edit before it, leaves it closed.
        type("Fo");
        editor?.dispatch({ changes: { from: 0, insert: "#book " } });
        await settle();
        expect(list.show).toHaveBeenCalledOnce();

        // Another match opens it again.
        type(" @");
        await vi.waitFor(() => expect(list.show).toHaveBeenCalledTimes(2));
        expect(shown()?.match.query).toBe("");
    });

    it("asks for an explicit match on Ctrl-Space or Alt-`, until the list closes", async () => {
        const { list, shown, setElement } = build();

        type("#book bo");
        await settle();
        expect(list.show).not.toHaveBeenCalled();

        expect(press(" ", { ctrlKey: true })).toBe(true);
        await vi.waitFor(() => expect(shown()?.match).toEqual({ from: 6, query: "bo", explicit: true }));

        // Asked for while the list is open, or closed with Escape, it shows the list again.
        expect(press("`", { altKey: true })).toBe(true);
        await vi.waitFor(() => expect(list.show).toHaveBeenCalledTimes(2));
        setElement(document.createElement("div"));
        press("Escape");
        expect(list.hide).toHaveBeenCalledOnce();
        press(" ", { ctrlKey: true });
        await vi.waitFor(() => expect(list.show).toHaveBeenCalledTimes(3));

        // Once the list closes, typing alone offers nothing again, past the word it closed on too.
        press("Escape");
        type(" x");
        await settle();
        expect(list.show).toHaveBeenCalledTimes(3);
    });

    it("closes as the editor loses the focus, and takes the list down with it", async () => {
        const { list, shown } = build();

        type("@Fo");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        editor?.contentDOM.blur();
        await vi.waitFor(() => expect(list.hide).toHaveBeenCalledOnce());

        editor?.destroy();
        editor = undefined;
        expect(list.destroy).toHaveBeenCalledOnce();
    });

    it("points the editor at the entry the open list highlights, and at none once it closes", async () => {
        const { shown } = build();
        type("@");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        const open = shown();
        const activeDescendant = () => editor?.contentDOM.getAttribute("aria-activedescendant");

        open?.setActiveDescendant("row-1");
        expect(activeDescendant()).toBe("row-1");
        open?.setActiveDescendant(null);
        expect(activeDescendant()).toBe(null);

        open?.setActiveDescendant("row-2");
        type(" ");
        expect(activeDescendant()).toBe(null);
        // A list that has closed points at nothing.
        open?.setActiveDescendant("row-3");
        expect(activeDescendant()).toBe(null);

        type("@");
        await vi.waitFor(() => expect(shown()).not.toBe(open));
        shown()?.setActiveDescendant("row-4");
        const dom = editor?.contentDOM;
        editor?.destroy();
        editor = undefined;
        expect(dom?.hasAttribute("aria-activedescendant")).toBe(false);
    });

    it("places the list at the caret, or at the editor where the caret has no place on screen", async () => {
        const { shown, placed } = build();
        type("@");
        await vi.waitFor(() => expect(shown()).toBeDefined());
        // Read as CodeMirror shows the list, when it allows no layout reads.
        expect(placed()).toBeInstanceOf(DOMRect);
        const view = editor;
        if (!view) throw new Error("expected an editor");

        vi.spyOn(view, "coordsAtPos").mockReturnValue({ left: 10, right: 11, top: 20, bottom: 36 });
        expect(shown()?.caretRect()).toEqual(new DOMRect(10, 20, 1, 16));

        vi.spyOn(view, "coordsAtPos").mockReturnValue(null);
        vi.spyOn(view.contentDOM, "getBoundingClientRect").mockReturnValue(new DOMRect(1, 2, 3, 4));
        expect(shown()?.caretRect()).toEqual(new DOMRect(1, 2, 3, 4));
    });
});

function build(config: Partial<FieldEditorConfig> = {}) {
    let element: HTMLElement | null = null;
    let state: HostedCompletionState<TestMatch> | undefined;
    let placed: unknown;
    const list = {
        // Places itself as it is shown, as a popup does.
        show: vi.fn((shown: HostedCompletionState<TestMatch>) => {
            state = shown;
            try {
                placed = shown.caretRect();
            } catch (e) {
                placed = e;
            }
        }),
        hide: vi.fn(),
        handleKeyDown: vi.fn(() => false),
        get element() { return element; },
        destroy: vi.fn()
    } satisfies HostedCompletionList<TestMatch>;

    const parent = document.createElement("div");
    document.body.appendChild(parent);
    editor = createFieldEditor({
        parent,
        ...config,
        extensions: [ hostedCompletion({ match, list: () => list }) ]
    });
    editor.focus();
    editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });

    return {
        list,
        shown: () => state,
        placed: () => placed,
        setElement: (el: HTMLElement | null) => { element = el; }
    };
}

/** Types `text` at the caret, leaving the caret after it. */
function type(text: string) {
    const view = editor;
    if (!view) throw new Error("expected an editor");
    const from = view.state.selection.main.head;
    view.dispatch({ changes: { from, insert: text }, selection: EditorSelection.cursor(from + text.length) });
}

/** Waits out the measure pass the list is shown in, so a list that was not shown is known not to be. */
function settle() {
    return new Promise((resolve) => setTimeout(resolve, 50));
}

/** Presses a key on the editor and answers whether a binding handled it. */
function press(key: string, init: KeyboardEventInit = {}) {
    return !editor?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}
