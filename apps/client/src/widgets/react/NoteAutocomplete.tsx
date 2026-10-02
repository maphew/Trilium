import clsx from "clsx";
import type { RefObject } from "preact";
import type { CSSProperties } from "preact/compat";
import { useEffect, useState } from "preact/hooks";

import froca from "../../services/froca";
import { t } from "../../services/i18n";
import type { Options, Suggestion } from "../../services/note_autocomplete";
import { useSyncedRef } from "./hooks";

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

export default function NoteAutocomplete({ id, inputRef: externalInputRef, text, placeholder, containerStyle, opts, onTextChange, onKeyDown, onBlur, noteId, readOnly, tabIndex }: NoteAutocompleteProps) {
    const inputRef = useSyncedRef<HTMLInputElement>(externalInputRef);
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

    const showButtons = !opts?.hideAllButtons;
    const showGoToButton = showButtons && !opts?.hideGoToSelectedNoteButton;

    return (
        <div className="input-group" style={containerStyle}>
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
                onInput={(e) => {
                    const newValue = e.currentTarget.value;
                    setValue(newValue);
                    onTextChange?.(newValue);
                }}
                onKeyDown={onKeyDown}
                onBlur={() => onBlur?.(value.trim() ? notePath.split("/").at(-1) ?? "" : "")}
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
        </div>
    );
}
