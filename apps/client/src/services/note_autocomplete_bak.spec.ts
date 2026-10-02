import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import $ from "jquery";

// --- Mocks (hoisted above imports) ---

const {
    triggerCommand, getActiveContextNoteId, getActiveContext, chooseNoteType, createNote,
    getInboxNotePath, getInboxTarget, translate, logError
} = vi.hoisted(() => ({
    triggerCommand: vi.fn(),
    getActiveContextNoteId: vi.fn<() => string | null>(() => "activeNote"),
    getActiveContext: vi.fn<() => any>(() => ({ hoistedNoteId: "hoisted" })),
    chooseNoteType: vi.fn(),
    createNote: vi.fn(),
    getInboxNotePath: vi.fn<() => Promise<string | undefined>>(async () => "root/inbox"),
    getInboxTarget: vi.fn<() => Promise<unknown>>(
        async () => ({ kind: "inbox", noteId: "inb", title: "Inbox" })
    ),
    // i18next is never initialised here, so the real `t` returns undefined. Echoing the key
    // keeps the label assertions about which string is chosen rather than about its English.
    translate: vi.fn((key: string, _opts?: Record<string, unknown>) => key),
    logError: vi.fn()
}));

vi.mock("../components/app_context.js", () => ({
    default: {
        triggerCommand,
        tabManager: {
            getActiveContextNoteId,
            getActiveContext
        }
    }
}));

vi.mock("./note_create.js", () => ({
    default: { chooseNoteType, createNote }
}));

vi.mock("./date_notes.js", () => ({
    default: { getInboxNotePath, getInboxTarget }
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

// Imports AFTER vi.mock calls.
import server from "./server.js";
import froca from "./froca.js";
import { buildNote } from "../test/easy-froca.js";
import noteAutocomplete from "./note_autocomplete_bak.js";

type Dataset = {
    displayKey: string;
    cache: boolean;
    source: (term: string, cb: (rows: any[]) => void) => void;
    templates: { suggestion: (s: any) => string };
};

// Captures the last `$el.autocomplete(config, datasets)` init call and records
// every command invocation so tests can drive the registered callbacks.
let lastConfig: AutoCompleteConfig | undefined;
let lastDatasets: Dataset[] | undefined;
let autocompleteCalls: any[][];
const stored = new Map<HTMLElement, string>();

function registerAutocompleteStub() {
    lastConfig = undefined;
    lastDatasets = undefined;
    autocompleteCalls = [];
    ($.fn as any).autocomplete = vi.fn(function (this: JQuery, config: any, datasets?: Dataset[]) {
        autocompleteCalls.push([config, datasets]);
        if (typeof config === "object" && Array.isArray(datasets)) {
            lastConfig = config;
            lastDatasets = datasets;
        }
        // emulate the "val" getter/setter so fullTextSearch can read it back
        if (config === "val") {
            const el = this[0];
            if (datasets === undefined) {
                return stored.get(el) as any;
            }
            stored.set(el, datasets as unknown as string);
        }
        return this;
    });
}

function makeEl(extraClass = "") {
    return $(`<input class="${extraClass}" />`);
}

function lastCommandWith(arg: any) {
    return autocompleteCalls.some((c) => c[0] === arg && c[1] === undefined);
}

// ---------------------------------------------------------------------------
// Exercise the internal autocompleteSource via the dataset.source registered
// during initNoteAutocomplete (it is not exported, so we go through the public
// init path and capture the dataset callbacks).
// ---------------------------------------------------------------------------

function initAndGetSource(options?: any) {
    const $el = makeEl();
    noteAutocomplete.initNoteAutocomplete($el, options);
    return { $el, dataset: lastDatasets![0] };
}

/** Runs the dataset.source and resolves with the rows it passes to cb. */
function runSource(dataset: Dataset, term: string): Promise<any[]> {
    return new Promise((resolve) => {
        dataset.source(term, (rows) => resolve(rows));
    });
}

/**
 * Fires the (debounced) dataset.source with the given cb and waits long enough
 * for the debounce timer + the awaited body to flush, even when cb is never called.
 */
function runSourceRaw(dataset: Dataset, term: string, cb: (rows: any[]) => void): Promise<void> {
    dataset.source(term, cb);
    return new Promise((resolve) => setTimeout(resolve, 30));
}

describe("autocompleteSource (via dataset)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getActiveContextNoteId.mockReturnValue("activeNote");
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    it("appends a search-notes suggestion when allowJumpToSearchNotes", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "A", notePath: "root/a" }]) as typeof server.get;
        const { dataset } = initAndGetSource({ allowJumpToSearchNotes: true });
        const rows = await runSource(dataset, "term");
        expect(rows[rows.length - 1].action).toBe("search-notes");
    });

    it("prepends an external-link suggestion when allowExternalLinks and term is a URL", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "A", notePath: "root/a" }]) as typeof server.get;
        const { dataset } = initAndGetSource({ allowExternalLinks: true });
        const rows = await runSource(dataset, "https://example.com/x");
        expect(rows[0].action).toBe("external-link");
        expect(rows[0].externalLink).toBe("https://example.com/x");
    });

    it("does not add a search-notes suggestion for an empty term", async () => {
        server.get = vi.fn(async () => [{ noteTitle: "A", notePath: "root/a" }]) as typeof server.get;
        const { dataset } = initAndGetSource({ allowJumpToSearchNotes: true, allowExternalLinks: true });
        const rows = await runSource(dataset, "   ");
        expect(rows.every((r) => r.action !== "search-notes")).toBe(true);
    });
});

