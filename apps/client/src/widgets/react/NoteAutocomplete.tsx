import "./NoteAutocomplete.css";

import clsx from "clsx";
import type { RefObject } from "preact";
import { createPortal, type CSSProperties } from "preact/compat";
import { type MutableRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { createSearchScheduler, getCommandSuggestions, getNoteSuggestions, type Options, type Suggestion } from "../../services/note_autocomplete";
import { useAutocomplete } from "./FormAutocomplete";
import { useSyncedRef } from "./hooks";
import Popup from "./Popup";
import RawHtml from "./RawHtml";

export interface NoteAutocompleteProps {
    id?: string;
    inputRef?: RefObject<HTMLInputElement>;
    text?: string;
    placeholder?: string;
    container?: RefObject<HTMLElement | null | undefined>;
    containerStyle?: CSSProperties;
    opts?: Omit<Options, "container">;
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
}

/** Drives a note autocomplete from outside it, for a caller that decides when. */
export interface NoteAutocompleteHandle {
    /** Empties the field, lists the recently visited notes and focuses the field. */
    showRecentNotes(): void;
    /** Puts `>` in the field, lists every command and focuses the field. */
    showAllCommands(): void;
}

export default function NoteAutocomplete({ id, inputRef: externalInputRef, text, placeholder, container, containerStyle, opts, onChange, onTextChange, onKeyDown, onBlur, noteIdChanged, noteId, readOnly, tabIndex, handleRef }: NoteAutocompleteProps) {
    const inputRef = useSyncedRef<HTMLInputElement>(externalInputRef);
    const groupRef = useRef<HTMLDivElement>(null);
    const [ value, setValue ] = useState("");
    const [ notePath, setNotePath ] = useState("");

    useEffect(() => {
        if (noteId) {
            setNotePath(noteId);
            void froca.getNote(noteId, true).then((note) => setValue(note?.title ?? ""));
        } else {
            setNotePath("");
            setValue(text?.trim() ?? "");
        }
    }, [ text, noteId ]);

    const isCommandPalette = !!opts?.isCommandPalette;
    const source = useCallback(async (query: string) => (isCommandPalette && query.startsWith(">")
        ? getCommandSuggestions(query)
        : getNoteSuggestions(query)), [ isCommandPalette ]);
    const schedule = useMemo(() => createSearchScheduler(), []);

    const pickSuggestion = useCallback((suggestion: Suggestion) => {
        // The host runs a command; the field keeps what was typed.
        if (suggestion.action === "command") {
            onChange?.(suggestion);
            return;
        }

        setValue(suggestion.noteTitle ?? "");
        setNotePath(suggestion.notePath ?? "");
        onChange?.(suggestion);
        if (noteIdChanged && suggestion.notePath) {
            noteIdChanged(lastSegment(suggestion.notePath));
        }
    }, [ onChange, noteIdChanged ]);

    const autocomplete = useAutocomplete({
        query: value,
        source,
        onPick: pickSuggestion,
        inputRef,
        disabled: readOnly,
        autoActivate: true,
        textOf: suggestionText,
        schedule
    });

    /** Puts `query` in the field, drops the selection, lists the suggestions and focuses the field. */
    function showSuggestionsFor(query: string) {
        setNotePath("");
        setValue(query);
        onTextChange?.(query);
        autocomplete.open();
        inputRef.current?.focus();
    }

    // An empty query is answered with the recently visited notes.
    const showRecentNotes = () => showSuggestionsFor("");
    const showAllCommands = () => showSuggestionsFor(">");

    // Refreshed on every render, so a call from outside reaches the current callbacks.
    useLayoutEffect(() => {
        if (handleRef) handleRef.current = { showRecentNotes, showAllCommands };
    });

    const showButtons = !opts?.hideAllButtons;
    const showGoToButton = showButtons && !opts?.hideGoToSelectedNoteButton;

    return (
        <div ref={groupRef} className="input-group" style={containerStyle}>
            <input
                id={id}
                ref={inputRef}
                // `note-autocomplete-input` and `aa-input` are the classes the jQuery plugin used to
                // add, which the stylesheets and the global `$(".aa-input")` closers still select.
                className="note-autocomplete form-control note-autocomplete-input aa-input"
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
                    autocomplete.handleInput();
                    onTextChange?.(newValue);
                }}
                onChange={(e) => {
                    // Emptying the field clears the selection.
                    if (e.currentTarget.value) return;
                    setNotePath("");
                    onChange?.(null);
                    // The callers tell a cleared selection by `undefined` (`noteId ?? "root"`),
                    // which the prop's type does not admit.
                    noteIdChanged?.(undefined as unknown as string);
                }}
                onKeyDown={(e) => {
                    autocomplete.handleKeyDown(e);
                    onKeyDown?.(e);
                }}
                onBlur={() => {
                    // A list in the host's container stays open until Escape or a pick.
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
                    className="input-group-text full-text-search-button bx bx-search"
                    title={`${t("note_autocomplete.full-text-search")} (Shift+Enter)`}
                />
                <a
                    className="input-group-text show-recent-notes-button bx bx-time"
                    title={t("note_autocomplete.show-recent-notes")}
                    // Keeps the focus in the input, which the list closes without.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={showRecentNotes}
                />
                <a
                    className="input-group-text input-clearer-button bx bxs-tag-x"
                    title={t("note_autocomplete.clear-text-field")}
                />
            </>}

            {autocomplete.isShown && (container
                ? container.current && createPortal(
                    <NoteSuggestionList autocomplete={autocomplete} />,
                    container.current)
                : groupRef.current && (
                    <Popup
                        anchor={groupRef.current}
                        placement="bottom-start"
                        capHeight={false}
                        className="algolia-autocomplete"
                        // The list spans the whole field, buttons included.
                        style={{ width: `${groupRef.current.getBoundingClientRect().width}px` }}
                        escapeDismisses={false}
                        onDismiss={autocomplete.close}
                    >
                        <NoteSuggestionList autocomplete={autocomplete} />
                    </Popup>
                ))}
        </div>
    );
}

