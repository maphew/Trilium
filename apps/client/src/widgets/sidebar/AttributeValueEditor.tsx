import "./AttributeValueEditor.css";

import type { LabelType } from "@triliumnext/commons";
import clsx from "clsx";
import { useEffect, useLayoutEffect, useMemo, useRef } from "preact/hooks";

import type FNote from "../../entities/fnote";
import type { Attribute } from "../../services/attribute_parser";
import { getBuiltinLabelSelectOptions, getBuiltinLabelValueType, isBuiltinAttribute } from "../../services/attributes";
import { t } from "../../services/i18n";
import LabelValueInput, { getTypedInputForLabel } from "../attribute_widgets/label_value_input";
import { AUTOCOMPLETE_DROPDOWN_SELECTOR } from "../react/FormAutocomplete";
import { useGrowsUpwards } from "../react/grows_upwards";
import NoteAutocomplete from "../react/NoteAutocomplete";

interface AttributeValueEditorProps {
    /** The note the label belongs to, read for the definition that says what kind of field to offer. */
    note: FNote;
    attribute: Attribute;
    /** Receives the value as it is typed; the host writes it into the row it holds, and saves on commit. */
    onEdit(value: string): void;
    /** Close keeping the edits, which the host saves. */
    onCommit(): void;
    /** Close putting the value back as it was. */
    onRevert(): void;
}

/**
 * An attribute's value edited in the row that previews it, without opening the detail form: for a
 * label the same field its promoted counterpart offers — a date picker for a date, a palette for a
 * colour, a dropdown for a closed set, a plain box where nothing says more about the value than that
 * it is one — and for a relation the note search its target is picked in everywhere else.
 *
 * Leaving the field is what ends the edit and keeps it, matching the attributes editor's save-on-blur;
 * escape puts the value back instead. Only the value is edited here — the name, the flags and the
 * definitions stay with the form the rest of the row opens.
 */