describe("$.fn jQuery extensions (init)", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    it("getSelectedNotePath returns empty when input value is blank", () => {
        const $el = makeEl();
        $el.val("");
        $el.attr("data-note-path", "root/x");
        expect($el.getSelectedNotePath()).toBe("");
    });

    it("getSelectedNotePath returns the stored path when there is a value", () => {
        const $el = makeEl();
        $el.val("Some title");
        $el.attr("data-note-path", "root/x");
        expect($el.getSelectedNotePath()).toBe("root/x");
    });

    it("getSelectedNoteId returns null when no path, last segment otherwise", () => {
        const $el = makeEl();
        $el.val("");
        expect($el.getSelectedNoteId()).toBeNull();

        $el.val("title");
        $el.attr("data-note-path", "root/parent/child");
        expect($el.getSelectedNoteId()).toBe("child");
    });

    it("setSelectedNotePath toggles the go-to button and sets href", () => {
        const $group = $(`<div class="input-group"><input class="note-autocomplete-input" /><a class="go-to-selected-note-button"></a></div>`);
        const $el = $group.find("input");
        $el.setSelectedNotePath("root/abc");
        const $btn = $group.find(".go-to-selected-note-button");
        expect($btn.hasClass("disabled")).toBe(false);
        expect($btn.attr("href")).toBe("#root/abc");

        $el.setSelectedNotePath("");
        expect($group.find(".go-to-selected-note-button").hasClass("disabled")).toBe(true);
    });

    it("getSelectedExternalLink mirrors getSelectedNotePath blank/value behaviour", () => {
        const $el = makeEl();
        $el.val("");
        $el.attr("data-external-link", "https://x");
        expect($el.getSelectedExternalLink()).toBe("");

        $el.val("title");
        expect($el.getSelectedExternalLink()).toBe("https://x");
    });

    it("setSelectedExternalLink stores the link and disables the go-to button", () => {
        const $group = $(`<div class="input-group"><input /><a class="go-to-selected-note-button"></a></div>`);
        const $el = $group.find("input");
        $el.setSelectedExternalLink("https://example.com");
        expect($el.attr("data-external-link")).toBe("https://example.com");
        expect($group.find(".go-to-selected-note-button").hasClass("disabled")).toBe(true);
    });

    it("setNote loads the note title from froca and sets the value + path", async () => {
        const note = buildNote({ title: "Loaded note" });
        const $el = makeEl();
        await $el.setNote(note.noteId);
        expect($el.val()).toBe("Loaded note");
        expect($el.attr("data-note-path")).toBe(note.noteId);
    });

    it("setNote clears the value when noteId is falsy", async () => {
        const $el = makeEl();
        $el.val("previous");
        await $el.setNote(null as any);
        expect($el.val()).toBe("");
        expect($el.attr("data-note-path")).toBe("");
    });
});

