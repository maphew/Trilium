import "./NoteAutocomplete.css";

import clsx from "clsx";
import type { RefObject } from "preact";
import type { CSSProperties } from "preact/compat";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import froca from "../../services/froca";
import { t } from "../../services/i18n";
import { getNoteSuggestions, type Options, type Suggestion } from "../../services/note_autocomplete";
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
}

export default function NoteAutocomplete({ id, inputRef: externalInputRef, text, placeholder, containerStyle, opts, onChange, onTextChange, onKeyDown, onBlur, noteIdChanged, noteId, readOnly, tabIndex }: NoteAutocompleteProps) {
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

    const source = useCallback((query: string) => getNoteSuggestions(query), []);

    const pickSuggestion = useCallback((suggestion: Suggestion) => {
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
        textOf: suggestionText
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
                    autocomplete.handleBlur();
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
                />
                <a
                    className="input-group-text input-clearer-button bx bxs-tag-x"
                    title={t("note_autocomplete.clear-text-field")}
                />
            </>}

            {autocomplete.isShown && groupRef.current && (
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
                    <span
                        className="aa-dropdown-menu"
                        role="listbox"
                        // Keeps the input focused, so its blur does not close the list before the
                        // click lands on a suggestion.
                        onMouseDown={(e) => e.preventDefault()}
                    >
                        <div className="aa-dataset-0">
                            <span className="aa-suggestions">
                                {autocomplete.items.map((suggestion, index) => (
                                    <div
                                        key={`${suggestion.action ?? ""}:${suggestion.notePath ?? index}`}
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
                </Popup>
            )}
        </div>
    );
}

/** One row of the list, in the markup of the jQuery plugin's suggestion template. */
function NoteSuggestion({ suggestion }: { suggestion: Suggestion }) {
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
