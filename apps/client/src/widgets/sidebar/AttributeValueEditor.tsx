import "./AttributeValueEditor.css";

import type { LabelType } from "@triliumnext/commons";
import { useEffect, useMemo, useRef } from "preact/hooks";

import type FNote from "../../entities/fnote";
import type { Attribute } from "../../services/attribute_parser";
import { getBuiltinLabelSelectOptions, getBuiltinLabelValueType, isBuiltinAttribute } from "../../services/attributes";
import { t } from "../../services/i18n";
import LabelValueInput, { getTypedInputForLabel } from "../attribute_widgets/label_value_input";

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
 * A label's value edited in the row that previews it, without opening the detail form: the same field
 * its promoted counterpart offers — a date picker for a date, a palette for a colour, a dropdown for a
 * closed set — or a plain box where nothing says more about the value than that it is one.
 *
 * Leaving the field is what ends the edit and keeps it, matching the attributes editor's save-on-blur;
 * escape puts the value back instead. Only the value is edited here — the name, the flags and the
 * definitions stay with the form the rest of the row opens.
 */
export default function AttributeValueEditor({ note, attribute, onEdit, onCommit, onRevert }: AttributeValueEditorProps) {
    const containerRef = useRef<HTMLSpanElement>(null);
    const typed = useMemo(() => resolveValueField(note, attribute.name), [ note, attribute.name ]);

    // The editor exists because its row was pressed, so the field is ready to type into at once — and
    // what is there is selected, a short value being more often replaced than appended to.
    useEffect(() => {
        const field = containerRef.current?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, select");
        field?.focus();
        if ((field instanceof HTMLInputElement && SELECT_ALL_TYPES.has(field.type)) || field instanceof HTMLTextAreaElement) {
            field.select();
        }
    }, []);

    useEffect(() => {
        const editor = containerRef.current;
        if (!editor) return;

        const onFocusOut = (e: FocusEvent) => {
            // Focus moving within the editor — the field to a button beside it — is not leaving it.
            if (e.relatedTarget instanceof Node && editor.contains(e.relatedTarget)) return;

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
            className="attribute-value-editor"
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
                } else if (e.key === "Enter" && (typed.labelType !== "textarea" || e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    onCommit();
                }
            }}
        >
            <LabelValueInput
                labelType={typed.labelType}
                value={attribute.value ?? ""}
                onCommit={onEdit}
                commitOn="input"
                numberPrecision={typed.numberPrecision}
                selectOptions={typed.selectOptions}
                inputProps={{
                    className: "form-control",
                    // Names the dropdown's empty entry, as the detail form does for the same field.
                    ...(typed.labelType === "select" && {
                        placeholder: t("promoted_attributes.unset-field-placeholder")
                    })
                }}
            />
        </span>
    );
}

/** The input types whose content `select()` applies to; the pickers select nothing and mind nothing. */
const SELECT_ALL_TYPES = new Set([ "text", "number", "url", "email", "tel" ]);

/**
 * What kind of field the label's value is edited through: for a system label the same closed sets and
 * kinds the detail form offers, exclusions included (a flag means what its presence means, so no
 * checkbox over it); for the rest whatever definition reaches the note for the name, promoted or not,
 * down to the plain text box a label defined by nothing is typed into.
 */
function resolveValueField(note: FNote, name: string): {
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
