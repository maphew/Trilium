import "./values_input.css";

import { type LabelType } from "@triliumnext/commons";
import type { ComponentChildren, TargetedKeyboardEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import Chip from "../react/Chip";
import FormTextBox from "../react/FormTextBox";
import { DEFAULT_COLOR, LABEL_MAPPINGS } from "./label_value_input";

interface ValuesInputProps {
    /** What kind of value is being entered, deciding the box the next one is typed into. */
    labelType: LabelType;
    /** The values held, in the order they are shown. */
    values: readonly string[];
    /** Receives the values as they now stand, whenever one is taken or dropped. */
    onCommit(values: string[]): void;
    /**
     * Shows a value as something other than the text it is stored as — a colour as its swatch. Left
     * out, a chip reads as what is stored, which for most types is what is being edited anyway.
     */
    renderValue?(value: string): ComponentChildren;
    placeholder?: string;
    disabled?: boolean;
}

/**
 * The field a free-form label holding several values is edited through: the values as chips, and a
 * box after them for the next one.
 *
 * Where a select picks from a closed set, here what is typed *is* the value — so the box hands it
 * over on Enter, and again when the field is left, so that a value typed and then abandoned is kept
 * rather than quietly dropped. A value already held is not taken a second time: the chips are a set,
 * and two alike could not be told apart.
 */
export default function ValuesInput({ labelType, values, onCommit, renderValue, placeholder, disabled }: ValuesInputProps) {
    const [ draft, setDraft ] = useState("");
    const pickerRef = useRef<HTMLInputElement>(null);
    // A colour is picked rather than typed, so there is no Enter to end it and nothing worth keeping
    // half-entered: the pick itself is the whole gesture, and `change` is when it is settled.
    const isPicked = labelType === "color";

    // The picker holds its own value and is never told one: it is set at birth and only read from
    // after that. Anything written into it can reach a dialog that is still open — a colour input
    // reports its pick before the dialog is dismissed — and the browser takes its value changing
    // underneath as reason to close, dropping the pick. So it keeps showing the colour last taken,
    // which is also the truer thing for it to show.
    useEffect(() => {
        if (pickerRef.current) {
            pickerRef.current.value = DEFAULT_COLOR;
        }
    }, []);

    useEffect(() => {
        const picker = pickerRef.current;
        if (!picker) return;

        // Bound by hand rather than through the JSX: preact/compat — loaded module-graph-wide by any
        // compat-using import — remaps `onChange` onto the input event, which a colour picker fires
        // at every step of a drag through it, taking a chip for each shade passed over.
        const onPicked = () => take(picker.value);
        picker.addEventListener("change", onPicked);
        return () => picker.removeEventListener("change", onPicked);
    });

    function take(value: string) {
        const trimmed = value.trim();
        setDraft("");
        if (!trimmed || values.includes(trimmed)) return;
        onCommit([ ...values, trimmed ]);
    }

    function drop(value: string) {
        onCommit(values.filter((held) => held !== value));
    }

    function handleKeyDown(e: TargetedKeyboardEvent<HTMLInputElement>) {
        if (e.key === "Enter") {
            // Consumed, so that it does not also reach whatever the field sits in — a table cell
            // takes Enter as "done here", which would end the edit at the first value.
            e.preventDefault();
            e.stopPropagation();
            take(e.currentTarget.value);
        } else if (e.key === "Backspace" && !e.currentTarget.value && values.length) {
            // Backspace on an empty box drops the last chip, the box having nothing of its own to
            // erase. With something typed it is the box's own, as anywhere else.
            e.preventDefault();
            drop(values[values.length - 1]);
        }
    }

    return (
        <div className="tn-chips-field values-input">
            {values.map((value) => (
                <Chip
                    key={value}
                    removeButtonText={t("promoted_attributes.remove_value")}
                    disabled={disabled}
                    onRemove={() => drop(value)}
                >
                    <span>{renderValue ? renderValue(value) : value}</span>
                </Chip>
            ))}
            {isPicked ? (
                <input
                    ref={pickerRef}
                    className="form-control"
                    type="color"
                    disabled={disabled}
                />
            ) : (
                <FormTextBox
                    type={LABEL_MAPPINGS[labelType] ?? "text"}
                    currentValue={draft}
                    // Only while the field is empty: beside chips it would read as one of them.
                    placeholder={values.length ? undefined : placeholder}
                    disabled={disabled}
                    onChange={setDraft}
                    onBlur={take}
                    onKeyDown={handleKeyDown}
                />
            )}
        </div>
    );
}
