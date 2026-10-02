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

    it("handles a plain note selection", async () => {
        const { $el, handlers } = initWithSelected();
        await fireSelected($el, { action: undefined, notePath: "root/n", noteTitle: "N" });
        expect($el.attr("data-note-path")).toBe("root/n");
        expect(handlers["autocomplete:noteselected"]).toBeDefined();
    });
});
