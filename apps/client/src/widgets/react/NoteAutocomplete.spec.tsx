import { createRef, render as preactRender } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNoteSuggestions, getCommandSuggestions, createNoteFromSuggestion } = vi.hoisted(() => ({
    createNoteFromSuggestion: vi.fn<(suggestion: Suggestion) => Promise<string | undefined>>(),
    getNoteSuggestions: vi.fn<(term: string, options?: NoteSuggestionOptions) => Promise<Suggestion[]>>(async () => []),
    getCommandSuggestions: vi.fn<(term: string) => Suggestion[]>(() => [])
}));

vi.mock("../../services/note_autocomplete", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/note_autocomplete")>()),
    getNoteSuggestions,
    getCommandSuggestions,
    createNoteFromSuggestion
}));

import appContext from "../../components/app_context";
import type { NoteSuggestionOptions, Suggestion } from "../../services/note_autocomplete";
import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import NoteAutocomplete, { type NoteAutocompleteHandle, type NoteAutocompleteProps } from "./NoteAutocomplete";

async function render(props: NoteAutocompleteProps = {}) {
    let container = document.createElement("div");
    await act(async () => {
        container = renderInto(<NoteAutocomplete {...props} />);
    });
    // Lets `froca.getNote()` resolve the title of a `noteId`.
    await act(async () => {
        await new Promise((resolve) => setTimeout(resolve));
    });

    const input = container.querySelector<HTMLInputElement>("input");
    if (!input) throw new Error("no input rendered");
    return { container, input };
}

/** The classes of the buttons after the input, in document order. */
function buttonClasses(container: HTMLElement) {
    return [ ...container.querySelectorAll(".input-group > a") ].map((button) => button.className);
}

