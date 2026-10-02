import type { MentionFeedObjectItem } from "@triliumnext/ckeditor5";
import type { AutocompleteResult, InboxTargetResponse } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import dateNoteService from "./date_notes.js";
import { t } from "./i18n.js";
import server from "./server.js";
import { escapeHtml } from "./utils.js";
import { logError } from "./ws.js";

// Short on purpose: a search costs tens of milliseconds, so this exists to merge keystrokes that
// arrive faster than a person reads a result, not to wait out a slow server. Anything longer is
// felt on every keystroke typed at a normal pace.
const SEARCH_DEBOUNCE_MS = 50;

/**
 * One row of the dropdown: a note from `GET /api/autocomplete`, or a row added by the client.
 * A client row sets `action` to its kind and fills in only the fields that kind uses.
 */
export interface Suggestion extends Partial<AutocompleteResult> {
    action?: string | "create-note" | "create-child-note" | "search-notes" | "external-link" | "command";
    externalLink?: string;
    parentNoteId?: string;
    commandId?: string;
    commandDescription?: string;
    commandShortcut?: string;
}

export interface Options {
    container?: HTMLElement | null;
    fastSearch?: boolean;
    allowCreatingNotes?: boolean;
    allowJumpToSearchNotes?: boolean;
    allowExternalLinks?: boolean;
    /** If set, hides the right-side button corresponding to go to selected note. */
    hideGoToSelectedNoteButton?: boolean;
    /** If set, hides all right-side buttons in the autocomplete dropdown */
    hideAllButtons?: boolean;
    /** If set, enables command palette mode */
    isCommandPalette?: boolean;
}

/**
 * Feeds a CKEditor mention. Creation entries are offered only where the editor's host component
 * implements `createNoteForReferenceLink`, which is what `MentionCustomization` calls to act on
 * them.
 */
async function autocompleteSourceForCKEditor(queryText: string, allowCreatingNotes = true): Promise<MentionFeedObjectItem[]> {
    const rows = await getNoteSuggestions(queryText, { allowCreatingNotes });

    return rows.map((row) => ({
        action: row.action,
        noteTitle: row.noteTitle,
        id: `@${row.notePathTitle}`,
        name: row.notePathTitle || "",
        link: `#${row.notePath}`,
        notePath: row.notePath,
        highlightedNotePathTitle: row.highlightedNotePathTitle,
        icon: row.icon
    }));
}

/**
 * Returns the notes matching `term`, or the recently visited notes when `term` is blank. With
 * `allowCreatingNotes`, a non-blank term also gets the two note-creation rows, ahead of the notes.
 */
export async function getNoteSuggestions(term: string, { allowCreatingNotes = false, fastSearch = true } = {}): Promise<Suggestion[]> {
    const activeNoteId = appContext.tabManager.getActiveContextNoteId();

    // Runs concurrently with the search, so naming the destination costs a request but no wait.
    const pendingInboxTarget = term.trim().length >= 1 && allowCreatingNotes ? getInboxTarget() : null;

    const results = await server.get<AutocompleteResult[]>(`autocomplete?query=${encodeURIComponent(term)}&activeNoteId=${activeNoteId}&fastSearch=${fastSearch}`);
    if (!pendingInboxTarget) {
        return results;
    }

    // Both rows stay above the results: the CKEditor mention feed renders only the first
    // `mention.dropdownLimit` items.
    return [
        {
            action: "create-note",
            noteTitle: term,
            highlightedNotePathTitle: buildCreateNoteTitle(term, await pendingInboxTarget)
        },
        {
            action: "create-child-note",
            noteTitle: term,
            parentNoteId: activeNoteId || "root",
            highlightedNotePathTitle: t("note_autocomplete.create-child-note", { term: escapeHtml(term) })
        },
        ...results
    ];
}