describe("initNoteAutocomplete wiring", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    it("returns early and detaches the noteselected listener if already initialized", () => {
        const $el = makeEl("note-autocomplete-input");
        const result = noteAutocomplete.initNoteAutocomplete($el);
        // no autocomplete init call was made (config + datasets form)
        expect(lastDatasets).toBeUndefined();
        expect(result).toBe($el);
    });

    it("Ctrl+Enter triggers a search-notes selection when allowJumpToSearchNotes", () => {
        const $el = makeEl();
        const selected = vi.fn();
        ($el as any).on("autocomplete:selected", selected);
        noteAutocomplete.initNoteAutocomplete($el, { allowJumpToSearchNotes: true });

        $el.autocomplete("val", "find this");
        const ev = $.Event("keydown", { ctrlKey: true, key: "Enter" });
        $el.trigger(ev);
        expect(selected).toHaveBeenCalled();
        const payload = selected.mock.calls[0][1];
        expect(payload.action).toBe("search-notes");
    });

    it("ignores keydowns that are not Ctrl+Enter", () => {
        const $el = makeEl();
        const selected = vi.fn();
        ($el as any).on("autocomplete:selected", selected);
        noteAutocomplete.initNoteAutocomplete($el, { allowJumpToSearchNotes: true });

        // a plain key press -> neither handler fires its body
        $el.trigger($.Event("keydown", { key: "a" }));
        // Ctrl without Enter
        $el.trigger($.Event("keydown", { ctrlKey: true, key: "a" }));
        expect(selected).not.toHaveBeenCalled();
    });

    // Issue #5669: autocomplete.js empties its suggestion list only a tick after closing
    // it, and its Enter handler selects from the closed-but-not-yet-emptied dropdown, so
    // a fast second Enter right after a selection would consume a stale suggestion row.
    // Plain Enter must never reach the library while the dropdown is closed (the library
    // keeps aria-expanded in sync with its open/close state).
    it("does not deliver a plain Enter to autocomplete while the dropdown is closed", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        // simulates the library's own keydown handler, which is bound after init
        const autocompleteKeydown = vi.fn((event: JQuery.KeyDownEvent) => event.preventDefault());
        $el.on("keydown.aa", autocompleteKeydown);

        // aria-expanded not yet set (before the first open), then explicitly closed
        for (const expanded of [undefined, "false"]) {
            if (expanded) {
                $el.attr("aria-expanded", expanded);
            }
            const event = $.Event("keydown", { key: "Enter" });
            $el.trigger(event);
            // the default action (form submission) must stay intact
            expect(event.isDefaultPrevented()).toBe(false);
        }
        expect(autocompleteKeydown).not.toHaveBeenCalled();
    });

    it("delivers a plain Enter to autocomplete while the dropdown is open", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        const autocompleteKeydown = vi.fn();
        $el.on("keydown.aa", autocompleteKeydown);

        $el.attr("aria-expanded", "true");
        $el.trigger($.Event("keydown", { key: "Enter" }));

        expect(autocompleteKeydown).toHaveBeenCalledOnce();
    });

    it("leaves modified Enter presses alone even when the dropdown is closed", () => {
        const $el = makeEl();
        noteAutocomplete.initNoteAutocomplete($el);
        const autocompleteKeydown = vi.fn();
        $el.on("keydown.aa", autocompleteKeydown);

        $el.attr("aria-expanded", "false");
        $el.trigger($.Event("keydown", { key: "Enter", ctrlKey: true }));

        expect(autocompleteKeydown).toHaveBeenCalledOnce();
    });

});

