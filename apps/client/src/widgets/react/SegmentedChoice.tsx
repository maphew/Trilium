import clsx from "clsx";

import Button, { ButtonGroup } from "./Button";

interface SegmentedChoiceProps<T extends string> {
    options: { value: T, label: string }[];
    /**
     * Kept a plain string rather than {@link T}: callers routinely hold the value as a raw option
     * string, and a value outside the options simply highlights nothing.
     */
    currentValue: string;
    onChange: (newValue: T) => void;
    className?: string;
}

/**
 * A row of buttons acting as one exclusive choice, the current one highlighted — for switching
 * between a few named views or sections where a dropdown would hide the alternatives.
 */
export default function SegmentedChoice<T extends string>({ options, currentValue, onChange, className }: SegmentedChoiceProps<T>) {
    return (
        <ButtonGroup size="sm" className={className}>
            {options.map(({ value, label }) => (
                <Button
                    key={value}
                    text={label}
                    size="small"
                    className={clsx(currentValue === value && "active")}
                    onClick={() => onChange(value)}
                />
            ))}
        </ButtonGroup>
    );
}