/**
 * Paces one input's searches: the first keystroke after a pause queries immediately, a burst typed
 * faster than {@link SEARCH_DEBOUNCE_MS} collapses into one search that runs once it stops, and at
 * most one search is ever outstanding.
 *
 * The single-flight part is what keeps a slow search from compounding. The server answers
 * autocomplete requests one at a time, so firing a second while the first is still running makes
 * every later keystroke wait out the whole queue ahead of it. Holding the newest term back until
 * the outstanding search settles paces requests at whatever the server can actually serve, without
 * the client having to know how slow that is.
 *
 * Each input creates its own, so a keystroke in one cannot cancel or delay what another is waiting
 * on.
 */
export function createSearchScheduler() {
    type Search = () => void | Promise<void>;

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    let lastCallAt = 0;
    let running = false;
    let queued: Search | undefined;

    function start(runSearch: Search) {
        // Only the newest term is worth searching for, so a search waiting here replaces the one
        // before it instead of queueing behind it.
        if (running) {
            queued = runSearch;
            return;
        }

        running = true;
        void Promise.resolve(runSearch())
            .catch((e) => logError(`Autocomplete search failed: ${e}`))
            .finally(() => {
                running = false;
                const next = queued;
                queued = undefined;
                if (next) {
                    start(next);
                }
            });
    }

    return (runSearch: Search) => {
        // A newer keystroke supersedes whatever the previous one left waiting, be that a pending
        // timer or a search held back by the one in flight.
        clearTimeout(timeoutId);
        queued = undefined;

        // Measured from the previous keystroke rather than the previous search. Measuring from the
        // search paces requests at a fixed rate instead of ending the window when typing pauses.
        const now = Date.now();
        const startsBurst = now - lastCallAt >= SEARCH_DEBOUNCE_MS;
        lastCallAt = now;

        if (startsBurst) {
            start(runSearch);
        } else {
            timeoutId = setTimeout(() => start(runSearch), SEARCH_DEBOUNCE_MS);
        }
    };
}

async function getInboxTarget() {
    try {
        return await dateNoteService.getInboxTarget();
    } catch (e) {
        // The entry falls back to a label with no destination rather than failing the dropdown.
        logError(`Unable to resolve the inbox target: ${e}`);
        return null;
    }
}

/** Labels the creation entry with the note the capture would land in. */
function buildCreateNoteTitle(term: string, target: InboxTargetResponse | null) {
    if (!target) {
        return t("note_autocomplete.create-note", { term: escapeHtml(term) });
    }

    if (target.kind === "dayNote") {
        return t("note_autocomplete.create-note-into-day-note", { term: escapeHtml(term) });
    }

    // The root note's own title is not one the user recognizes in the tree.
    if (target.kind === "root") {
        return t("note_autocomplete.create-note-into-root", { term: escapeHtml(term) });
    }

    if (!target.title) {
        return t("note_autocomplete.create-note", { term: escapeHtml(term) });
    }

    return t("note_autocomplete.create-note-into", { term: escapeHtml(term), parentTitle: escapeHtml(target.title) });
}

// #region Stubs
// TODO: Stubs that keep the existing callers compiling and running while the implementation is
// rebuilt. None of them searches for or suggests anything.

function initNoteAutocomplete($el: JQuery<HTMLElement>, _options?: Options) {
    return $el;
}

function showRecentNotes(_$el: JQuery<HTMLElement>) {}

function showAllCommands(_$el: JQuery<HTMLElement>) {}

function setText(_$el: JQuery<HTMLElement>, _text: string) {}

/** Installs the `$.fn` helpers `NoteAutocomplete` and the dialogs call, as no-ops. */
function init() {
    $.fn.getSelectedNotePath = () => "";
    $.fn.getSelectedNoteId = () => null;
    $.fn.setSelectedNotePath = () => {};
    $.fn.getSelectedExternalLink = () => "";
    $.fn.setSelectedExternalLink = () => {};
    $.fn.setNote = async () => {};
}

export function triggerRecentNotes(_inputElement: HTMLInputElement | null | undefined) {}

// #endregion

export default {
    autocompleteSourceForCKEditor,
    initNoteAutocomplete,
    showRecentNotes,
    showAllCommands,
    setText,
    init
};
