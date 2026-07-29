import "./FormTextBoxList.css";

import { useEffect, useRef, useState } from "preact/hooks";

import ActionButton from "./ActionButton.jsx";
import Button from "./Button.jsx";
import FormTextBox from "./FormTextBox.jsx";

interface FormTextBoxListProps {
    /**
     * Seeds the rows. The list keeps its own draft afterwards and does not resync — a host whose
     * values can change identity under the editor remounts it (e.g. with a `key`) to reseed.
     */
    initialValues: string[];
    disabled?: boolean;
    /** Receives the filled rows, in order, whenever any row changes. Blank rows are not included. */
    onChange: (values: string[]) => void;
    /** What the add button offers, in the host's own words (e.g. "Add option"). */
    addButtonText: string;
    /** What removing a row means, in the host's own words (e.g. "Remove this option"). */
    removeButtonText: string;
}

/**
 * An ordered list of short texts, edited as one box per entry with a remove button and a button
 * adding a fresh row. The rows are a draft of the values — a row just added or emptied stays put
 * for typing while only the filled rows are reported — so a blank row never reaches the host.
 */
export default function FormTextBoxList({ initialValues, disabled, onChange, addButtonText, removeButtonText }: FormTextBoxListProps) {
    // Ids of their own, so removing a row does not remount — and wipe the drafts of — those after it.
    const nextRowId = useRef(initialValues.length);
    const [ rows, setRows ] = useState(() => {
        const initial = initialValues.map((value, id) => ({ id, value }));
        // An empty list starts with one blank row, so the box to type the first value into is
        // already there rather than behind the add button.
        return initial.length ? initial : [ { id: nextRowId.current++, value: "" } ];
    });
    const containerRef = useRef<HTMLDivElement>(null);
    // Focus lands in the row the add button just created, once it exists.
    const pendingFocus = useRef(false);

    useEffect(() => {
        if (!pendingFocus.current) return;
        pendingFocus.current = false;
        const inputs = containerRef.current?.querySelectorAll("input");
        inputs?.[inputs.length - 1]?.focus();
    });

    function commitRows(newRows: { id: number; value: string }[]) {
        setRows(newRows);
        onChange(newRows.map((row) => row.value).filter((value) => value.trim() !== ""));
    }

    return (
        <div ref={containerRef} className="form-textbox-list">
            {rows.map((row) => (
                <div key={row.id} className="form-textbox-list-row">
                    <FormTextBox
                        currentValue={row.value}
                        disabled={disabled}
                        onChange={(value) => commitRows(
                            rows.map((other) => other.id === row.id ? { ...other, value } : other))}
                    />
                    <ActionButton
                        icon="bx bx-x"
                        text={removeButtonText}
                        disabled={disabled}
                        onClick={() => commitRows(rows.filter((other) => other.id !== row.id))}
                    />
                </div>
            ))}
            <Button
                className="form-textbox-list-add"
                size="small"
                icon="bx bx-plus"
                text={addButtonText}
                disabled={disabled}
                onClick={() => {
                    pendingFocus.current = true;
                    setRows([ ...rows, { id: nextRowId.current++, value: "" } ]);
                }}
            />
        </div>
    );
}