export default function AttributeValueEditor({ note, attribute, onEdit, onCommit, onRevert }: AttributeValueEditorProps) {
    const containerRef = useRef<HTMLSpanElement>(null);
    // The editor stands over its row rather than in it (see the stylesheet), so near the foot of the
    // pane it is anchored by its foot instead, what it outgrows the row by rising over what has been
    // read already — the same turn the table's cell editor takes, through the same measure.
    const growsUpwards = useGrowsUpwards(containerRef);
    const isRelation = attribute.type === "relation";

    // The overlay is held off the row's leading edge so the name stays readable (see the stylesheet)
    // — but only as far as the name actually reaches, told to the stylesheet here: a short name would
    // otherwise sit apart from its editor, with an odd gap where the cap had room to spare. Measured
    // once, before the paint that would show the gap: nothing here edits the name.
    useLayoutEffect(() => {
        const editor = containerRef.current;
        const row = editor?.parentElement;
        const name = row?.querySelector<HTMLElement>(".attribute-name");
        if (!editor || !row || !name) return;

        const rowRect = row.getBoundingClientRect();
        const nameRect = name.getBoundingClientRect();
        const nameEnd = getComputedStyle(row).direction === "rtl"
            ? rowRect.right - nameRect.left
            : nameRect.right - rowRect.left;
        editor.style.setProperty("--value-editor-name-end", `${Math.ceil(nameEnd) + ROW_GAP}px`);
    }, []);
    // What a label is typed as; a relation's field follows from being one.
    const typed = useMemo(
        () => isRelation ? undefined : resolveValueField(note, attribute.name),
        [ isRelation, note, attribute.name ]);

    // The editor exists because its row was pressed, so the field is ready to type into at once — and
    // what is there is selected, a short value being more often replaced than appended to. A colour
    // goes further: picking is all there is to do to it, so the picker's dialog opens with the editor
    // rather than waiting to be asked by a second press on the swatch.
    useEffect(() => {
        const field = containerRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select");
        field?.focus();
        if ((field instanceof HTMLInputElement && SELECT_ALL_TYPES.has(field.type)) || field instanceof HTMLTextAreaElement) {
            field.select();
        } else if (field instanceof HTMLInputElement && field.type === "color") {
            try {
                // Optional because not every engine offers it, and guarded because it refuses to open
                // without the user activation the press provides — which a test's render lacks.
                field.showPicker?.();
            } catch {
                // The swatch is still there to be pressed, as it would be without the head start.
            }
        }
    }, []);

    useEffect(() => {
        const editor = containerRef.current;
        if (!editor) return;

        const onFocusOut = (e: FocusEvent) => {
            // Focus moving within the editor — the field to a button beside it — is not leaving it.
            if (e.relatedTarget instanceof Node && editor.contains(e.relatedTarget)) return;

            // Nor is it leaving for floating UI that belongs to the field: the note search's dropdown
            // is appended to the body, and creating a note from it opens the note type chooser — the
            // same company the detail popup keeps itself open over.
            if (e.relatedTarget instanceof Element
                && e.relatedTarget.closest(`${AUTOCOMPLETE_DROPDOWN_SELECTOR}, .algolia-autocomplete, .modal, .modal-backdrop`)) {
                return;
            }

            // Nothing in the page took the focus over, and either the editor still holds it or the
            // window itself has lost it — which is what opening a native picker's dialog does. The
            // row has not been left, and committing here would close the editor under the dialog.
            if (!e.relatedTarget && (!document.hasFocus() || editor.contains(document.activeElement))) {
                return;
            }

            onCommit();
        };

        editor.addEventListener("focusout", onFocusOut);
        return () => editor.removeEventListener("focusout", onFocusOut);
    }, [ onCommit ]);

    return (
        <span
            ref={containerRef}
            className={clsx("attribute-value-editor", growsUpwards && "grows-upwards")}
            // Keep the press from reaching the row, which would open the popup over the edit.
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => {
                // The buttons beside a field (a colour's reset, a link's open) take no focus of their
                // own: letting the press blur the field would commit and unmount the editor before the
                // click could land on them.
                if (e.target instanceof Element && !e.target.closest("input, textarea, select")) {
                    e.preventDefault();
                }
            }}
            onKeyDown={(e) => {
                if (e.key === "Escape") {
                    e.stopPropagation();
                    onRevert();
                // Enter is the note search's own key — it is what picks — so only a label commits on
                // it; a textarea keeps it for its newlines unless it is held down with the modifier.
                } else if (e.key === "Enter" && typed && (typed.labelType !== "textarea" || e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    onCommit();
                }
            }}
        >
            {typed ? (
                <LabelValueInput
                    labelType={typed.labelType}
                    value={attribute.value ?? ""}
                    onCommit={onEdit}
                    commitOn="input"
                    numberPrecision={typed.numberPrecision}
                    selectOptions={typed.selectOptions}
                    // The row has no room to spare beside the field for the button opening a
                    // link-like value; the detail form keeps it, having the room.
                    hideOpenButton
                    inputProps={{
                        className: "form-control",
                        // Names the dropdown's empty entry, as the detail form does for the same field.
                        ...(typed.labelType === "select" && {
                            placeholder: t("promoted_attributes.unset-field-placeholder")
                        })
                    }}
                />
            ) : (
                <NoteAutocomplete
                    noteId={attribute.value || undefined}
                    opts={TARGET_NOTE_OPTS}
                    noteIdChanged={(noteId) => onEdit(noteId ?? "")}
                />
            )}
        </span>
    );
}

/** Constant so it does not re-initialise the autocomplete on every render, as in the detail form —
 *  less the buttons beside the box (go to, search, recent), which are more furniture than a row has
 *  room for; the field a relation holding several targets offers leaves them out the same way. */
const TARGET_NOTE_OPTS = { allowCreatingNotes: true, hideAllButtons: true };

/** The input types whose content `select()` applies to; the pickers select nothing and mind nothing. */
const SELECT_ALL_TYPES = new Set([ "text", "number", "url", "email", "tel" ]);

/** The breath between the name and the overlay's edge: the gap the row lays its items out with. */
const ROW_GAP = 6;

/**
 * What kind of field the label's value is edited through: for a system label the same closed sets and
 * kinds the detail form offers, exclusions included (a flag means what its presence means, so no
 * checkbox over it); for the rest whatever definition reaches the note for the name, promoted or not,
 * down to the plain text box a label defined by nothing is typed into.
 *
 * Exported for the row's preview, which reads the same answer to know a colour when it shows one.
 */
export function resolveValueField(note: FNote, name: string): {
    labelType: LabelType;
    selectOptions?: readonly string[];
    numberPrecision?: number;
} {
    if (isBuiltinAttribute("label", name)) {
        const labelType = getTypedInputForLabel(getBuiltinLabelValueType(name));
        return {
            labelType: labelType ?? "text",
            selectOptions: labelType ? getBuiltinLabelSelectOptions(name) : undefined
        };
    }

    const definition = note.getAttributeDefinitions()
        .find((definitionAttr) => definitionAttr.name === `label:${name}`)
        ?.getDefinition();

    return {
        labelType: definition?.labelType ?? "text",
        selectOptions: definition?.selectOptions,
        numberPrecision: definition?.numberPrecision
    };
}