describe("autocomplete:selected handler", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        getActiveContext.mockReturnValue({ hoistedNoteId: "hoisted" });
        registerAutocompleteStub();
        server.get = vi.fn(async () => []) as typeof server.get;
        noteAutocomplete.init();
    });

    function initWithSelected() {
        const $el = makeEl();
        const handlers: Record<string, any> = {};
        noteAutocomplete.initNoteAutocomplete($el);
        ["autocomplete:externallinkselected", "autocomplete:noteselected"].forEach((evt) => {
            $el.on(evt, (_e: any, s: any) => (handlers[evt] = s));
        });
        return { $el, handlers };
    }

    function fireSelected($el: JQuery, suggestion: any) {
        ($el as any).trigger("autocomplete:selected", suggestion);
        return new Promise((r) => setTimeout(r, 0));
    }

    it("handles an external-link selection", async () => {
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "external-link", externalLink: "https://e.com" });
        expect($el.attr("data-external-link")).toBe("https://e.com");
        expect(handlers["autocomplete:externallinkselected"]).toBeDefined();
    });

    it("handles a search-notes selection by triggering searchNotes", async () => {
        const { $el } = initWithSelected();
        await fireSelected($el, { action: "search-notes", noteTitle: "query" });
        expect(triggerCommand).toHaveBeenCalledWith("searchNotes", { searchString: "query" });
    });

    it("creates a note in the inbox then selects it", async () => {
        chooseNoteType.mockResolvedValue({ success: true, noteType: "text", templateNoteId: undefined, notePath: undefined });
        createNote.mockResolvedValue({ note: { getBestNotePathString: () => "root/created" } });
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "create-note", noteTitle: "Created" });
        expect(chooseNoteType).toHaveBeenCalled();
        expect(createNote).toHaveBeenCalledWith("root/inbox", expect.objectContaining({ title: "Created", type: "text" }));
        expect(handlers["autocomplete:noteselected"]).toBeDefined();
        expect(handlers["autocomplete:noteselected"].notePath).toBe("root/created");
    });

    it("creates a child note under the suggested parent", async () => {
        chooseNoteType.mockResolvedValue({ success: true, noteType: "text", templateNoteId: undefined, notePath: undefined });
        createNote.mockResolvedValue({ note: { getBestNotePathString: () => "root/created" } });
        const { $el } = initWithSelected();
        await fireSelected($el, { action: "create-child-note", noteTitle: "Created", parentNoteId: "parent" });
        expect(getInboxNotePath).not.toHaveBeenCalled();
        expect(createNote).toHaveBeenCalledWith("parent", expect.objectContaining({ title: "Created" }));
    });

    it("aborts when the inbox cannot be resolved", async () => {
        chooseNoteType.mockResolvedValue({ success: true, noteType: "text" });
        getInboxNotePath.mockResolvedValueOnce(undefined);
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "create-note", noteTitle: "X" });
        expect(createNote).not.toHaveBeenCalled();
        expect(handlers["autocomplete:noteselected"]).toBeUndefined();
    });

    it("aborts the create-note flow when the type chooser is cancelled", async () => {
        chooseNoteType.mockResolvedValue({ success: false });
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "create-note", noteTitle: "X", parentNoteId: "p" });
        expect(createNote).not.toHaveBeenCalled();
        expect(handlers["autocomplete:noteselected"]).toBeUndefined();
    });

    it("uses the chosen notePath as parent and tolerates a missing created note", async () => {
        chooseNoteType.mockResolvedValue({ success: true, noteType: "text", notePath: "chosen/path" });
        createNote.mockResolvedValue({ note: undefined });
        getActiveContext.mockReturnValue(undefined);
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: "create-note", noteTitle: "X", parentNoteId: "p" });
        expect(createNote).toHaveBeenCalledWith("chosen/path", expect.any(Object));
        // The missing-note branch must be tolerated end to end: note?.getBestNotePathString
        // and getActiveContext()?.hoistedNoteId are both undefined and must not throw.
        // The flow still falls through to fire autocomplete:noteselected with an
        // undefined notePath (rather than crashing inside the async handler).
        expect(handlers["autocomplete:noteselected"]).toBeDefined();
        expect(handlers["autocomplete:noteselected"].notePath).toBeUndefined();
        // the selection was written back as a cleared path (setSelectedNotePath(undefined))
        expect($el.attr("data-note-path") ?? "").toBe("");
    });

    it("handles a plain note selection", async () => {
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: undefined, notePath: "root/n", noteTitle: "N" });
        expect($el.attr("data-note-path")).toBe("root/n");
        expect(handlers["autocomplete:noteselected"]).toBeDefined();
    });
});
