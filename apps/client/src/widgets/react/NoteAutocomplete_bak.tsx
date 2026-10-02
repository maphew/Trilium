import { useEffect } from "preact/hooks";
import note_autocomplete from "../../services/note_autocomplete";
import { useSyncedRef } from "./hooks";
import type { NoteAutocompleteProps } from "./NoteAutocomplete";

export default function NoteAutocomplete({ inputRef: externalInputRef, text, onChange, opts, noteId, noteIdChanged }: NoteAutocompleteProps) {
    const ref = useSyncedRef<HTMLInputElement>(externalInputRef);

    useEffect(() => {
        if (!ref.current) return;
        const $autoComplete = $(ref.current);

        // clear any event listener added in previous invocation of this function
        $autoComplete
            .off("autocomplete:noteselected");

        note_autocomplete.initNoteAutocomplete($autoComplete, opts);
    }, [opts]);

    // On change event handlers.
    useEffect(() => {
        if (!ref.current) return;
        const $autoComplete = $(ref.current);

        if (onChange || noteIdChanged) {
            const autoCompleteListener = (_e, suggestion) => {
                onChange?.(suggestion);

                if (noteIdChanged) {
                    const noteId = suggestion?.notePath?.split("/")?.at(-1);
                    noteIdChanged(noteId);
                }
            };
            $autoComplete
                .on("autocomplete:externallinkselected", autoCompleteListener);
            return () => {
                $autoComplete
                    .off("autocomplete:externallinkselected", autoCompleteListener);
            };
        }
    }, [opts, onChange, noteIdChanged])

    useEffect(() => {
        if (!ref.current || noteId || !text) return;

        // Opens the dropdown on the given text.
        note_autocomplete.setText($(ref.current), text);
    }, [text, noteId]);

    return null;
}
