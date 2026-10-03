import { EditorSelection } from "@codemirror/state";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNoteSuggestions } = vi.hoisted(() => ({
    getNoteSuggestions: vi.fn<(term: string, options?: NoteSuggestionOptions) => Promise<Suggestion[]>>()
}));

vi.mock("../services/note_autocomplete", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../services/note_autocomplete")>()),
    getNoteSuggestions
}));
// The attribute names, and the linter asking the server to read the query, which nothing here is about.
vi.mock("../services/server", () => ({
    default: {
        get: vi.fn(async (url: string) => (url.startsWith("attribute-names/") ? [ "book", "bookmark" ] : [])),
        post: vi.fn(async () => ({}))
    }
}));

import type { NoteSuggestionOptions, Suggestion } from "../services/note_autocomplete";
import { createSearchFieldEditor } from "./search_field_editor";

describe("createSearchFieldEditor", () => {
    let editor: ReturnType<typeof createSearchFieldEditor> | undefined;
    let onEnter: ReturnType<typeof vi.fn<() => void>>;

    beforeEach(() => {
        onEnter = vi.fn<() => void>();
        const parent = document.createElement("div");
        document.body.append(parent);
        editor = createSearchFieldEditor({ parent, onEnter });
        editor.focus();
    });

    afterEach(() => {
        editor?.destroy();
        editor = undefined;
    });

    it("lists the notes for an @ as the note autocomplete does, and puts the id of the one picked in its place", async () => {
        getNoteSuggestions.mockResolvedValue([
            { notePath: "root/projects/abc123", noteTitle: "Alpha", notePathTitle: "Projects / Alpha", highlightedNotePathTitle: "<b>Al</b>pha" },
            { notePath: "root/def456", noteTitle: "Alpine", notePathTitle: "Alpine", highlightedNotePathTitle: "<b>Al</b>pine" }
        ]);

        type("#book @Al");
        const rows = () => menuRows(".note-autocomplete-menu");
        await vi.waitFor(() => expect(rows()).toEqual([ "Alpha", "Alpine" ]));
        // At most ten notes, and no rows creating one: a query names notes that exist.
        expect(getNoteSuggestions).toHaveBeenLastCalledWith("Al", { allowCreatingNotes: undefined, limit: 10 });

        // The first note is highlighted, so Enter takes it rather than running the search.
        await press("Enter");
        await vi.waitFor(() => expect(text()).toBe("#book abc123"));
        await vi.waitFor(() => expect(rows()).toEqual([]));
        expect(onEnter).not.toHaveBeenCalled();
    });

    it("lists the names after # as the attribute panel does, leaving Enter to the search until one is arrowed to", async () => {
        type("#bo");
        const rows = () => menuRows(".form-autocomplete-dropdown");
        await vi.waitFor(() => expect(rows()).toEqual([ "book", "bookmark" ]));

        await press("Enter");
        expect(onEnter).toHaveBeenCalledOnce();

        await press("ArrowDown");
        await press("ArrowDown");
        await press("Enter");
        await vi.waitFor(() => expect(text()).toBe("#bookmark"));
        expect(onEnter).toHaveBeenCalledOnce();
    });

    it("lists the rest of the syntax as the command palette lists its commands, and opens on what a pick leaves to complete", async () => {
        type("#book ");
        await press(" ", { ctrlKey: true });
        const rows = () => menuRows(".note-autocomplete-menu").map((row) => row.split("search_completion.")[0]);
        await vi.waitFor(() => expect(rows()).toContain("orderBy"));

        // Asked for, the list opens on the best match, so Enter takes it.
        type("no");
        await vi.waitFor(() => expect(rows()[0]).toBe("note"));
        await press("Enter");
        await vi.waitFor(() => expect(text()).toBe("#book note."));

        // `note.` leaves a property to name, which the list now offers.
        await vi.waitFor(() => expect(rows()).toContain("title"));
        type("ti");
        await vi.waitFor(() => expect(rows()[0]).toBe("title"));
        await press("ArrowDown");
        await press("Enter");
        await vi.waitFor(() => expect(text()).toBe("#book note.title"));
    });

    function type(inserted: string) {
        const view = editor;
        if (!view) throw new Error("expected an editor");
        const at = view.state.selection.main.head;
        view.dispatch({ changes: { from: at, insert: inserted }, selection: EditorSelection.cursor(at + inserted.length) });
    }

    /** Presses a key, and lets the list render what it did before the next one, as between two key presses. */
    async function press(key: string, init: KeyboardEventInit = {}) {
        editor?.contentDOM.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    function text() {
        return editor?.state.doc.toString();
    }
});

function menuRows(menu: string) {
    return [ ...document.querySelectorAll(`${menu} [role=option]`) ].map((row) => row.textContent ?? "");
}
