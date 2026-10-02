import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { buildNote } from "../../test/easy-froca";
import { renderInto } from "../../test/render";
import NoteAutocomplete, { type NoteAutocompleteProps } from "./NoteAutocomplete";

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
