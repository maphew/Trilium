import type { EmojiSuggestion, MentionHostedListState, MentionListState, SlashCommandConfig, SlashCommandDefinition } from "@triliumnext/ckeditor5";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNoteSuggestions, createNoteFromSuggestion } = vi.hoisted(() => ({
    getNoteSuggestions: vi.fn(async () => [ { notePath: "root/a", noteTitle: "Alpha", highlightedNotePathTitle: "Alpha" } ]),
    createNoteFromSuggestion: vi.fn()
}));

vi.mock("../../../services/note_autocomplete", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/note_autocomplete")>()),
    getNoteSuggestions,
    createNoteFromSuggestion
}));

import { createAutocompleteMentionList, createEmojiList, createMentionListView, createNoteMentionList, createSlashCommandList } from "./mention_list_view";

describe("createMentionListView", () => {
    const views: ReturnType<typeof createMentionListView>[] = [];

    afterEach(() => {
        for (const view of views.splice(0)) view.destroy?.();
        vi.restoreAllMocks();
    });

    function stateWith(overrides: Partial<MentionListState> = {}): MentionListState {
        const emoji = document.createElement("span");
        emoji.textContent = "😄 smile";
        const command = document.createElement("button");
        command.className = "ck ck-button ck-slash-command-button";
        command.textContent = "Heading";

        return {
            entries: [
                { item: { id: ":smile:" }, marker: ":", render: () => emoji },
                { item: { id: "/heading" }, marker: "/", render: () => command },
                { item: { id: "#plain" }, marker: "#", render: () => undefined }
            ],
            selectedIndex: 0,
            caretRect: () => new DOMRect(10, 10, 1, 16),
            editable: null,
            select: vi.fn(),
            pick: vi.fn(),
            ...overrides
        };
    }

    async function show(state: MentionListState) {
        const view = createMentionListView();
        views.push(view);
        await act(async () => view.show(state));
        return view;
    }

    const rows = () => [ ...document.querySelectorAll<HTMLElement>(".mention-list-menu .tn-menu-scroll > .dropdown-item") ];

    it("draws the entries as the note autocomplete's menu at the caret, the selected one highlighted", async () => {
        const view = await show(stateWith());

        const menu = view.element;
        expect(menu?.className).toContain("dropdown-menu");
        expect(menu?.className).toContain("note-autocomplete-menu");
        expect(rows().map((row) => row.classList.contains("tn-menu-active"))).toEqual([ true, false, false ]);

        // Each entry as its feed draws it, or by its id.
        const [ emoji, command, plain ] = rows();
        expect(emoji.textContent).toBe("😄 smile");
        expect(command.querySelector(".ck-slash-command-button")?.textContent).toBe("Heading");
        expect(plain.textContent).toBe("#plain");

        await act(async () => view.hide());
        expect(view.element).toBeNull();
        expect(document.querySelector(".mention-list-menu")).toBeNull();
    });

    it("follows the caret as a container around the editor scrolls", async () => {
        const scroller = document.createElement("div");
        scroller.style.overflow = "auto";
        const editable = document.createElement("div");
        scroller.append(editable);
        document.body.append(scroller);
        let caretTop = 100;
        // Floating UI reads the viewport and the popup's size, which happy-dom does not lay out.
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);

        await show(stateWith({ editable, caretRect: () => new DOMRect(10, caretTop, 1, 16) }));
        const menu = document.querySelector<HTMLElement>(".mention-list-menu");
        await vi.waitFor(() => expect(menu?.style.top).toBe("116px"));

        caretTop = 40;
        scroller.dispatchEvent(new Event("scroll"));
        await vi.waitFor(() => expect(menu?.style.top).toBe("56px"));
        scroller.remove();
    });

    it("reports the row the pointer moves onto and the one clicked, not a row under a still pointer", async () => {
        const state = stateWith();
        await show(state);
        const [ , second ] = rows();

        second.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
        expect(state.select).toHaveBeenCalledWith(1);

        vi.mocked(state.select).mockClear();
        second.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 5, clientY: 5 }));
        expect(state.select).not.toHaveBeenCalled();

        second.click();
        expect(state.pick).toHaveBeenCalledWith(1);

        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        second.dispatchEvent(mouseDown);
        expect(mouseDown.defaultPrevented).toBe(true);
    });

    it("scrolls a row the keys select into view, not one the pointer does", async () => {
        const scroll = vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(() => {});
        const state = stateWith();
        const view = await show(state);
        scroll.mockClear();

        await act(async () => view.show({ ...state, selectedIndex: 2 }));
        expect(scroll).toHaveBeenCalledOnce();
        expect(scroll.mock.contexts[0]).toBe(rows()[2]);

        scroll.mockClear();
        vi.mocked(state.select).mockImplementation((index) => void view.show({ ...state, selectedIndex: index }));
        await act(async () => {
            rows()[1].dispatchEvent(new MouseEvent("mousemove", { bubbles: true, clientX: 9, clientY: 9 }));
        });
        expect(state.select).toHaveBeenCalledWith(1);
        expect(scroll).not.toHaveBeenCalled();
    });
});

