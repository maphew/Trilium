import { type LabelType } from "@triliumnext/commons";
import clsx from "clsx";
import { createElement, type HTMLInputTypeAttribute, type InputHTMLAttributes, type MouseEventHandler } from "preact";
import { useRef } from "preact/hooks";

import { t } from "../../services/i18n";

/**
 * The field a label of each type is edited through, shared so that a promoted field and a system
 * attribute of the same type are typed into the same kind of input.
 *
 * `color` is `hidden` because a colour input cannot hold an empty value: the hidden field carries the
 * real one — empty included — while a visible picker sits beside it. See {@link LabelValueInput}.
 */
export const LABEL_MAPPINGS: Record<LabelType, HTMLInputTypeAttribute | undefined> = {
    text: "text",
    textarea: undefined,
    number: "number",
    boolean: "checkbox",
    select: undefined,
    date: "date",
    datetime: "datetime-local",
    time: "time",
    color: "hidden",
    url: "url",
    email: "email",
    phone: "tel"
};

const DEFAULT_COLOR = "#ffffff";

/**
 * The button beside a link-like field, opening what the field holds: a url as a page, an email or a
 * phone number through whatever the platform has registered for its scheme. The title is a thunk so
 * it is translated when rendered, not when the module loads.
 */
const OPEN_BUTTONS: Partial<Record<LabelType, {
    icon: string;
    title: () => string;
    /** Builds the href to open from the bare stored value. */
    toHref: (value: string) => string;
}>> = {
    url: {
        icon: "bx bx-window-open",
        title: () => t("promoted_attributes.open_external_link"),
        toHref: (value) => value
    },
    email: {
        icon: "bx bx-envelope",
        title: () => t("promoted_attributes.send_email"),
        toHref: (value) => applyScheme(value, "mailto:")
    },
    phone: {
        icon: "bx bx-phone",
        title: () => t("promoted_attributes.call_phone"),
        toHref: (value) => applyScheme(value, "tel:")
    }
};

/** A stored value is the bare address; an older one imported as a url may already carry the scheme. */
function applyScheme(value: string, scheme: string) {
    return value.startsWith(scheme) ? value : `${scheme}${value}`;
}

interface LabelValueInputProps {
    labelType: LabelType;
    /** The value as stored, which for a colour or a flag may be the empty string. */
    value: string;
    /** Receives the value to store, a flag already rendered as `"true"` or `"false"`. */
    onCommit(value: string): void;
    /**
     * Whether a change is stored as it is made or once the field is left. The promoted grid commits on
     * blur so that typing does not save on every keystroke; a popup that closes on its own commits as
     * it goes. The colour picker and its clear button always commit at once — there is nothing to type.
     */
    commitOn?: "input" | "blur";
    /** How many decimals a number field steps by, from the definition that declared it. */
    numberPrecision?: number;
    /** The values a select field offers, from the definition that declared it. */
    selectOptions?: string[];
    /** Merged onto the input, for the id, tab order and data attributes a host needs to attach. */
    inputProps?: InputHTMLAttributes<HTMLInputElement> & Record<`data-${string}`, string | undefined>;
}

/**
 * The input for a label value, by the kind of value it holds.
 *
 * Only the field and the buttons belonging to it are rendered — never the surrounding row or the
 * label — so that a host can lay it out as it needs. A flag is the one to watch: it renders a bare
 * checkbox, which a host wanting the label after the box has to arrange itself.
 */
