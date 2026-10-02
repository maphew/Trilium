import { createRef, render as preactRender } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNoteSuggestions } = vi.hoisted(() => ({
    getNoteSuggestions: vi.fn<(term: string) => Promise<Suggestion[]>>(async () => [])
}));

vi.mock("../../services/note_autocomplete", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../services/note_autocomplete")>()),
    getNoteSuggestions
}));

import type { Suggestion } from "../../services/note_autocomplete";
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

    beforeEach(() => {
        vi.useFakeTimers();
        getNoteSuggestions.mockReset();
        getNoteSuggestions.mockResolvedValue(notes);
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

    async function press(input: HTMLInputElement, key: string) {
        await act(async () => {
            input.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
        });
        await settle();
    }

    function rows() {
        return [ ...document.querySelectorAll<HTMLElement>(".algolia-autocomplete .aa-dropdown-menu .aa-suggestion") ];
    }

    it("lists the notes in the plugin's markup, the first one highlighted", async () => {
        const input = await mount();
        await type(input, "al");

        expect(getNoteSuggestions).toHaveBeenLastCalledWith("al");
        const [ alpha, beta ] = rows();
        expect(rows()).toHaveLength(2);
        expect(alpha.closest(".aa-suggestions")?.parentElement?.className).toBe("aa-dataset-0");
        expect(alpha.className).toBe("aa-suggestion aa-cursor");
        expect(alpha.querySelector(".note-suggestion .icon")?.className).toBe("icon bx bx-file");
        expect(alpha.querySelector(".search-result-title")?.innerHTML).toBe("<b>Al</b>pha");
        expect(beta.querySelector(".icon")?.className).toBe("icon bx bx-note");
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

        expect(rows().map((row) => row.querySelector(".icon")?.className)).toEqual([
            "icon bx bx-search", "icon bx bx-plus", "icon bx bx-subdirectory-right", "icon bx bx-link-external", "icon bx bx-note"
        ]);
        expect(rows()[0].querySelector(".note-suggestion")?.classList.contains("search-notes-action")).toBe(true);
        expect(rows()[4].textContent).toBe("T");
    });

    it("picks the highlighted note with Enter, and reports it", async () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const input = await mount({ onChange, noteIdChanged });
        await type(input, "b");
        await press(input, "ArrowDown");
        expect(rows()[1].classList.contains("aa-cursor")).toBe(true);

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
        expect(getNoteSuggestions.mock.calls).toEqual([ [ "a" ] ]);

        await settle();
        expect(getNoteSuggestions.mock.calls).toEqual([ [ "a" ], [ "alp" ] ]);
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
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("");
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
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("");
        expect(rows()).toHaveLength(2);
        expect(document.activeElement).toBe(input);
    });

    it("spans the whole field, the buttons included", async () => {
        const input = await mount();
        const group = input.closest(".input-group");
        if (!group) throw new Error("no input group rendered");
        group.getBoundingClientRect = () => DOMRect.fromRect({ width: 320, height: 30 });
        input.getBoundingClientRect = () => DOMRect.fromRect({ width: 200, height: 30 });
        await type(input, "a");

        expect(document.querySelector<HTMLElement>(".algolia-autocomplete")?.style.width).toBe("320px");
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