describe("createNoteMentionList", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function open() {
        const list = createNoteMentionList({ allowCreatingNotes: true });
        const commit = vi.fn<MentionHostedListState["commit"]>();
        await act(async () => list.show({ query: "al", caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit }));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
        return { list, commit };
    }

    it("lists the notes for the query, and mentions the one picked by its path", async () => {
        const { list, commit } = await open();

        expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", { allowCreatingNotes: true, limit: 10 });
        expect(list.element?.textContent).toContain("Alpha");
        expect(list.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }))).toBe(true);
        expect(commit).toHaveBeenCalledExactlyOnceWith({ id: "@root/a", notePath: "root/a" });

        await act(async () => list.hide());
        expect(list.element).toBeNull();
        expect(list.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }))).toBe(false);
        list.destroy?.();
    });

    it("mentions a note it creates once it is created, and nothing where the creation is canceled", async () => {
        getNoteSuggestions.mockResolvedValue([ { action: "create-note", noteTitle: "al", highlightedNotePathTitle: "Create" } ] as never);
        createNoteFromSuggestion.mockResolvedValueOnce("root/inbox/al").mockResolvedValueOnce(undefined);

        const created = await open();
        created.list.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
        expect(await created.commit.mock.calls[0]?.[0]).toEqual({ id: "@root/inbox/al", notePath: "root/inbox/al" });
        created.list.destroy?.();

        const canceled = await open();
        canceled.list.handleKeyDown(new KeyboardEvent("keydown", { key: "Enter", cancelable: true }));
        expect(await canceled.commit.mock.calls[0]?.[0]).toBeUndefined();
        canceled.list.destroy?.();
    });
});

describe("createAutocompleteMentionList", () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it("lists the source's entries as a field's dropdown, and takes one only once it is arrowed to", async () => {
        const source = vi.fn(async (query: string) => [ `${query}One`, `${query}Two` ]);
        const list = createAutocompleteMentionList({
            source,
            renderItem: (item) => <b>{item}</b>,
            toMention: (item) => ({ id: `#${item}` })
        });
        const commit = vi.fn<MentionHostedListState["commit"]>();
        const key = (k: string) => list.handleKeyDown(new KeyboardEvent("keydown", { key: k, cancelable: true }));

        await act(async () => list.show({ query: "ab", caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit }));
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });

        expect(source).toHaveBeenLastCalledWith("ab");
        expect(list.element?.matches(".form-autocomplete-dropdown")).toBe(true);
        expect([ ...(list.element?.querySelectorAll(".form-autocomplete-item > b") ?? []) ].map((row) => row.textContent))
            .toEqual([ "abOne", "abTwo" ]);
        // Nothing is highlighted, so Enter stays with the editor.
        expect(key("Enter")).toBe(false);
        expect(commit).not.toHaveBeenCalled();

        await act(async () => { key("ArrowDown"); });
        await act(async () => { key("ArrowDown"); });
        expect(key("Tab")).toBe(true);
        expect(commit).toHaveBeenCalledExactlyOnceWith({ id: "#abTwo" });

        await act(async () => list.hide());
        expect(list.element).toBeNull();
        list.destroy?.();
    });
});

