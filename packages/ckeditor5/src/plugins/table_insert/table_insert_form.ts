import {
    ButtonView,
    FocusCycler,
    FocusTracker,
    InputNumberView,
    KeystrokeHandler,
    LabelView,
    submitHandler,
    uid,
    View,
    ViewCollection
} from "ckeditor5";
import type { FocusableView, Locale } from "ckeditor5";

/** The largest number of rows the form accepts. */
export const MAX_TABLE_ROWS = 1000;

/** The largest number of columns the form accepts. */
export const MAX_TABLE_COLUMNS = 100;

/** The number of rows and columns the form shows when it opens. */
export const DEFAULT_TABLE_SIZE = 2;

export interface TableSize {
    rows: number;
    columns: number;
}

/**
 * The balloon form behind "Insert table…": a "Rows" field, a "Columns" field and an Insert button.
 * Invalid values are reported under their field when the form is submitted.
 */
export default class TableInsertFormView extends View {

    public readonly rowsField: TableSizeFieldView;
    public readonly columnsField: TableSizeFieldView;
    public readonly insertButtonView: ButtonView;

    public readonly focusTracker = new FocusTracker();
    public readonly keystrokes = new KeystrokeHandler();

    private readonly focusables = new ViewCollection<FocusableView>();
    private readonly focusCycler: FocusCycler;

    constructor(locale: Locale) {
        super(locale);
        const t = locale.t;

        this.rowsField = new TableSizeFieldView(locale, t("Rows"), MAX_TABLE_ROWS);
        this.columnsField = new TableSizeFieldView(locale, t("Columns"), MAX_TABLE_COLUMNS);

        this.insertButtonView = new ButtonView(locale);
        this.insertButtonView.set({
            label: t("Insert"),
            withText: true,
            type: "submit",
            class: "ck-button-action ck-button-bold"
        });

        this.setTemplate({
            tag: "form",
            attributes: {
                class: ["ck", "ck-table-insert-form"],
                tabindex: "-1",
                "aria-label": t("Insert table"),
                // The fields are checked by `validate()`, which shows translated errors.
                novalidate: true
            },
            children: [this.rowsField, this.columnsField, this.insertButtonView]
        });

        this.focusCycler = new FocusCycler({
            focusables: this.focusables,
            focusTracker: this.focusTracker,
            keystrokeHandler: this.keystrokes,
            actions: {
                focusPrevious: "shift + tab",
                focusNext: "tab"
            }
        });
    }

    public override render(): void {
        super.render();

        // Turns a native form submit, the Enter key included, into the view's `submit` event.
        submitHandler({ view: this });

        const { rowsField, columnsField, insertButtonView } = this;
        for (const view of [rowsField.inputView, columnsField.inputView, insertButtonView]) {
            this.focusables.add(view);
            /* v8 ignore next -- a child view rendered as part of this template has an element */
            if (view.element) {
                this.focusTracker.add(view.element);
            }
        }

        /* v8 ignore next -- super.render() has just built this view's element */
        if (this.element) {
            this.keystrokes.listenTo(this.element);
        }
    }

    public override destroy(): void {
        super.destroy();
        this.focusTracker.destroy();
        this.keystrokes.destroy();
    }

    /** Focuses the "Rows" field and selects its value. */
    public focus(): void {
        this.focusCycler.focusFirst();
        this.rowsField.inputView.select();
    }

    /** Sets both fields to {@link DEFAULT_TABLE_SIZE} and clears their errors. */
    public reset(): void {
        this.rowsField.reset(DEFAULT_TABLE_SIZE);
        this.columnsField.reset(DEFAULT_TABLE_SIZE);
    }

    /**
     * Returns the entered size, or `null` when a field is invalid. Every invalid field shows its
     * error, and the first one is focused.
     */
    public validate(): TableSize | null {
        const rows = this.rowsField.validate();
        const columns = this.columnsField.validate();

        if (rows === null) {
            this.rowsField.focus();
            return null;
        }
        if (columns === null) {
            this.columnsField.focus();
            return null;
        }
        return { rows, columns };
    }
}

/**
 * A number field of {@link TableInsertFormView}: a label, the input and the error under it.
 * The element has `display: contents`, so the three parts are laid out by the form's grid.
 */
export class TableSizeFieldView extends View {

    /** The error shown under the input, or `null` when the value is valid. */
    declare public errorText: string | null;

    public readonly labelView: LabelView;
    public readonly inputView: InputNumberView;

    private readonly max: number;
    private readonly invalidText: string;

    constructor(locale: Locale, label: string, max: number) {
        super(locale);

        const inputId = `ck-table-insert-form-input-${uid()}`;
        const errorId = `ck-table-insert-form-error-${uid()}`;
        const bind = this.bindTemplate;

        this.max = max;
        this.invalidText = locale.t("Enter a whole number between 1 and %0.", max);
        this.set("errorText", null);

        this.labelView = new LabelView(locale);
        this.labelView.set({ text: label, for: inputId });

        this.inputView = new InputNumberView(locale, { min: 1, max, step: 1 });
        this.inputView.set({ id: inputId, inputMode: "numeric" });
        this.inputView.bind("hasError").to(this, "errorText", (text) => !!text);
        this.inputView.bind("ariaDescribedById")
            .to(this, "errorText", (text) => text ? errorId : undefined);

        // The error is cleared as soon as the value is edited.
        this.inputView.on("input", () => {
            this.errorText = null;
        });

        this.setTemplate({
            tag: "div",
            attributes: {
                class: ["ck", "ck-table-insert-form__field"]
            },
            children: [
                this.labelView,
                this.inputView,
                {
                    tag: "div",
                    attributes: {
                        id: errorId,
                        class: [
                            "ck",
                            "ck-table-insert-form__error",
                            bind.if("errorText", "ck-hidden", (text) => !text)
                        ],
                        role: bind.if("errorText", "alert")
                    },
                    children: [{ text: bind.to("errorText") }]
                }
            ]
        });
    }

    /** Focuses the input and selects its value. */
    public focus(): void {
        this.inputView.focus();
        this.inputView.select();
    }

    /** Shows `value` in the input and clears the error. */
    public reset(value: number): void {
        const text = String(value);

        this.errorText = null;
        // `value` reaches the DOM only when it changes, so an edited input is written directly.
        this.inputView.value = text;
        /* v8 ignore next -- the form renders its fields before it can be shown */
        if (this.inputView.element) {
            this.inputView.element.value = text;
        }
    }

    /** Returns the entered number, or `null` after showing the error. */
    public validate(): number | null {
        /* v8 ignore next -- the form renders its fields before it can be submitted */
        const value = parseTableSize(this.inputView.element?.value ?? "", this.max);

        this.errorText = value === null ? this.invalidText : null;
        return value;
    }
}

/** Parses `value` as a whole number from 1 to `max`. Returns `null` for anything else. */
export function parseTableSize(value: string, max: number): number | null {
    const text = value.trim();
    if (!/^\d+$/.test(text)) {
        return null;
    }

    const size = Number(text);
    return size >= 1 && size <= max ? size : null;
}