describe("NoteAutocomplete", () => {
    it("renders the input with the classes and attributes of the jQuery plugin", async () => {
        const { container, input } = await render({ id: "picker", placeholder: "Find" });

        expect(container.firstElementChild?.className).toBe("input-group");
        expect(input.className).toBe("note-autocomplete form-control note-autocomplete-input aa-input");
        expect(input.id).toBe("picker");
        expect(input.placeholder).toBe("Find");
        expect(input.getAttribute("autocomplete")).toBe("off");
        expect(input.getAttribute("dir")).toBe("auto");
    });

    it("sets tabIndex on the input only when the host gives one", async () => {
        expect((await render({ tabIndex: 205 })).input.getAttribute("tabindex")).toBe("205");
        expect((await render()).input.hasAttribute("tabindex")).toBe(false);
    });

    it("places the buttons after the input in the plugin's order, as the options allow", async () => {
        expect(buttonClasses((await render()).container)).toEqual([
            "input-group-text go-to-selected-note-button bx bx-arrow-to-right disabled",
            "input-group-text full-text-search-button bx bx-search",
            "input-group-text show-recent-notes-button bx bx-time",
            "input-group-text input-clearer-button bx bxs-tag-x"
        ]);

        const withoutGoTo = buttonClasses((await render({ opts: { hideGoToSelectedNoteButton: true } })).container);
        expect(withoutGoTo).toHaveLength(3);
        expect(withoutGoTo[0]).toContain("full-text-search-button");

        expect(buttonClasses((await render({ opts: { hideAllButtons: true } })).container)).toEqual([]);
    });

    it("shows the title of the note given, and enables going to it", async () => {
        const note = buildNote({ title: "Target" });
        const { container, input } = await render({ noteId: note.noteId });

        expect(input.value).toBe("Target");
        expect(input.dataset.notePath).toBe(note.noteId);
        const goTo = container.querySelector(".go-to-selected-note-button");
        expect(goTo?.classList.contains("disabled")).toBe(false);
        expect(goTo?.getAttribute("href")).toBe(`#${note.noteId}`);
    });

    it("shows the text given, trimmed, with no note selected", async () => {
        const { container, input } = await render({ text: "  query " });

        expect(input.value).toBe("query");
        expect(input.dataset.notePath).toBe("");
        expect(container.querySelector(".go-to-selected-note-button")?.getAttribute("href")).toBe("#");
    });

    it("reports typing, and the selected note id on blur", async () => {
        const note = buildNote({ title: "Target" });
        const onTextChange = vi.fn();
        const onBlur = vi.fn();
        const { input } = await render({ noteId: note.noteId, onTextChange, onBlur });

        await act(async () => {
            input.value = "Targ";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(onTextChange).toHaveBeenCalledWith("Targ");

        await act(async () => {
            input.focus();
            input.blur();
        });
        expect(onBlur).toHaveBeenLastCalledWith(note.noteId);

        await act(async () => {
            input.value = " ";
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await act(async () => {
            input.focus();
            input.blur();
        });
        expect(onBlur).toHaveBeenLastCalledWith("");
    });
});

describe("NoteAutocomplete's suggestion list", () => {
    const notes: Suggestion[] = [
        { notePath: "root/a", noteTitle: "Alpha", notePathTitle: "Alpha", highlightedNotePathTitle: "<b>Al</b>pha", icon: "bx bx-file" },
        { notePath: "root/x/b", noteTitle: "Beta", notePathTitle: "X / Beta", highlightedNotePathTitle: "X / Beta",
            highlightedAttributeSnippet: "#tag" }
    ];
    const commands: Suggestion[] = [
        { action: "command", commandId: "cmd1", noteTitle: "Cmd One", highlightedNotePathTitle: "Cmd One",
            commandDescription: "Does a thing", commandShortcut: "Ctrl+1", icon: "bx bx-cog" },
        { action: "command", commandId: "cmd2", noteTitle: "Cmd Two", highlightedNotePathTitle: "Cmd Two" }
    ];

    beforeEach(() => {
        vi.useFakeTimers();
        getNoteSuggestions.mockReset();
        getNoteSuggestions.mockResolvedValue(notes);
        getCommandSuggestions.mockReset();
        getCommandSuggestions.mockReturnValue(commands);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function mount(props: NoteAutocompleteProps = {}) {
        let input: HTMLInputElement | null = null;
        await act(async () => {
            input = renderInto(<NoteAutocomplete {...props} />).querySelector("input");
        });
        if (!input) throw new Error("no input rendered");
        return input as HTMLInputElement;
    }

    /** Lets the debounced lookup run and the popup place itself. */
    async function settle() {
        await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    }

    async function type(input: HTMLInputElement, text: string) {
        await act(async () => {
            input.value = text;
            input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        await settle();
    }

    async function press(input: HTMLInputElement, key: string, modifiers: KeyboardEventInit = {}) {
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
        });
        await settle();
    }

    /** The queries the notes were looked up for, in order. */
    function queries() {
        return getNoteSuggestions.mock.calls.map(([ query ]) => query);
    }

    function rows() {
        return [ ...document.querySelectorAll<HTMLElement>(".note-autocomplete-menu > .tn-menu-scroll > .dropdown-item") ];
    }

    it("lists the notes as the rows of a menu, the first one highlighted", async () => {
        const input = await mount();
        await type(input, "al");

        expect(queries().at(-1)).toBe("al");
        const [ alpha, beta ] = rows();
        expect(rows()).toHaveLength(2);
        expect(document.querySelector(".note-autocomplete-menu")?.className)
            .toContain("dropdown-menu show tn-dropdown-menu tn-menu-keyboard");
        expect(alpha.className).toBe("dropdown-item tn-menu-active");
        expect(alpha.querySelector(".tn-icon")?.className).toBe("bx bx-file tn-icon");
        expect(alpha.querySelector(".search-result-title")?.innerHTML).toBe("<b>Al</b>pha");
        expect(beta.querySelector(".tn-icon")?.className).toBe("bx bx-note tn-icon");
        expect(beta.querySelector(".search-result-attributes")?.textContent).toBe("#tag");
        expect(input.getAttribute("aria-expanded")).toBe("true");
        expect(input.getAttribute("aria-activedescendant")).toBe(alpha.id);
    });

    it("gives each kind of row its icon, and never shows a content snippet", async () => {
        getNoteSuggestions.mockResolvedValue([
            { action: "search-notes", highlightedNotePathTitle: "S" },
            { action: "create-note", highlightedNotePathTitle: "C" },
            { action: "create-child-note", highlightedNotePathTitle: "C" },
            { action: "external-link", highlightedNotePathTitle: "E" },
            // The list matches by title and attributes, so a body excerpt would suggest a content
            // match that fast search never made.
            { notePath: "root/c", highlightedNotePathTitle: "T", highlightedContentSnippet: "some <b>matched</b> content" } as Suggestion
        ]);
        const input = await mount();
        await type(input, "x");

        expect(rows().map((row) => row.querySelector(".tn-icon")?.className)).toEqual([
            "bx bx-search tn-icon", "bx bx-plus tn-icon", "bx bx-subdirectory-right tn-icon", "bx bx-link-external tn-icon", "bx bx-note tn-icon"
        ]);
        expect(rows()[4].textContent).toBe("T");
    });

    it("picks the highlighted note with Enter, and reports it", async () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const input = await mount({ onChange, noteIdChanged });
        await type(input, "b");
        await press(input, "ArrowDown");
        expect(rows()[1].classList.contains("tn-menu-active")).toBe(true);

        await press(input, "Enter");
        expect(onChange).toHaveBeenCalledWith(notes[1]);
        expect(noteIdChanged).toHaveBeenCalledWith("b");
        expect(input.value).toBe("Beta");
        expect(input.dataset.notePath).toBe("root/x/b");
        expect(rows()).toHaveLength(0);
    });

    it("searches on the first keystroke, and paces the rest of a burst", async () => {
        const input = await mount();

        for (const term of [ "a", "al", "alp" ]) {
            await act(async () => {
                input.value = term;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            });
        }
        // No timer has run, so the debounce of `FormAutocomplete` would not have searched yet.
        expect(queries()).toEqual([ "a" ]);

        await settle();
        expect(queries()).toEqual([ "a", "alp" ]);
    });

    it("lists the recent notes from the clock button, emptying the field", async () => {
        const onTextChange = vi.fn();
        const input = await mount({ onTextChange });
        await type(input, "a");
        await press(input, "Enter");
        expect(input.dataset.notePath).toBe("root/a");
        input.blur();

        const button = document.querySelector<HTMLElement>(".show-recent-notes-button");
        if (!button) throw new Error("no recent notes button rendered");
        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        button.dispatchEvent(mouseDown);
        await act(async () => { button.click(); });
        await settle();

        expect(mouseDown.defaultPrevented).toBe(true);
        expect(input.value).toBe("");
        expect(input.dataset.notePath).toBe("");
        expect(onTextChange).toHaveBeenLastCalledWith("");
        expect(queries().at(-1)).toBe("");
        expect(rows()).toHaveLength(2);
        expect(document.activeElement).toBe(input);
    });

    it("lists the recent notes through the handle, with the callbacks of the latest render", async () => {
        const handleRef = createRef<NoteAutocompleteHandle>();
        const firstOnTextChange = vi.fn();
        let container = document.createElement("div");
        await act(async () => {
            container = renderInto(<NoteAutocomplete handleRef={handleRef} onTextChange={firstOnTextChange} />);
        });
        const input = container.querySelector("input");
        if (!input) throw new Error("no input rendered");
        await type(input, "a");
        await press(input, "Enter");

        const latestOnTextChange = vi.fn();
        await act(async () => {
            preactRender(<NoteAutocomplete handleRef={handleRef} onTextChange={latestOnTextChange} />, container);
        });
        input.blur();
        firstOnTextChange.mockClear();

        await act(async () => { handleRef.current?.showRecentNotes(); });
        await settle();

        expect(input.value).toBe("");
        expect(input.dataset.notePath).toBe("");
        expect(latestOnTextChange).toHaveBeenCalledWith("");
        expect(firstOnTextChange).not.toHaveBeenCalled();
        expect(queries().at(-1)).toBe("");
        expect(rows()).toHaveLength(2);
        expect(document.activeElement).toBe(input);
    });

    it("lists into the host's container, open past a blur, Escape and Tab, until a pick", async () => {
        const host = document.createElement("div");
        document.body.append(host);
        const input = await mount({ container: { current: host } });
        await type(input, "a");

        const menu = host.querySelector<HTMLElement>(":scope > span.aa-dropdown-menu");
        expect(menu?.querySelectorAll(".aa-suggestion")).toHaveLength(2);
        // In the host's flow, as `autocomplete.js` left it: its contained menu had only `display: block`.
        expect(menu?.hasAttribute("style")).toBe(false);
        expect(document.querySelector(".note-autocomplete-menu")).toBeNull();

        await act(async () => {
            input.focus();
            input.blur();
        });
        expect(host.querySelectorAll(".aa-suggestion")).toHaveLength(2);

        // Both are left to the host, as a dialog closes on Escape.
        const reachedHost: string[] = [];
        const listen = (e: KeyboardEvent) => reachedHost.push(e.key);
        document.body.addEventListener("keydown", listen);
        await press(input, "Escape");
        await press(input, "Tab");
        document.body.removeEventListener("keydown", listen);
        expect(host.querySelectorAll(".aa-suggestion")).toHaveLength(2);
        expect(reachedHost).toEqual([ "Escape", "Tab" ]);

        await press(input, "Enter");
        expect(host.querySelector(".aa-dropdown-menu")).toBeNull();
        host.remove();
    });

    it("lists the commands for a `>` in a command palette, in the plugin's markup", async () => {
        // In a host's container, as Jump to Note lists them.
        const host = document.createElement("div");
        document.body.append(host);
        const input = await mount({ opts: { isCommandPalette: true }, container: { current: host } });
        await type(input, "> cmd");

        expect(getCommandSuggestions).toHaveBeenLastCalledWith("> cmd");
        expect(getNoteSuggestions).not.toHaveBeenCalled();
        const [ described, bare ] = host.querySelectorAll<HTMLElement>(".aa-suggestion");
        expect(described.querySelector(".command-suggestion > .command-icon")?.className).toBe("command-icon bx bx-cog");
        expect(described.querySelector(".command-content > .command-name")?.textContent).toBe("Cmd One");
        expect(described.querySelector(".command-content > .command-description")?.textContent).toBe("Does a thing");
        expect(described.querySelector(".command-suggestion > kbd.command-shortcut")?.textContent).toBe("Ctrl+1");
        expect(bare.querySelector(".command-icon")?.className).toBe("command-icon bx bx-terminal");
        expect(bare.querySelector(".command-description, .command-shortcut")).toBeNull();
        host.remove();

        // Elsewhere a `>` is only text to search for.
        const plain = await mount();
        await type(plain, "> cmd");
        expect(queries().at(-1)).toBe("> cmd");
        expect(getCommandSuggestions).toHaveBeenCalledTimes(1);
    });

    it("reports a picked command and leaves the field as it was", async () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const input = await mount({ opts: { isCommandPalette: true }, onChange, noteIdChanged });
        await type(input, ">");
        await press(input, "Enter");

        expect(onChange).toHaveBeenCalledWith(commands[0]);
        expect(noteIdChanged).not.toHaveBeenCalled();
        expect(input.value).toBe(">");
        expect(input.dataset.notePath).toBe("");
        expect(rows()).toHaveLength(0);
    });

    it("lists every command through the handle", async () => {
        const handleRef = createRef<NoteAutocompleteHandle>();
        const onTextChange = vi.fn();
        const input = await mount({ opts: { isCommandPalette: true }, handleRef, onTextChange });

        await act(async () => { handleRef.current?.showAllCommands(); });
        await settle();

        expect(input.value).toBe(">");
        expect(onTextChange).toHaveBeenLastCalledWith(">");
        expect(getCommandSuggestions).toHaveBeenLastCalledWith(">");
        expect(rows()).toHaveLength(2);
        expect(document.activeElement).toBe(input);
    });

    it("lists the suggestions for the text given", async () => {
        const onTextChange = vi.fn();
        const input = await mount({ text: "  al ", onTextChange });
        await settle();

        expect(input.value).toBe("al");
        expect(onTextChange).toHaveBeenCalledWith("al");
        expect(queries().at(-1)).toBe("al");
        expect(rows()).toHaveLength(2);
    });

    it("sets the text through the handle at once, with its note selected, and lists it", async () => {
        const handleRef = createRef<NoteAutocompleteHandle>();
        const input = await mount({ handleRef });
        input.blur();

        // Read before any render, as Add Link selects the text right after the call.
        act(() => {
            handleRef.current?.setText("  Beta ", "root/x/b");
            expect(input.value).toBe("Beta");
        });
        await settle();

        expect(input.dataset.notePath).toBe("root/x/b");
        expect(queries().at(-1)).toBe("Beta");
        expect(rows()).toHaveLength(2);
        expect(document.activeElement).not.toBe(input);
    });

    function button(selector: string) {
        const found = document.querySelector<HTMLElement>(selector);
        if (!found) throw new Error(`no ${selector} rendered`);
        return found;
    }

    it("empties the field and reports a cleared selection from the clear button", async () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const onTextChange = vi.fn();
        const input = await mount({ onChange, noteIdChanged, onTextChange });
        await type(input, "a");
        await press(input, "Enter");

        await act(async () => { button(".input-clearer-button").click(); });

        expect(input.value).toBe("");
        expect(input.dataset.notePath).toBe("");
        expect(onTextChange).toHaveBeenLastCalledWith("");
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(noteIdChanged).toHaveBeenLastCalledWith(undefined);
    });

    it("searches the content from the full-text button, saying so until the results come", async () => {
        let finish: (rows: Suggestion[]) => void = () => {};
        const onChange = vi.fn();
        const input = await mount({ onChange });
        await type(input, "al");
        getNoteSuggestions.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));

        const mouseDown = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
        button(".full-text-search-button").dispatchEvent(mouseDown);
        await act(async () => { button(".full-text-search-button").click(); });
        await settle();

        expect(mouseDown.defaultPrevented).toBe(true);
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", expect.objectContaining({ fastSearch: false }));
        expect(rows()).toHaveLength(1);
        expect(rows()[0].querySelector(".search-result-title")).not.toBeNull();
        expect(rows()[0].getAttribute("role")).toBeNull();

        // Enter waits for the results rather than taking a row of the fast search.
        await press(input, "Enter");
        expect(input.dataset.notePath).toBe("");

        await act(async () => { finish([ notes[1] ]); });
        await settle();
        expect(rows()).toHaveLength(1);
        expect(rows()[0].querySelector(".search-result-title")?.textContent).toBe("X / Beta");
        expect(onChange).not.toHaveBeenCalled();

        // The next keystroke searches the titles again.
        await type(input, "alp");
        expect(queries().at(-1)).toBe("alp");
    });

    it("searches the content on Shift+Enter, keeping the key from the host", async () => {
        const onKeyDown = vi.fn();
        const input = await mount({ onKeyDown });

        // Nothing to search for in an empty field.
        const empty = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
        await act(async () => { input.dispatchEvent(empty); });
        await settle();
        expect(getNoteSuggestions).not.toHaveBeenCalled();

        await type(input, "al");
        const shiftEnter = new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true, cancelable: true });
        await act(async () => { input.dispatchEvent(shiftEnter); });
        await settle();

        expect(shiftEnter.defaultPrevented).toBe(true);
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", expect.objectContaining({ fastSearch: false }));
        expect(onKeyDown).not.toHaveBeenCalledWith(shiftEnter);
    });

    it("searches for what an input method commits, not what it is composing", async () => {
        const onChange = vi.fn();
        const input = await mount({ onChange });
        await type(input, "n");
        getNoteSuggestions.mockClear();

        await act(async () => { input.dispatchEvent(new Event("compositionstart", { bubbles: true })); });
        await type(input, "ni");
        await type(input, "nih");
        expect(getNoteSuggestions).not.toHaveBeenCalled();

        // The Enter that commits a candidate, and a Shift+Enter, belong to the input method.
        for (const shiftKey of [ false, true ]) {
            const key = new KeyboardEvent("keydown", { key: "Enter", shiftKey, isComposing: true, bubbles: true, cancelable: true });
            await act(async () => { input.dispatchEvent(key); });
            expect(key.defaultPrevented).toBe(false);
        }
        await settle();
        expect(onChange).not.toHaveBeenCalled();
        expect(getNoteSuggestions).not.toHaveBeenCalled();

        await act(async () => { input.dispatchEvent(new Event("compositionend", { bubbles: true })); });
        await settle();
        expect(queries()).toEqual([ "nih" ]);
    });

    describe("action rows", () => {
        const searchRow: Suggestion = { action: "search-notes", noteTitle: "al", highlightedNotePathTitle: "Search for al" };
        const linkRow: Suggestion = { action: "external-link", externalLink: "https://e.com", highlightedNotePathTitle: "Insert" };
        const createRow: Suggestion = { action: "create-note", noteTitle: "New", highlightedNotePathTitle: "Create New" };

        let triggerCommand: ReturnType<typeof vi.spyOn>;
        beforeEach(() => {
            triggerCommand = vi.spyOn(appContext, "triggerCommand").mockImplementation(() => Promise.resolve() as never);
            createNoteFromSuggestion.mockReset();
        });

        afterEach(() => {
            triggerCommand.mockRestore();
        });

        it("asks for the rows the options allow", async () => {
            const input = await mount({ opts: { allowCreatingNotes: true, allowJumpToSearchNotes: true, allowExternalLinks: true } });
            await type(input, "al");

            expect(getNoteSuggestions).toHaveBeenLastCalledWith("al", {
                allowCreatingNotes: true, allowJumpToSearchNotes: true, allowExternalLinks: true
            });
        });

        it("runs a search from its row, with its shortcut shown, leaving the field", async () => {
            const onChange = vi.fn();
            getNoteSuggestions.mockResolvedValue([ searchRow ]);
            const input = await mount({ onChange });
            await type(input, "al");

            expect(rows()[0].querySelector("kbd")?.textContent).toBe("Ctrl+Enter");
            await press(input, "Enter");
            expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "al" });
            expect(onChange).not.toHaveBeenCalled();
            expect(input.value).toBe("al");
        });

        it("runs a search on Ctrl+Enter where allowed, keeping the key from other listeners", async () => {
            const input = await mount({ opts: { allowJumpToSearchNotes: true } });
            await type(input, "al");
            const laterListener = vi.fn();
            input.addEventListener("keydown", laterListener);

            await press(input, "Enter", { ctrlKey: true });
            expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "al" });
            expect(laterListener).not.toHaveBeenCalled();

            triggerCommand.mockClear();
            const plain = await mount();
            await type(plain, "al");
            await press(plain, "Enter", { ctrlKey: true });
            expect(triggerCommand).not.toHaveBeenCalled();
        });

        it("fills in an external link from its row, with no note selected", async () => {
            const onChange = vi.fn();
            const noteIdChanged = vi.fn();
            getNoteSuggestions.mockResolvedValue([ linkRow ]);
            const input = await mount({ onChange, noteIdChanged });
            await type(input, "https://e.com");
            await press(input, "Enter");

            expect(input.value).toBe("https://e.com");
            expect(input.dataset.notePath).toBe("");
            expect(onChange).toHaveBeenCalledWith(linkRow);
            expect(noteIdChanged).not.toHaveBeenCalled();
        });

        it("creates a note from its row and reports it as picked, or nothing when canceled", async () => {
            const onChange = vi.fn();
            const noteIdChanged = vi.fn();
            getNoteSuggestions.mockResolvedValue([ createRow ]);
            createNoteFromSuggestion.mockResolvedValueOnce("root/inbox/created");
            const input = await mount({ onChange, noteIdChanged });
            await type(input, "New");
            await press(input, "Enter");

            expect(createNoteFromSuggestion).toHaveBeenCalledWith(createRow);
            expect(onChange).toHaveBeenCalledWith({ ...createRow, notePath: "root/inbox/created" });
            expect(noteIdChanged).toHaveBeenCalledWith("created");
            expect(input.value).toBe("New");
            expect(input.dataset.notePath).toBe("root/inbox/created");

            onChange.mockClear();
            createNoteFromSuggestion.mockResolvedValueOnce(undefined);
            await type(input, "New");
            await press(input, "Enter");
            expect(onChange).not.toHaveBeenCalled();
        });
    });

    it("spans the whole field, the buttons included", async () => {
        const input = await mount();
        const group = input.closest(".input-group");
        if (!group) throw new Error("no input group rendered");
        group.getBoundingClientRect = () => DOMRect.fromRect({ width: 320, height: 30 });
        input.getBoundingClientRect = () => DOMRect.fromRect({ width: 200, height: 30 });
        await type(input, "a");

        expect(document.querySelector<HTMLElement>(".note-autocomplete-menu")?.style.width).toBe("320px");
    });

    it("picks a clicked note", async () => {
        const noteIdChanged = vi.fn();
        const input = await mount({ noteIdChanged });
        await type(input, "a");

        await act(async () => { rows()[0].click(); });
        expect(noteIdChanged).toHaveBeenCalledWith("a");
        expect(input.value).toBe("Alpha");
    });

    it("reports a selection cleared by emptying the field", async () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const input = await mount({ onChange, noteIdChanged });
        await type(input, "a");
        await press(input, "Enter");

        await type(input, "");
        await act(async () => { input.dispatchEvent(new Event("change", { bubbles: true })); });
        expect(onChange).toHaveBeenLastCalledWith(null);
        expect(noteIdChanged).toHaveBeenLastCalledWith(undefined);
        expect(input.dataset.notePath).toBe("");
    });

    it("closes on Escape, and stays closed in a read-only field", async () => {
        const input = await mount();
        await type(input, "a");
        await press(input, "Escape");
        expect(rows()).toHaveLength(0);

        const readOnly = await mount({ readOnly: true });
        await press(readOnly, "ArrowDown");
        expect(rows()).toHaveLength(0);
    });
});
