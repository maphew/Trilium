import clsx from "clsx";

import Button, { ButtonGroup } from "./Button";

interface SegmentedChoiceOption<T extends string> {
    value: T;
    /** Left out where the option is shown as an icon alone, which then wants a {@link title}. */
    label?: string;
    /** An icon class without its `bx` prefix, e.g. `bx-square`. */
    icon?: string;
    /** What the option is called, for an option that shows as an icon alone. */
    title?: string;
}

interface SegmentedChoiceProps<T extends string> {
    options: SegmentedChoiceOption<T>[];
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
            {options.map(({ value, label, icon, title }) => (
                <Button
                    key={value}
                    text={label ?? ""}
                    icon={icon}
                    title={title}
                    size="small"
                    className={clsx(currentValue === value && "active")}
                    onClick={() => onChange(value)}
                />
            ))}
        </ButtonGroup>
    );
}
