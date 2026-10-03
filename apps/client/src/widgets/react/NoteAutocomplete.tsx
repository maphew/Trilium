import "./Menu.css";
import "./NoteAutocomplete.css";

import { NOTE_TYPE_ICONS } from "@triliumnext/commons";
import clsx from "clsx";
import { type RefObject, render } from "preact";
import { createPortal, type CSSProperties } from "preact/compat";
import { type MutableRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context";
import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { createSearchScheduler, createNoteFromSuggestion, getCommandSuggestions, getNoteSuggestions, type Options, recentNoteGroup, type RecentNoteGroup, type Suggestion } from "../../services/note_autocomplete";
import { escapeHtml, isMobile } from "../../services/utils";
import { ShortcutHintOverlayButton } from "../shortcut_hints/shortcut_hint_button";
import { AttributeSnippetBadges } from "./Badge";
import Button from "./Button";
import { useAutocomplete } from "./FormAutocomplete";
import { FormDropdownDivider, FormListHeader } from "./FormList";
import FormToggle from "./FormToggle";
import { useContextualShortcutHints, useSyncedRef } from "./hooks";
import Icon from "./Icon";
import OverlayControlGroup from "./OverlayControlGroup";
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
    /**
     * Offers the searches in a footer under a list in the host's container, with the shortcut hints
     * button, rather than as rows: for a host that scrolls the list in a box of its own, as Jump to
     * Note does.
     */
    searchFooter?: boolean;
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

export default function NoteAutocomplete({ id, inputRef: externalInputRef, text, placeholder, container, containerStyle, opts, onChange, onTextChange, onKeyDown, onBlur, noteIdChanged, noteId, readOnly, tabIndex, handleRef, anchorRef, searchFooter }: NoteAutocompleteProps) {
    const inputRef = useSyncedRef<HTMLInputElement>(externalInputRef);
    const groupRef = useRef<HTMLDivElement>(null);
    const [ value, setValue ] = useState("");
    const [ notePath, setNotePath ] = useState("");

    // Counts the full-text searches asked for since the last keystroke, which resets it, so that each
    // one changes `source` and so searches again.
    const [ fullTextSearchCount, setFullTextSearchCount ] = useState(0);
    const [ isSearchingFullText, setSearchingFullText ] = useState(false);
    // A footer under a list in a host's container offers its searches: a switch for the content
    // search, which stays on as the query changes, and a button for the full search.
    const hasSearchFooter = !!container && !!searchFooter;
    const [ includeContents, setIncludeContents ] = useState(false);

    const { isCommandPalette, allowCreatingNotes, allowJumpToSearchNotes, allowExternalLinks } = opts ?? {};
    const source = useCallback(async (query: string) => {
        if (isCommandPalette && query.startsWith(">")) {
            return getCommandSuggestions(query);
        }

        const options = {
            allowCreatingNotes,
            allowJumpToSearchNotes: allowJumpToSearchNotes && !hasSearchFooter,
            allowExternalLinks
        };
        if (hasSearchFooter) {
            return getNoteSuggestions(query, includeContents ? { ...options, fastSearch: false } : options);
        }
        if (!fullTextSearchCount) {
            return withFullTextSearchRow(await getNoteSuggestions(query, options), query);
        }

        setSearchingFullText(true);
        try {
            return await getNoteSuggestions(query, { ...options, fastSearch: false });
        } finally {
            setSearchingFullText(false);
        }
    }, [
        isCommandPalette, allowCreatingNotes, allowJumpToSearchNotes, allowExternalLinks, fullTextSearchCount,
        hasSearchFooter, includeContents
    ]);
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
        fallbackIndex: createWhenNoNote,
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

    /** Whether `query` is one to open the full search on: a non-blank query naming notes, not commands. */
    function canSearchFor(query: string) {
        return !!query.trim() && !(isCommandPalette && query.startsWith(">"));
    }

    /**
     * Opens the search screen on `searchString`, and reports it as a picked `search-notes` row so that
     * a host can close, as Jump to Note does.
     */
    function showInFullSearch(searchString: string) {
        void appContext.triggerCommand("searchNotes", { searchString });
        onChange?.({ action: "search-notes", noteTitle: searchString });
    }

    /**
     * Searches the content of the notes as well as their titles, for the text in the field. A list with
     * a search footer switches its content search on or off instead.
     */
    function fullTextSearch() {
        if (hasSearchFooter) {
            // As the footer's switch, which is hidden for a query naming no notes.
            if (!canSearchFor(value)) return;
            setIncludeContents((include) => !include);
            autocomplete.open();
            inputRef.current?.focus();
            return;
        }
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
    const showsList = autocomplete.isShown || (autocomplete.isOpen && isSearchingFullText);
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
                        // Only where the list offers it: a query that names notes, not commands.
                        if (canSearchFor(value)) {
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

            {hasSearchFooter && <SearchFooterShortcutHints allowFullSearch={!!allowJumpToSearchNotes} />}

            {showButtons && <>
                <a
                    className="input-group-text input-clearer-button bx bxs-tag-x"
                    title={t("note_autocomplete.clear-text-field")}
                    onClick={clearText}
                />
            </>}

            {container
                ? autocomplete.isOpen && container.current && createPortal(<>
                    {showsList && <NoteSuggestionMenu
                        autocomplete={autocomplete}
                        searchingFor={isSearchingFullText ? value : undefined}
                        // The popup's rows, in the host's panel. Faded at an edge only where the host
                        // sets `--scroll-fade-top` or `--scroll-fade-bottom`.
                        className="note-autocomplete-menu note-suggestion-list tn-menu-keyboard scroll-edge-fade"
                    />}
                    {/* Kept for any query, so the list does not move as the searches come and go. */}
                    {hasSearchFooter && (
                        <div
                            className={clsx("note-suggestion-footer",
                                !canSearchFor(value) && "nothing-to-search")}
                            // Keeps the focus in the field, as the rows do.
                            onMouseDown={(e) => e.preventDefault()}
                        >
                            {!cachedIsMobile && (
                                <OverlayControlGroup>
                                    <ShortcutHintOverlayButton />
                                </OverlayControlGroup>
                            )}
                            <FormToggle
                                switchOnName={t("note_autocomplete.include-contents")}
                                switchOffName={t("note_autocomplete.include-contents")}
                                currentValue={includeContents}
                                onChange={fullTextSearch}
                            />
                            {allowJumpToSearchNotes && <Button
                                className="show-in-full-search"
                                kind="lowProfile"
                                size="small"
                                text={t("quick-search.show-in-full-search")}
                                onClick={() => showInFullSearch(value.trim())}
                            />}
                        </div>
                    )}
                </>, container.current)
                : showsList && anchor && (
                    <Popup
                        anchor={anchor}
                        // Rendered in the field's modal so the list stacks above it: the note picker
                        // raises its modal (2000) over `.tn-popup` in the body (1200).
                        container={anchor.closest<HTMLElement>(".modal") ?? undefined}
                        placement="bottom-start"
                        // The pointer moves the highlighted row, so `:hover` marks no second one.
                        className="dropdown-menu show tn-dropdown-menu tn-menu-keyboard note-autocomplete-menu"
                        // The list spans the whole field, buttons included, and widens past a narrow one.
                        style={{ width: `${Math.max(anchor.getBoundingClientRect().width, DROPDOWN_MIN_WIDTH)}px` }}
                        escapeDismisses={false}
                        onDismiss={autocomplete.close}
                    >
                        <NoteSuggestionMenu
                            autocomplete={autocomplete}
                            searchingFor={isSearchingFullText ? value : undefined}
                            className="tn-menu-scroll"
                        />
                    </Popup>
                )}
        </div>
    );
}

/**
 * The list of suggestions as the rows of a menu, so it looks like the app's other dropdowns, whether
 * in the popup or in a host's container. With `searchingFor`, the query of a search in progress, it
 * shows a row saying so in place of the suggestions.
 */
/**
 * Lists the keys of a list with a search footer in the shortcut hints pane, which the footer's button
 * opens. Only such a list adds hints, as they replace whatever the host registered.
 */
function SearchFooterShortcutHints({ allowFullSearch }: { allowFullSearch: boolean }) {
    useContextualShortcutHints(() => [ {
        titleKey: "note_autocomplete.hints.title",
        hints: [
            { keys: [ "Up", "Down" ], labelKey: "note_autocomplete.hints.move" },
            { keys: [ "Enter" ], labelKey: "note_autocomplete.hints.open" },
            { keys: [ "Shift+Enter" ], labelKey: "note_autocomplete.include-contents" },
            ...(allowFullSearch
                ? [ { keys: [ "Ctrl+Enter" ], labelKey: "quick-search.show-in-full-search" } ]
                : [])
        ]
    } ]);
    return null;
}

function NoteSuggestionMenu({ autocomplete, searchingFor, className }: {
    autocomplete: ReturnType<typeof useAutocomplete<Suggestion>>;
    searchingFor?: string;
    className: string;
}) {
    // Only the recent notes listed on an empty query carry a visit time, and take a heading per group.
    const now = new Date();
    const recentGroups = autocomplete.items.map((suggestion) =>
        suggestion.utcDateVisited ? recentNoteGroup(suggestion.utcDateVisited, now) : undefined);

    return (
        <menu
            className={className}
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
            {searchingFor === undefined && listsNoNote(autocomplete.items) && <>
                <li className="dropdown-item disabled">
                    <NoteSuggestionMenuItem suggestion={noNotesRow()} />
                </li>
                <FormDropdownDivider />
            </>}
            {searchingFor === undefined && autocomplete.items.map((suggestion, index) => [
                startsGroup(autocomplete.items, index) && <FormDropdownDivider key={`divider-${index}`} />,
                recentGroups[index] && recentGroups[index] !== recentGroups[index - 1] && (
                    <FormListHeader key={`heading-${index}`} text={recentGroupTitle(recentGroups[index])} />
                ),
                <li
                    key={suggestionKey(suggestion, index)}
                    id={autocomplete.itemId(index)}
                    className={clsx("dropdown-item", index === autocomplete.activeIndex && "tn-menu-active")}
                    role="option"
                    aria-selected={index === autocomplete.activeIndex}
                    onMouseMove={(e) => autocomplete.hover(index, e)}
                    onClick={() => autocomplete.pick(suggestion)}
                >
                    <NoteSuggestionMenuItem suggestion={suggestion} />
                </li>
            ])}
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

    return <>
        <Icon icon={icon} />
        <span className="tn-menu-gap" />
        <div className="note-suggestion-text">
            <RawHtml className="search-result-title" html={suggestion.highlightedNotePathTitle ?? ""} />
            {isCommand
                ? suggestion.commandDescription && (
                    <span className="note-suggestion-description">{suggestion.commandDescription}</span>
                )
                : <AttributeSnippetBadges
                    snippet={suggestion.highlightedAttributeSnippet}
                    className="note-suggestion-attributes"
                />}
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

/**
 * Which group of the list a row belongs to: the notes (with an external link or a command), the
 * rows searching further for the query, or the rows creating a note from it.
 */
function rowGroup(suggestion: Suggestion) {
    switch (suggestion.action) {
        case "full-text-search":
        case "search-notes":
            return "search";
        case "create-note":
        case "create-child-note":
            return "create";
        default:
            return "note";
    }
}

/**
 * With no note to open, the list opens on creating one rather than on the search rows ahead of it, so
 * Enter still makes the note a title names. Negative, for the first row, while there are notes.
 */
function createWhenNoNote(items: Suggestion[]) {
    return items.some((suggestion) => rowGroup(suggestion) === "note")
        ? -1
        : items.findIndex((suggestion) => suggestion.action === "create-note");
}

/**
 * Whether a query listed rows but no note, so that the search and creation rows do not read as notes
 * on their own: the lists then open with a disabled row saying so.
 */
function listsNoNote(items: Suggestion[]) {
    return items.length > 0 && !items.some((suggestion) => rowGroup(suggestion) === "note");
}

/** The disabled row opening a list that holds no note, built when rendered so that it is translated. */
function noNotesRow(): Suggestion {
    return { icon: "bx bx-info-circle", highlightedNotePathTitle: t("quick-search.no-results") };
}

/** Whether a line goes above the row at `index`: the first of a group, after the rows of another. */
function startsGroup(items: Suggestion[], index: number) {
    return index > 0 && rowGroup(items[index]) !== rowGroup(items[index - 1]);
}

function suggestionKey(suggestion: Suggestion, index: number) {
    return `${suggestion.action ?? ""}:${suggestion.notePath ?? suggestion.commandId ?? index}`;
}

function recentGroupTitle(group: RecentNoteGroup) {
    switch (group) {
        case "today": return t("note_autocomplete.recent.today");
        case "yesterday": return t("note_autocomplete.recent.yesterday");
        case "past-week": return t("note_autocomplete.recent.past_week");
        case "past-month": return t("note_autocomplete.recent.past_month");
        case "older": return t("note_autocomplete.recent.older");
    }
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
 * The keys of a row, drawn as a button's shortcut is: a command's own, or the keys that act on a
 * search row from the field without picking it from the list.
 */
function SuggestionShortcut({ suggestion }: { suggestion: Suggestion }) {
    const shortcut = suggestion.action === "command" ? suggestion.commandShortcut : searchRowShortcut(suggestion);
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
    // Right after the notes: ahead of the row opening the full search and of the creation rows.
    const at = rows.findIndex((suggestion) => rowGroup(suggestion) !== "note");
    return at < 0 ? [ ...rows, row ] : [ ...rows.slice(0, at), row, ...rows.slice(at) ];
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