export default function LabelValueInput({
    labelType, value, onCommit, commitOn = "input", numberPrecision, selectOptions, inputProps
}: LabelValueInputProps) {
    const colorInputRef = useRef<HTMLInputElement>(null);
    // What has been typed but not yet committed is still what the field shows, so anything acting on
    // the value as it stands reads the element rather than the prop it was last rendered from.
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(null);

    function commitFromEvent(e: { currentTarget: EventTarget | null }) {
        const input = e.currentTarget as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
        if (!input) return;

        if (input instanceof HTMLInputElement && input.type === "checkbox") {
            onCommit(input.checked ? "true" : "false");
        } else {
            onCommit(input.value);
        }
    }

    const openButton = OPEN_BUTTONS[labelType];

    const extraProps: InputHTMLAttributes<HTMLInputElement> = {};
    if (labelType === "number" && numberPrecision) {
        let step = 1;
        for (let i = 0; i < numberPrecision && i < 10; i++) {
            step /= 10;
        }
        extraProps.step = step;
    } else if (labelType === "url") {
        extraProps.placeholder = t("promoted_attributes.url_placeholder");
    }

    const isSelect = labelType === "select";
    const input = createElement(
        labelType === "textarea" ? "textarea" : isSelect ? "select" : "input",
        {
            ref: inputRef,
            type: LABEL_MAPPINGS[labelType],
            value,
            checked: labelType === "boolean" ? value === "true" : undefined,
            ...extraProps,
            ...inputProps,
            // Bootstrap draws the chevron for `form-select`, which the host — handing the class of a
            // field one types into — has no reason to know to pass.
            ...(isSelect && { className: clsx(inputProps?.className, "form-select") }),
            // After the host's props, so that a host cannot leave the value uncommitted by supplying
            // its own. A select commits as it is picked even for a host that commits on blur: there is
            // nothing to type into it, so waiting for the blur would only hold a made choice back.
            [commitOn === "blur" && !isSelect ? "onBlur" : "onInput"]: commitFromEvent
        },
        isSelect ? selectOptionElements(
            selectOptions ?? [],
            value,
            // Narrowed because Preact types the attribute as possibly signal-backed.
            typeof inputProps?.placeholder === "string" ? inputProps.placeholder : undefined
        ) : undefined
    );

    return (
        <>
            {input}
            {labelType === "color" && (
                <>
                    <input
                        ref={colorInputRef}
                        className={clsx("form-control", inputProps?.className)}
                        type="color"
                        disabled={inputProps?.disabled || inputProps?.readOnly}
                        value={value || DEFAULT_COLOR}
                        onInput={(e) => onCommit(e.currentTarget.value)}
                    />
                    <InputButton
                        icon="bx bxs-tag-x"
                        title={t("promoted_attributes.remove_color")}
                        onClick={() => {
                            // Show the reset, which clearing the stored value alone would not: the
                            // picker falls back to the default only while it has nothing of its own.
                            if (colorInputRef.current) {
                                colorInputRef.current.value = DEFAULT_COLOR;
                            }
                            onCommit("");
                        }}
                    />
                </>
            )}
            {openButton && (
                <InputButton
                    className="open-external-link-button"
                    icon={openButton.icon}
                    title={openButton.title()}
                    onClick={() => {
                        const target = inputRef.current?.value || value;
                        if (target) {
                            window.open(openButton.toHref(target), "_blank");
                        }
                    }}
                />
            )}
        </>
    );
}

/**
 * The choices a select offers: the unset entry first — a promoted field can always be left blank, and
 * it wears the host's placeholder so "not set" reads the same as in a text field — then the defined
 * options, then the stored value if the options no longer name it (renamed or removed since it was
 * picked), so that what the note holds is shown rather than silently blanked.
 */
function selectOptionElements(options: string[], value: string, placeholder?: string) {
    const entries = [ ...options ];
    if (value && !options.includes(value)) {
        entries.push(value);
    }
    return [
        <option key="" value="">{placeholder ?? ""}</option>,
        ...entries.map((option) => <option key={option} value={option}>{option}</option>)
    ];
}

export function InputButton({ icon, className, title, onClick }: {
    icon: string;
    className?: string;
    title: string;
    onClick: MouseEventHandler<HTMLSpanElement>;
}) {
    return (
        <span
            className={clsx("input-group-text", className, icon)}
            title={title}
            onClick={onClick}
        />
    );
}

/**
 * The type to offer for a label whose kind is known ahead of any definition, or `undefined` where the
 * field a host already shows is the better answer.
 *
 * `text` and `textarea` are left out because they gain nothing over a plain box — and a host offering
 * suggestions over the values a name has held would lose them. `boolean` is left out because a system
 * flag says what it means by being present at all: a checkbox over its value would read `#archived`
 * with no value as switched off, which is the opposite of what it means.
 */
export function getTypedInputForLabel(labelType: LabelType | undefined): LabelType | undefined {
    if (!labelType || labelType === "text" || labelType === "textarea" || labelType === "boolean") {
        return undefined;
    }

    return labelType;
}
