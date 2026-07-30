import "./values_input.css";

import { type LabelType } from "@triliumnext/commons";
import clsx from "clsx";
import type { ComponentChildren, TargetedKeyboardEvent } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import ActionButton from "../react/ActionButton";
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
    /** What removing a chip means, in the host's own words. Left out, a chip holds "a value". */
    removeButtonText?: string;
    /** What taking the box's content means, in the host's own words. Left out, it adds "a value". */
    addButtonText?: string;
    /** Set onto the box, so that a host's own label points at the field. */
    inputId?: string;
    /** Set onto the box, for a host placing its fields in a tab order of its own. */
    tabIndex?: number;
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
export default function ValuesInput({ labelType, values, onCommit, renderValue, removeButtonText, addButtonText, inputId, tabIndex, placeholder, disabled }: ValuesInputProps) {
    const [ draft, setDraft ] = useState("");
    const inputRef = useRef<HTMLInputElement>(null);
    const isColor = labelType === "color";
    // Every widget but the colour dialog has to be asked for its value, having no plain way of
    // saying it is done with.
    const needsAsking = PICKED_TYPES.has(labelType) && !isColor;
    // A typed box is settled by Enter, but nothing on the page says so — so once it holds something
    // to take, the same button offers the confirming where it can be seen. Not before: empty, it
    // would have nothing to add, and sit there asking to be explained.
    const showAdd = needsAsking || (!isColor && draft.trim().length > 0);

    // A colour picker holds its own value and is never told one: it is set at birth and only read
    // from after that. Anything written into it can reach a dialog that is still open — it reports
    // its pick before the dialog is dismissed — and the browser takes its value changing underneath
    // as reason to close, dropping the pick. So it keeps showing the colour last taken, which is
    // also the truer thing for it to show.
    useEffect(() => {
        if (isColor && inputRef.current) {
            inputRef.current.value = DEFAULT_COLOR;
        }
    }, [ isColor ]);

    useEffect(() => {
        const picker = inputRef.current;
        if (!isColor || !picker) return;

        // A colour is settled in one gesture — a dialog opened, a colour chosen, the dialog gone —
        // so its `change` marks the end of the whole thing and can be taken as the value.
        //
        // No other widget reports so plainly. A date and a time report a change per part of them,
        // so a wheel spun through the minutes says "settled" at every minute passed; those are taken
        // by asking instead, through Enter or the button beside the field.
        //
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
        // A widget of the browser's own asks for the width of a calendar or a clock, which leaves a
        // chip beside it too little to be read — so where the field is one of those, the chips stack
        // above it instead of sharing its line.
        <div className={clsx("tn-field values-input", PICKED_TYPES.has(labelType) && "stacked")}>
            {values.map((value) => (
                <Chip
                    key={value}
                    removeButtonText={removeButtonText ?? t("promoted_attributes.remove_value")}
                    disabled={disabled}
                    onRemove={() => drop(value)}
                >
                    <span>{renderValue ? renderValue(value) : value}</span>
                </Chip>
            ))}
            {/* The box and the button that asks for what it holds are one thing on the page, so where
                the values are stacked they are wrapped as one — the alternative, laying the button
                over the field, puts it on whatever the widget's own width happens to reach.

                Keyed, as the chips before them are: a field of keyed and unkeyed siblings together is
                matched up by position as it grows, so taking a second value would rebuild the box
                rather than keep it — losing the focus in it, and with it the widget it had open. */}
            <Entry stacked={PICKED_TYPES.has(labelType)}>
            {isColor ? (
                <input
                    key="field"
                    ref={inputRef}
                    id={inputId}
                    tabIndex={tabIndex}
                    className="form-control"
                    type="color"
                    disabled={disabled}
                />
            ) : (
                <FormTextBox
                    key="field"
                    inputRef={inputRef}
                    id={inputId}
                    tabIndex={tabIndex}
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

            {/* A widget says nothing useful about when it is done — a date reports a change per part
                of it — so a field entered through one is asked rather than watched. Enter does as
                much for the keyboard; this is the same thing where it can be seen. */}
            {showAdd && (
                <ActionButton
                    key="add"
                    className="values-input-add"
                    icon="bx bx-plus"
                    text={addButtonText ?? t("promoted_attributes.add_value")}
                    disabled={disabled}
                    // The value is read from the field rather than from the draft: leaving the field
                    // to press this takes it already, and the draft is empty by the time this runs.
                    // For a typed box that leaving is also the whole of the press — the take empties
                    // the box and the button goes with it, before the click lands on anything.
                    onClick={() => take(inputRef.current?.value ?? "")}
                />
            )}
            </Entry>
        </div>
    );
}

/**
 * The types entered through a widget the browser brings — a calendar, a clock, a colour dialog —
 * rather than by typing into a box.
 */
const PICKED_TYPES = new Set<LabelType>([ "color", "date", "datetime", "time" ]);

/**
 * The box and the button beside it, held together where the values above them are stacked a line
 * each — a column would otherwise put the button on a line of its own. Where they share the line with
 * the values there is nothing to hold: they are already side by side.
 */
function Entry({ stacked, children }: { stacked: boolean; children: ComponentChildren }) {
    return stacked ? <div className="values-input-entry">{children}</div> : <>{children}</>;
}
