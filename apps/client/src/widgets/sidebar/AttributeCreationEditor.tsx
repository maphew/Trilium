import "./AttributeCreationEditor.css";

import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";

import type FNote from "../../entities/fnote";
import type { Attribute } from "../../services/attribute_parser";
import { t } from "../../services/i18n";
import utils from "../../services/utils";
import { AttributeNameSuggestion, fetchAttributeNames } from "../attribute_widgets/attribute_detail";
import LabelValueInput from "../attribute_widgets/label_value_input";
import FormAutocomplete from "../react/FormAutocomplete";
import NoteAutocomplete from "../react/NoteAutocomplete";
import AttributeEditorOverlay from "./AttributeEditorOverlay";
import { resolveValueField, TARGET_NOTE_OPTS } from "./AttributeValueEditor";

interface AttributeCreationEditorProps {
    /** The note the attribute is created on, read for the definition that types the value field. */
    note: FNote;
    /** The draft the host appended to its rows; the name and value are written into it as typed. */
    attribute: Attribute;
    /** Close keeping the draft — which the host saves, or discards if it was never given a name. */
    onCommit(): void;
    /** Close un-creating the draft. */
    onRevert(): void;
}

/**
 * A label or relation created in a row of its own, without opening the detail form: the two things a
 * plain attribute is made of side by side — the name, completed from the names already in use, and
 * the value the name calls for (see {@link resolveValueField}) or the note search a relation's target
 * is picked in. Everything else the form collects — inheritability, a definition's settings — is
 * rare enough to stay with the form, reachable from the row once it exists.
 *
 * Stands on the {@link AttributeEditorOverlay} shell: leaving keeps the draft, escape drops it. In
 * the name box, enter walks on to the value field once the completion has had its say.
 */
export default function AttributeCreationEditor({ note, attribute, onCommit, onRevert }: AttributeCreationEditorProps) {
    const containerRef = useRef<HTMLSpanElement>(null);
    const nameRef = useRef<HTMLInputElement>(null);
    const isRelation = attribute.type === "relation";
    const nameType = isRelation ? "relation" : "label";
    // The one field state here: the value lives in the draft alone, but the name is what the value
    // field's kind hangs off, so typing it has to re-render.
    const [ name, setName ] = useState(attribute.name);
    // Committing mid-composition would filter the characters being composed out from under the IME;
    // the same guard the detail form keeps (https://github.com/zadam/trilium/pull/3812).
    const isComposing = useRef(false);

    const suggestNames = useCallback((query: string) => fetchAttributeNames(nameType, query), [ nameType ]);
    const renderNameSuggestion = useCallback(
        (suggestion: string) => <AttributeNameSuggestion type={nameType} name={suggestion} />, [ nameType ]);

    // What the name as it stands would be typed as, so a name with a definition behind it gets its
    // field the moment the name settles — type `due`, and the value side becomes its date picker.
    const typed = useMemo(
        () => isRelation ? undefined : resolveValueField(note, name),
        [ isRelation, note, name ]);

    useEffect(() => nameRef.current?.focus(), []);

    function commitName(newName: string) {
        // Invalid characters are simply ignored, as the detail form ignores them.
        const filtered = utils.filterAttributeName(newName);
        setName(filtered);
        attribute.name = filtered;
    }

    /** Enter in the name box walks on to the value field, the completion having had its say first. */
    function focusValueField() {
        containerRef.current
            ?.querySelector<HTMLElement>(".attribute-creation-value input:not([type=hidden]), .attribute-creation-value textarea, .attribute-creation-value select")
            ?.focus();
    }

    return (
        <AttributeEditorOverlay
            overlayRef={containerRef}
            className="attribute-creation-editor"
            onCommit={onCommit}
            onRevert={onRevert}
            onKeyDown={(e) => {
                if (e.key !== "Enter") return;

                if (e.target instanceof Element && e.target.closest(".attribute-creation-name")) {
                    e.preventDefault();
                    e.stopPropagation();
                    focusValueField();
                // Enter is the note search's own key — it is what picks — so only a label's value
                // commits on it; a textarea keeps it for its newlines unless held with the modifier.
                } else if (typed && (typed.labelType !== "textarea" || e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    onCommit();
                }
            }}
        >
            <span className="attribute-creation-name">
                <FormAutocomplete
                    inputRef={nameRef}
                    currentValue={name}
                    placeholder={t("attribute_detail.name")}
                    source={suggestNames}
                    renderItem={renderNameSuggestion}
                    openOnFocus
                    onChange={(newName) => isComposing.current ? setName(newName) : commitName(newName)}
                    onCompositionStart={() => isComposing.current = true}
                    onCompositionEnd={(e) => {
                        isComposing.current = false;
                        commitName(e.currentTarget.value);
                    }}
                />
            </span>
            <span className="attribute-creation-value">
                {isRelation ? (
                    <NoteAutocomplete
                        noteId={attribute.value || undefined}
                        opts={TARGET_NOTE_OPTS}
                        noteIdChanged={(noteId) => {
                            attribute.value = noteId ?? "";
                        }}
                    />
                ) : typed && (
                    <LabelValueInput
                        // Remounted when the name resolves to another kind of field, reseeded from
                        // whatever the draft holds by then.
                        labelType={typed.labelType}
                        value={attribute.value ?? ""}
                        onCommit={(value) => {
                            attribute.value = value;
                        }}
                        commitOn="input"
                        numberPrecision={typed.numberPrecision}
                        selectOptions={typed.selectOptions}
                        hideOpenButton
                        inputProps={{
                            className: "form-control",
                            ...(typed.labelType === "select" && {
                                placeholder: t("promoted_attributes.unset-field-placeholder")
                            })
                        }}
                    />
                )}
            </span>
        </AttributeEditorOverlay>
    );
}
