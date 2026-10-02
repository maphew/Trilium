import "./Menu.css";
import "./NoteAutocomplete.css";

import { NOTE_TYPE_ICONS } from "@triliumnext/commons";
import clsx from "clsx";
import { type RefObject, render } from "preact";
import { createPortal, type CSSProperties, Fragment } from "preact/compat";
import { type MutableRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { createSearchScheduler, createNoteFromSuggestion, getCommandSuggestions, getNoteSuggestions, type Options, type Suggestion } from "../../services/note_autocomplete";
import { escapeHtml, isMobile } from "../../services/utils";
import { useAutocomplete } from "./FormAutocomplete";
import { FormDropdownDivider } from "./FormList";
import { useSyncedRef } from "./hooks";
import Icon from "./Icon";
import Popup from "./Popup";
import RawHtml from "./RawHtml";
import { renderShortcutKbds } from "./shortcut_kbd";

/** Wide enough for a note path a few levels deep to fit on one line. */
const DROPDOWN_MIN_WIDTH = 500;
/** Keyboard hints are left out on mobile, as `Button` leaves out its shortcut. */
const cachedIsMobile = isMobile();

export interface NoteAutocompleteProps {
    id?: string;
    inputRef?: RefObject<HTMLInputElement>;
    text?: string;
    placeholder?: string;
    container?: RefObject<HTMLElement | null | undefined>;
    containerStyle?: CSSProperties;
    opts?: Options;
    onChange?: (suggestion: Suggestion | null) => void;
    onTextChange?: (text: string) => void;
    onKeyDown?: (e: KeyboardEvent) => void;
    onBlur?: (newValue: string) => void;
    noteIdChanged?: (noteId: string) => void;
    noteId?: string;
    /** Shows the selected note without allowing a different one to be picked. */
    readOnly?: boolean;
    /** Places the input in the tab order of a host that orders its fields with `tabIndex`. */
    tabIndex?: number;
    /** Receives the functions that drive the field from outside it. */
    handleRef?: MutableRef<NoteAutocompleteHandle | null>;
    /** The element the list hangs from and spans, in place of the field, for a host that frames it. */
    anchorRef?: RefObject<HTMLElement>;
}

/** Drives a note autocomplete from outside it, for a caller that decides when. */
export interface NoteAutocompleteHandle {
    /** Empties the field, lists the recently visited notes and focuses the field. */
    showRecentNotes(): void;
    /** Puts `>` in the field, lists every command and focuses the field. */
    showAllCommands(): void;
    /**
     * Puts `text`, trimmed, in the field and lists its suggestions, leaving the focus where it is.
     * `selectedPath` is the note the text stands for, where it names one already.
     */
    setText(text: string, selectedPath?: string): void;
    /** Empties the field and drops its selection without reporting either, as after a pick a host spends. */
    clear(): void;
}

export default function NoteAutocomplete({ id, inputRef: externalInputRef, text, placeholder, container, containerStyle, opts, onChange, onTextChange, onKeyDown, onBlur, noteIdChanged, noteId, readOnly, tabIndex, handleRef, anchorRef }: NoteAutocompleteProps) {
    const inputRef = useSyncedRef<HTMLInputElement>(externalInputRef);
    const groupRef = useRef<HTMLDivElement>(null);
    const [ value, setValue ] = useState("");
    const [ notePath, setNotePath ] = useState("");

    // Counts the full-text searches asked for since the last keystroke, which resets it, so that each
    // one changes `source` and so searches again.
    const [ fullTextSearchCount, setFullTextSearchCount ] = useState(0);
    const [ isSearchingFullText, setSearchingFullText ] = useState(false);

    const { isCommandPalette, allowCreatingNotes, allowJumpToSearchNotes, allowExternalLinks } = opts ?? {};
    const source = useCallback(async (query: string) => {
        if (isCommandPalette && query.startsWith(">")) {
            return getCommandSuggestions(query);
        }

        const options = { allowCreatingNotes, allowJumpToSearchNotes, allowExternalLinks };
        if (!fullTextSearchCount) {
            return withFullTextSearchRow(await getNoteSuggestions(query, options), query);
        }

        setSearchingFullText(true);
        try {
            return await getNoteSuggestions(query, { ...options, fastSearch: false });
        } finally {
            setSearchingFullText(false);
        }
    }, [ isCommandPalette, allowCreatingNotes, allowJumpToSearchNotes, allowExternalLinks, fullTextSearchCount ]);
    const schedule = useMemo(() => createSearchScheduler(), []);

    const selectNote = useCallback((suggestion: Suggestion) => {
        setValue(suggestion.noteTitle ?? "");
        setNotePath(suggestion.notePath ?? "");
        onChange?.(suggestion);
        if (noteIdChanged && suggestion.notePath) {
            noteIdChanged(lastSegment(suggestion.notePath));
        }
    }, [ onChange, noteIdChanged ]);

    function pickSuggestion(suggestion: Suggestion) {
        switch (suggestion.action) {
            case "command":
                // The host runs it; the field keeps what was typed.
                onChange?.(suggestion);
                break;
            case "search-notes":
                showInFullSearch(suggestion.noteTitle ?? "");
                break;
            case "full-text-search":
                fullTextSearch();
                break;
            case "external-link":
                setValue(suggestion.externalLink ?? "");
                setNotePath("");
                onChange?.(suggestion);
                break;
            case "create-note":
            case "create-child-note":
                // Reported as a picked note once created, with the row's `action` kept.
                void createNoteFromSuggestion(suggestion).then((notePath) => {
                    if (notePath) selectNote({ ...suggestion, notePath });
                });
                break;
            default:
                selectNote(suggestion);
        }
    }

    const autocomplete = useAutocomplete({
        query: value,
        source,
        onPick: pickSuggestion,
        inputRef,
        disabled: readOnly,
        autoActivate: true,
        textOf: suggestionText,
        // The row runs the search again over the notes' content, into the same list.
        keepOpenOnPick: (suggestion) => suggestion.action === "full-text-search",
        schedule
    });

    /** Drops the selected note, and reports that to the host. */
    function clearSelection() {
        setNotePath("");
        onChange?.(null);
        // The callers tell a cleared selection by `undefined` (`noteId ?? "root"`), which the prop's
        // type does not admit.
        noteIdChanged?.(undefined as unknown as string);
    }

    function clearText() {
        setValue("");
        setFullTextSearchCount(0);
        onTextChange?.("");
        clearSelection();
    }

    /**
     * Opens the search screen on `searchString`, and reports it as a picked `search-notes` row so that
     * a host can close, as Jump to Note does.
     */
    function showInFullSearch(searchString: string) {
        void appContext.triggerCommand("searchNotes", { searchString });
        onChange?.({ action: "search-notes", noteTitle: searchString });
    }

    /** Searches the content of the notes as well as their titles, for the text in the field. */
    function fullTextSearch() {
        if (!value.trim()) return;
        setNotePath("");
        setFullTextSearchCount((count) => count + 1);
        autocomplete.open();
        inputRef.current?.focus();
    }

    /** Puts `query` in the field with `selectedPath` as its selection, and lists the suggestions. */
    function showSuggestionsFor(query: string, selectedPath = "") {
        setFullTextSearchCount(0);
        setNotePath(selectedPath);
        setValue(query);
        // Written at once as well, so a caller can select the text right after the call.
        if (inputRef.current) inputRef.current.value = query;
        onTextChange?.(query);
        autocomplete.open();
    }

    function showAndFocus(query: string) {
        showSuggestionsFor(query);
        inputRef.current?.focus();
    }

    // An empty query is answered with the recently visited notes.
    const showRecentNotes = () => showAndFocus("");
    const showAllCommands = () => showAndFocus(">");
    const setText = (newText: string, selectedPath?: string) => showSuggestionsFor(newText.trim(), selectedPath);
    const clear = () => {
        setFullTextSearchCount(0);
        setNotePath("");
        setValue("");
        if (inputRef.current) inputRef.current.value = "";
    };

    // Refreshed on every render, so a call from outside reaches the current callbacks.
    useLayoutEffect(() => {
        if (handleRef) handleRef.current = { showRecentNotes, showAllCommands, setText, clear };
    });

    useEffect(() => {
        if (noteId) {
            setNotePath(noteId);
            void froca.getNote(noteId, true).then((note) => setValue(note?.title ?? ""));
        } else if (text?.trim()) {
            setText(text);
        } else {
            setNotePath("");
            setValue("");
        }
    }, [ text, noteId ]);

    const anchor = anchorRef?.current ?? groupRef.current;
    const showButtons = !opts?.hideAllButtons;
    const showGoToButton = showButtons && !opts?.hideGoToSelectedNoteButton;

    return (
        <div ref={groupRef} className="input-group" style={containerStyle}>
            <input
                id={id}
                ref={inputRef}
                className="note-autocomplete form-control note-autocomplete-input"
                value={value}
                readOnly={readOnly}
                tabIndex={tabIndex}
                placeholder={placeholder ?? t("add_link.search_note")}
                autoComplete="off"
                spellcheck={false}
                dir="auto"
                data-note-path={notePath}
                {...autocomplete.comboboxProps}
                onInput={(e) => {
                    const newValue = e.currentTarget.value;
                    setValue(newValue);
                    setFullTextSearchCount(0);
                    autocomplete.handleInput();
                    onTextChange?.(newValue);
                }}
                onChange={(e) => {
                    // Emptying the field clears the selection.
                    if (!e.currentTarget.value) clearSelection();
                }}
                onKeyDown={(e) => {
                    // An Enter while composing commits the input method's candidate instead.
                    const isEnter = e.key === "Enter" && !e.isComposing;
                    if (isEnter && e.ctrlKey && allowJumpToSearchNotes) {
                        // Kept from the host's other listeners, such as a Ctrl+Enter shortcut of its
                        // own.
                        e.preventDefault();
                        e.stopImmediatePropagation();
                        // Only where the list offers the row: a query that names notes, not commands.
                        if (value.trim() && !(isCommandPalette && value.startsWith(">"))) {
                            showInFullSearch(value.trim());
                        }
                        return;
                    }
                    if (isEnter && e.shiftKey) {
                        // Kept from the host and the list.
                        e.preventDefault();
                        e.stopPropagation();
                        fullTextSearch();
                        return;
                    }
                    // The rows of the fast search stay behind the row saying it is searching, so Enter
                    // waits for the full-text results instead of taking one of them.
                    if (isEnter && isSearchingFullText) {
                        e.preventDefault();
                        return;
                    }
                    // A list in the host's container stays until a pick, so the keys that close a
                    // popup are left to the host, such as a dialog closing on Escape.
                    if (!container || (e.key !== "Escape" && e.key !== "Tab")) {
                        autocomplete.handleKeyDown(e);
                    }
                    onKeyDown?.(e);
                }}
                onCompositionStart={autocomplete.handleCompositionStart}
                onCompositionEnd={autocomplete.handleCompositionEnd}
                onFocus={(e) => {
                    // An empty field lists the recently visited notes. A filled one waits for typing,
                    // so that focus returning from the note type chooser does not search again.
                    if (!e.currentTarget.value.trim()) autocomplete.open();
                }}
                onBlur={() => {
                    // A list in the host's container stays open until a pick.
                    if (!container) autocomplete.handleBlur();
                    onBlur?.(value.trim() ? lastSegment(notePath) : "");
                }}
            />

            {showGoToButton && (
                <a
                    className={clsx("input-group-text go-to-selected-note-button bx bx-arrow-to-right", !notePath.trim() && "disabled")}
                    href={`#${notePath}`}
                />
            )}

            {showButtons && <>
                <a
                    className="input-group-text input-clearer-button bx bxs-tag-x"
                    title={t("note_autocomplete.clear-text-field")}
                    onClick={clearText}
                />
            </>}

            {(autocomplete.isShown || (autocomplete.isOpen && isSearchingFullText)) && (container
                ? container.current && createPortal(
                    <NoteSuggestionList autocomplete={autocomplete} searchingFor={isSearchingFullText ? value : undefined} />,
                    container.current)
                : anchor && (
                    <Popup
                        anchor={anchor}
                        placement="bottom-start"
                        // The pointer moves the highlighted row, so `:hover` marks no second one.
                        className="dropdown-menu show tn-dropdown-menu tn-menu-keyboard note-autocomplete-menu"
                        // The list spans the whole field, buttons included, and widens past a narrow one.
                        style={{ width: `${Math.max(anchor.getBoundingClientRect().width, DROPDOWN_MIN_WIDTH)}px` }}
                        escapeDismisses={false}
                        onDismiss={autocomplete.close}
                    >
                        <NoteSuggestionMenu autocomplete={autocomplete} searchingFor={isSearchingFullText ? value : undefined} />
                    </Popup>
                ))}
        </div>
    );
}

/**
 * The list of suggestions, in the `aa-*` markup that the Empty tab and Jump to Note style. With
 * `searchingFor`, the query of a search in progress, it shows a row saying so in place of the
 * suggestions.
 */
function NoteSuggestionList({ autocomplete, searchingFor }: {
    autocomplete: ReturnType<typeof useAutocomplete<Suggestion>>;
    searchingFor?: string;
}) {
    return (
        <span
            className="aa-dropdown-menu"
            role="listbox"
            // Keeps the input focused, so its blur does not close the list before the click lands
            // on a suggestion.
            onMouseDown={(e) => e.preventDefault()}
        >
            <div className="aa-dataset-0">
                <span className="aa-suggestions">
                    {searchingFor !== undefined && (
                        <div className="aa-suggestion">
                            <NoteSuggestion suggestion={{ noteTitle: searchingFor, highlightedNotePathTitle: t("quick-search.searching") }} />
                        </div>
                    )}
                    {searchingFor === undefined && autocomplete.items.map((suggestion, index) => (
                        <Fragment key={`${suggestion.action ?? ""}:${suggestion.notePath ?? suggestion.commandId ?? index}`}>
                            {startsSearchRows(autocomplete.items, index) && <div className="note-suggestion-separator" role="separator" />}
                            <div
                                id={autocomplete.itemId(index)}
                                className={clsx("aa-suggestion", index === autocomplete.activeIndex && "aa-cursor")}
                                role="option"
                                aria-selected={index === autocomplete.activeIndex}
                                onMouseMove={(e) => autocomplete.hover(index, e)}
                                onClick={() => autocomplete.pick(suggestion)}
                            >
                                <NoteSuggestion suggestion={suggestion} />
                            </div>
                        </Fragment>
                    ))}
                </span>
            </div>
        </span>
    );
}

/**
 * The list of suggestions as the rows of a menu, for the popup, so it looks like the app's other
 * dropdowns. With `searchingFor`, it shows a row saying a search is in progress instead.
 */
function NoteSuggestionMenu({ autocomplete, searchingFor }: {
    autocomplete: ReturnType<typeof useAutocomplete<Suggestion>>;
    searchingFor?: string;
}) {
    return (
        <menu
            className="tn-menu-scroll"
            role="listbox"
            // Keeps the input focused, so its blur does not close the list before the click lands
            // on a suggestion.
            onMouseDown={(e) => e.preventDefault()}
        >
            {searchingFor !== undefined && (
                <li className="dropdown-item disabled">
                    <NoteSuggestionMenuItem suggestion={{ noteTitle: searchingFor, highlightedNotePathTitle: t("quick-search.searching") }} />
                </li>
            )}
            {searchingFor === undefined && autocomplete.items.map((suggestion, index) => (
                <Fragment key={`${suggestion.action ?? ""}:${suggestion.notePath ?? suggestion.commandId ?? index}`}>
                    {startsSearchRows(autocomplete.items, index) && <FormDropdownDivider />}
                    <li
                        id={autocomplete.itemId(index)}
                        className={clsx("dropdown-item", index === autocomplete.activeIndex && "tn-menu-active")}
                        role="option"
                        aria-selected={index === autocomplete.activeIndex}
                        onMouseMove={(e) => autocomplete.hover(index, e)}
                        onClick={() => autocomplete.pick(suggestion)}
                    >
                        <NoteSuggestionMenuItem suggestion={suggestion} />
                    </li>
                </Fragment>
            ))}
        </menu>
    );
}

/** One row of the menu, laid out as the rows of `FormListItem` are. */
function NoteSuggestionMenuItem({ suggestion }: { suggestion: Suggestion }) {
    return (
        <span>
            <NoteSuggestionMenuItemContent suggestion={suggestion} />
        </span>
    );
}

function NoteSuggestionMenuItemContent({ suggestion }: { suggestion: Suggestion }) {
    const isCommand = suggestion.action === "command";
    const icon = isCommand ? (suggestion.icon || "bx bx-terminal") : suggestionIcon(suggestion);
    const description = isCommand ? suggestion.commandDescription : suggestion.highlightedAttributeSnippet;

    return <>
        <Icon icon={icon} />
        <span className="tn-menu-gap" />
        <div className="note-suggestion-text">
            <RawHtml className="search-result-title" html={suggestion.highlightedNotePathTitle ?? ""} />
            {description && <RawHtml className="search-result-attributes" html={description} />}
        </div>
        <SuggestionShortcut suggestion={suggestion} />
    </>;
}

/**
 * Draws `suggestion` as the content of a `.dropdown-item` in a `.note-autocomplete-menu`, for a
 * list this component does not render, such as a search field's completions.
 */
export function renderNoteSuggestion(suggestion: Suggestion): HTMLElement {
    const element = document.createElement("span");
    render(<NoteSuggestionMenuItemContent suggestion={suggestion} />, element);

    return element;
}

/** One row of the list. */
function NoteSuggestion({ suggestion }: { suggestion: Suggestion }) {
    if (suggestion.action === "command") {
        return (
            <div className="command-suggestion">
                <span className={clsx("command-icon", suggestion.icon || "bx bx-terminal")} />
                <div className="command-content">
                    <div className="command-name">{suggestion.highlightedNotePathTitle}</div>
                    {suggestion.commandDescription && (
                        <div className="command-description">{suggestion.commandDescription}</div>
                    )}
                </div>
                {suggestion.commandShortcut && <kbd className="command-shortcut">{suggestion.commandShortcut}</kbd>}
            </div>
        );
    }

    return (
        <div className="note-suggestion">
            <span className={clsx("icon", suggestionIcon(suggestion))} />
            <span className="text">
                <SuggestionShortcut suggestion={suggestion} />
                <RawHtml className="search-result-title" html={suggestion.highlightedNotePathTitle ?? ""} />
                {suggestion.highlightedAttributeSnippet && (
                    <RawHtml className="search-result-attributes" html={suggestion.highlightedAttributeSnippet} />
                )}
            </span>
        </div>
    );
}

/** Whether a line goes above the row at `index`: the first of the rows searching for the query, after a note. */
function startsSearchRows(items: Suggestion[], index: number) {
    return index > 0 && isSearchRow(items[index]) && !isSearchRow(items[index - 1]);
}

function isSearchRow(suggestion: Suggestion) {
    return suggestion.action === "full-text-search" || suggestion.action === "search-notes";
}

function suggestionIcon(suggestion: Suggestion) {
    switch (suggestion.action) {
        // The icon of the saved search note it opens.
        case "search-notes": return NOTE_TYPE_ICONS.search;
        case "full-text-search": return "bx bx-search";
        case "create-note": return "bx bx-plus";
        case "create-child-note": return "bx bx-subdirectory-right";
        case "external-link": return "bx bx-link-external";
        default: return suggestion.icon ?? "bx bx-note";
    }
}

/**
 * The keys that act on a row from the field without picking it from the list, drawn as a button's
 * shortcut is. A command keeps its own, already formatted.
 */
function SuggestionShortcut({ suggestion }: { suggestion: Suggestion }) {
    if (suggestion.action === "command") {
        return suggestion.commandShortcut ? <kbd>{suggestion.commandShortcut}</kbd> : null;
    }

    const shortcut = searchRowShortcut(suggestion);
    if (!shortcut || cachedIsMobile) return null;
    return <span className="note-suggestion-shortcut">{renderShortcutKbds(shortcut)}</span>;
}

function searchRowShortcut(suggestion: Suggestion) {
    switch (suggestion.action) {
        case "search-notes": return "Ctrl+Enter";
        case "full-text-search": return "Shift+Enter";
    }
}

/**
 * Adds the row that searches the notes' content as well as their titles, ahead of the row that opens
 * a search, for a non-blank query.
 */
function withFullTextSearchRow(rows: Suggestion[], query: string): Suggestion[] {
    if (!query.trim()) return rows;

    const row: Suggestion = {
        action: "full-text-search",
        noteTitle: query,
        highlightedNotePathTitle: t("note_autocomplete.include-note-contents", { term: escapeHtml(query) })
    };
    const last = rows.at(-1);
    return last?.action === "search-notes" ? [ ...rows.slice(0, -1), row, last ] : [ ...rows, row ];
}

/**
 * The text the list opens highlighted on when it equals the query. Empty for an action row, whose
 * title is the query itself.
 */
function suggestionText(suggestion: Suggestion) {
    if (suggestion.action && suggestion.action !== "command") return "";
    return suggestion.noteTitle ?? "";
}

function lastSegment(notePath: string) {
    return notePath.split("/").at(-1) ?? "";
}
