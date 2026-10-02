import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActiveContextNoteId, getInboxTarget, translate, logError } = vi.hoisted(() => ({
    getActiveContextNoteId: vi.fn<() => string | null>(() => "activeNote"),
    getInboxTarget: vi.fn<() => Promise<unknown>>(
        async () => ({ kind: "inbox", noteId: "inb", title: "Inbox" })
    ),
    // i18next is never initialized here, so the real `t` returns undefined. Echoing the key keeps
    // the label assertions about which string is chosen rather than about its English.
    translate: vi.fn((key: string, _opts?: Record<string, unknown>) => key),
    logError: vi.fn()
}));

vi.mock("../components/app_context.js", () => ({
    default: { tabManager: { getActiveContextNoteId } }
}));

vi.mock("./date_notes.js", () => ({
    default: { getInboxTarget }
}));

vi.mock("./i18n.js", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./i18n.js")>()),
    t: translate
}));

// Narrows the blanket ws mock from test/setup.ts to a spy, so what the module reports can be asserted.
vi.mock("./ws.js", () => ({
    default: {
        subscribeToMessages() {},
        async waitForMaxKnownEntityChangeId() {}
    },
    subscribeToMessages() {},
    unsubscribeToMessage() {},
    async waitForMaxKnownEntityChangeId() {},
    logError
}));

import noteAutocomplete, { getNoteSuggestions, type Suggestion } from "./note_autocomplete.js";
import server from "./server.js";

beforeEach(() => {
    vi.clearAllMocks();
    getActiveContextNoteId.mockReturnValue("activeNote");
    server.get = vi.fn(async () => []) as typeof server.get;
});

describe("getNoteSuggestions", () => {
    it("queries the server and returns its rows as they are", async () => {
        server.get = vi.fn(async () => [ { noteTitle: "Result", notePath: "root/x" } ]) as typeof server.get;

        expect(await getNoteSuggestions("a b")).toEqual([ { noteTitle: "Result", notePath: "root/x" } ]);
        expect(server.get).toHaveBeenCalledWith("autocomplete?query=a%20b&activeNoteId=activeNote&fastSearch=true");

        await getNoteSuggestions("a", { fastSearch: false });
        expect(server.get).toHaveBeenLastCalledWith(expect.stringContaining("fastSearch=false"));
        expect(getInboxTarget).not.toHaveBeenCalled();
    });

    it("places both creation rows above the results", async () => {
        server.get = vi.fn(async () => [ { noteTitle: "Existing", notePath: "root/y" } ]) as typeof server.get;

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows.map((r) => r.action)).toEqual([ "create-note", "create-child-note", undefined ]);
        expect(rows.map((r) => r.noteTitle)).toEqual([ "New", "New", "Existing" ]);
        // The inbox is resolved when the row is picked, so the row carries no parent.
        expect(rows[0].parentNoteId).toBeUndefined();
        expect(rows[1].parentNoteId).toBe("activeNote");
    });

    it("uses root as the child-note parent when there is no active note", async () => {
        getActiveContextNoteId.mockReturnValue(null);

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows[1]).toMatchObject({ action: "create-child-note", parentNoteId: "root" });
    });

    it("adds no creation rows for a blank term", async () => {
        server.get = vi.fn(async () => [ { noteTitle: "Recent", notePath: "root/r" } ]) as typeof server.get;

        expect(await getNoteSuggestions("   ", { allowCreatingNotes: true })).toEqual([ { noteTitle: "Recent", notePath: "root/r" } ]);
        expect(getInboxTarget).not.toHaveBeenCalled();
    });

    it.each([
        { kind: "inbox", title: "Inbox" },
        { kind: "workspaceInbox", title: "Work" },
        { kind: "workspaceRoot", title: "Project" }
    ])("names the $kind destination in the create-note row", async ({ kind, title }) => {
        getInboxTarget.mockResolvedValueOnce({ kind, title });

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows[0].highlightedNotePathTitle).toBe("note_autocomplete.create-note-into");
        expect(translate).toHaveBeenCalledWith("note_autocomplete.create-note-into", { term: "New", parentTitle: title });
    });

    it.each([
        { kind: "root", key: "note_autocomplete.create-note-into-root" },
        { kind: "dayNote", key: "note_autocomplete.create-note-into-day-note" }
    ])("labels the $kind destination without its title", async ({ kind, key }) => {
        getInboxTarget.mockResolvedValueOnce({ kind, noteId: "root", title: "root" });

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows[0].highlightedNotePathTitle).toBe(key);
        expect(translate).toHaveBeenCalledWith(key, { term: "New" });
    });

    it.each([
        { when: "the lookup fails", arrange: () => getInboxTarget.mockRejectedValueOnce(new Error("nope")) },
        { when: "the destination has no title", arrange: () => getInboxTarget.mockResolvedValueOnce({ kind: "inbox" }) }
    ])("falls back to an unqualified label when $when", async ({ arrange }) => {
        arrange();

        const rows = await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(rows[0]).toMatchObject({ action: "create-note", highlightedNotePathTitle: "note_autocomplete.create-note" });
    });

    it("reports a failed inbox lookup", async () => {
        getInboxTarget.mockRejectedValueOnce(new Error("nope"));

        await getNoteSuggestions("New", { allowCreatingNotes: true });
        expect(logError).toHaveBeenCalledWith(expect.stringContaining("nope"));
    });
});

describe("autocompleteSourceForCKEditor", () => {
    it("maps the rows into mention feed items, creation rows first", async () => {
        server.get = vi.fn(async () => [ {
            noteTitle: "Foo",
            notePathTitle: "Root / Foo",
            notePath: "root/abc",
            highlightedNotePathTitle: "<b>Foo</b>",
            icon: "bx bx-note"
        } ]) as typeof server.get;

        const items = await noteAutocomplete.autocompleteSourceForCKEditor("Foo");
        expect(items.map((item) => (item as Suggestion).action)).toEqual([ "create-note", "create-child-note", undefined ]);
        expect(items[2]).toEqual({
            action: undefined,
            noteTitle: "Foo",
            id: "@Root / Foo",
            name: "Root / Foo",
            link: "#root/abc",
            notePath: "root/abc",
            highlightedNotePathTitle: "<b>Foo</b>",
            icon: "bx bx-note"
        });
        // A creation row has no path title of its own.
        expect(items[0]).toMatchObject({ id: "@undefined", name: "" });
    });

    it("omits the creation rows when the host cannot act on them", async () => {
        server.get = vi.fn(async () => [
            { noteTitle: "Foo", notePathTitle: "Root / Foo", notePath: "root/abc" }
        ]) as typeof server.get;

        const items = await noteAutocomplete.autocompleteSourceForCKEditor("Foo", false);
        expect(items.map((item) => (item as Suggestion).action)).toEqual([ undefined ]);
    });
});