/** The list of suggestions, in the markup of `autocomplete.js`. */
function NoteSuggestionList({ autocomplete }: { autocomplete: ReturnType<typeof useAutocomplete<Suggestion>> }) {
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
                    {autocomplete.items.map((suggestion, index) => (
                        <div
                            key={`${suggestion.action ?? ""}:${suggestion.notePath ?? suggestion.commandId ?? index}`}
                            id={autocomplete.itemId(index)}
                            className={clsx("aa-suggestion", index === autocomplete.activeIndex && "aa-cursor")}
                            role="option"
                            aria-selected={index === autocomplete.activeIndex}
                            onMouseEnter={() => autocomplete.setActiveIndex(index)}
                            onClick={() => autocomplete.pick(suggestion)}
                        >
                            <NoteSuggestion suggestion={suggestion} />
                        </div>
                    ))}
                </span>
            </div>
        </span>
    );
}

/** One row of the list, in the markup of the jQuery plugin's suggestion template. */
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
        <div className={clsx("note-suggestion", suggestion.action === "search-notes" && "search-notes-action")}>
            <span className={clsx("icon", suggestionIcon(suggestion))} />
            <span className="text">
                <RawHtml className="search-result-title" html={suggestion.highlightedNotePathTitle ?? ""} />
                {suggestion.highlightedAttributeSnippet && (
                    <RawHtml className="search-result-attributes" html={suggestion.highlightedAttributeSnippet} />
                )}
            </span>
        </div>
    );
}

function suggestionIcon(suggestion: Suggestion) {
    switch (suggestion.action) {
        case "search-notes": return "bx bx-search";
        case "create-note": return "bx bx-plus";
        case "create-child-note": return "bx bx-subdirectory-right";
        case "external-link": return "bx bx-link-external";
        default: return suggestion.icon ?? "bx bx-note";
    }
}

function suggestionText(suggestion: Suggestion) {
    return suggestion.noteTitle ?? "";
}

function lastSegment(notePath: string) {
    return notePath.split("/").at(-1) ?? "";
}
