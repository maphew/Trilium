import type { MentionFeedObjectItem } from "@triliumnext/ckeditor5";
import type { AutocompleteResult } from "@triliumnext/commons";

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

// #region Stubs
// TODO: Stubs that keep the existing callers compiling and running while the implementation is
// rebuilt. None of them searches for or suggests anything.

async function autocompleteSourceForCKEditor(_queryText: string, _allowCreatingNotes = true): Promise<MentionFeedObjectItem[]> {
    return [];
}

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