describe("createSlashCommandList", () => {
    const definitions: SlashCommandDefinition[] = [
        { id: "blockQuote", title: "Block quote", description: "Insert a quote.", icon: "<svg class=\"quote\"></svg>" },
        { id: "snippet-0", title: "Greeting", iconClass: "tn-icon bx bx-note", iconColorClass: "use-note-color" }
    ];

    it("lists the palette's entries as the command palette lists commands, opening on the first, and commits the one picked", async () => {
        const search = vi.fn(() => definitions);
        const editor = { plugins: { get: () => ({ search }) } } as unknown as Parameters<NonNullable<SlashCommandConfig["list"]>>[0];
        const list = createSlashCommandList(editor);
        const commit = vi.fn<MentionHostedListState["commit"]>();
        const key = (k: string) => list.handleKeyDown(new KeyboardEvent("keydown", { key: k, cancelable: true }));

        await act(async () => list.show({ query: "q", caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit }));
        // The list opens, then looks its entries up at once, with no debounce to wait out.
        await act(async () => {});

        expect(search).toHaveBeenLastCalledWith("q");
        expect(list.element?.matches(".dropdown-menu.note-autocomplete-menu.slash-command-menu")).toBe(true);
        const [ quote, greeting ] = [ ...(list.element?.querySelectorAll(".tn-menu-scroll > .dropdown-item") ?? []) ];
        expect(quote.classList.contains("tn-menu-active")).toBe(true);
        expect(quote.querySelector(".tn-icon.note-suggestion-svg-icon > svg.quote")).not.toBeNull();
        expect(quote.querySelector(".search-result-title")?.textContent).toBe("Block quote");
        expect(quote.querySelector(".note-suggestion-description")?.textContent).toBe("Insert a quote.");
        // A snippet's font icon, in its colour, and no description where it has none.
        expect(greeting.querySelector(".tn-icon.bx-note.use-note-color")).not.toBeNull();
        expect(greeting.querySelector(".note-suggestion-description")).toBeNull();

        await act(async () => { key("ArrowDown"); });
        expect(key("Enter")).toBe(true);
        expect(commit).toHaveBeenCalledExactlyOnceWith({ id: "snippet-0", definition: definitions[1] });
        list.destroy?.();
    });
});

describe("createEmojiList", () => {
    const suggestions: EmojiSuggestion[] = [
        { id: ":grinning face:", title: ":grinning face:", text: "😀" },
        { id: ":show-all:", title: "Show all emoji...", text: "grin", opensPicker: true, icon: "<svg class=\"emoji\"></svg>" }
    ];

    it("lists the emoji as command rows, the emoji as the icon, and commits the one picked", async () => {
        const search = vi.fn(() => suggestions);
        const editor = { plugins: { get: () => ({ search }) } } as unknown as Parameters<NonNullable<SlashCommandConfig["list"]>>[0];
        const list = createEmojiList(editor);
        const commit = vi.fn<MentionHostedListState["commit"]>();
        const key = (k: string) => list.handleKeyDown(new KeyboardEvent("keydown", { key: k, cancelable: true }));

        await act(async () => list.show({ query: "grin", caretRect: () => new DOMRect(10, 10, 1, 16), editable: null, commit }));
        await act(async () => {});

        expect(search).toHaveBeenLastCalledWith("grin");
        expect(list.element?.matches(".dropdown-menu.note-autocomplete-menu")).toBe(true);
        const [ grinning, showAll ] = [ ...(list.element?.querySelectorAll(".tn-menu-scroll > .dropdown-item:not(.dropdown-divider)") ?? []) ];
        expect(grinning.classList.contains("tn-menu-active")).toBe(true);
        expect(grinning.querySelector(".tn-icon.note-suggestion-text-icon")?.textContent).toBe("😀");
        expect(grinning.querySelector(".search-result-title")?.textContent).toBe(":grinning face:");
        // The entry opening the picker is set apart, with the icon of the editor's emoji button.
        expect(showAll.previousElementSibling?.matches(".dropdown-divider")).toBe(true);
        expect(showAll.querySelector(".note-suggestion-svg-icon > svg.emoji")).not.toBeNull();
        expect(grinning.previousElementSibling).toBeNull();
        expect(showAll.querySelector(".search-result-title")?.textContent).toBe("Show all emoji...");

        expect(key("Enter")).toBe(true);
        expect(commit).toHaveBeenCalledExactlyOnceWith(suggestions[0]);
        list.destroy?.();
    });
});
