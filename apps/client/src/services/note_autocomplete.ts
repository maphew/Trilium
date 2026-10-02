import type { MentionFeedObjectItem } from "@triliumnext/ckeditor5";

// TODO: Deduplicate with server.
export interface Suggestion {
    noteTitle?: string;
    externalLink?: string;
    notePathTitle?: string;
    notePath?: string;
    highlightedNotePathTitle?: string;
    action?: string | "create-note" | "create-child-note" | "search-notes" | "external-link" | "command";
    parentNoteId?: string;
    icon?: string;
    commandId?: string;
    commandDescription?: string;
    commandShortcut?: string;
    attributeSnippet?: string;
    highlightedAttributeSnippet?: string;
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
