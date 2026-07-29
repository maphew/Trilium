import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBuiltinLabelValueType } from "../../services/attributes";
import LabelValueInput, { getTypedInputForLabel, LABEL_MAPPINGS } from "./label_value_input";

describe("getTypedInputForLabel", () => {
    it("offers a field of its own only where one beats the box a host already shows", () => {
        for (const labelType of [ "color", "date", "datetime", "time", "number", "url", "email", "phone" ] as const) {
            expect(getTypedInputForLabel(labelType)).toBe(labelType);
        }

        // Text keeps whatever the host offers, which may suggest values the name has held before.
        expect(getTypedInputForLabel("text")).toBeUndefined();
        expect(getTypedInputForLabel("textarea")).toBeUndefined();
        // A flag means what it means by being present, so a checkbox over its value would mislead.
        expect(getTypedInputForLabel("boolean")).toBeUndefined();
        // A name Trilium attaches no meaning to has no type to go on.
        expect(getTypedInputForLabel(undefined)).toBeUndefined();
    });

    it("types the system labels the attribute editor is opened on", () => {
        expect(getTypedInputForLabel(getBuiltinLabelValueType("color"))).toBe("color");
        expect(getTypedInputForLabel(getBuiltinLabelValueType("workspaceTabBackgroundColor"))).toBe("color");
        expect(getTypedInputForLabel(getBuiltinLabelValueType("startDate"))).toBe("date");
        expect(getTypedInputForLabel(getBuiltinLabelValueType("startTime"))).toBe("time");
        expect(getTypedInputForLabel(getBuiltinLabelValueType("docUrl"))).toBe("url");
        expect(getTypedInputForLabel(getBuiltinLabelValueType("pageSize"))).toBe("number");

        // `#calendar:startDate` names the label a date is read from, so it is a name, not a date.
        expect(getTypedInputForLabel(getBuiltinLabelValueType("calendar:startDate"))).toBeUndefined();
        // A label the user invented keeps the field it has always had.
        expect(getTypedInputForLabel(getBuiltinLabelValueType("myOwnLabel"))).toBeUndefined();
    });
});

describe("LabelValueInput", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(props: Parameters<typeof LabelValueInput>[0]) {
        await act(async () => render(<LabelValueInput {...props} />, container));
        return container;
    }

    it("edits a colour through a picker while the stored value stays clearable", async () => {
        const onCommit = vi.fn();
        // A colour input cannot represent "no colour": bound to the value directly it would report
        // black for an unset label, and offer no way back to unset.
        await mount({ labelType: "color", value: "", onCommit });

        const stored = container.querySelector<HTMLInputElement>("input[type=hidden]");
        const picker = container.querySelector<HTMLInputElement>("input[type=color]");
        expect(stored?.value).toBe("");
        expect(picker?.value).toBe("#ffffff");

        await act(async () => {
            if (picker) {
                picker.value = "#ff0000";
                picker.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        expect(onCommit).toHaveBeenCalledWith("#ff0000");

        const clear = container.querySelector<HTMLElement>(".input-group-text");
        await act(async () => clear?.click());
        expect(onCommit).toHaveBeenLastCalledWith("");
    });

    it("reports a flag as the words a label stores rather than as a checked box", async () => {
        const onCommit = vi.fn();
        await mount({ labelType: "boolean", value: "false", onCommit });

        const checkbox = container.querySelector<HTMLInputElement>("input[type=checkbox]");
        expect(checkbox?.checked).toBe(false);

        await act(async () => {
            if (checkbox) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        expect(onCommit).toHaveBeenCalledWith("true");
    });

    it("holds a change back until the field is left when asked to", async () => {
        const onCommit = vi.fn();
        await mount({ labelType: "text", value: "before", onCommit, commitOn: "blur" });

        const input = container.querySelector<HTMLInputElement>("input");
        await act(async () => {
            if (input) {
                input.value = "after";
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        expect(onCommit).not.toHaveBeenCalled();

        // `focusout`, the bubbling event a browser fires alongside `blur`, is what the input listens
        // for — both by its own binding and under preact/compat's `onBlur` remap.
        await act(async () => {
            input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        expect(onCommit).toHaveBeenCalledWith("after");
    });

    it("steps a number by the precision its definition declared", async () => {
        await mount({ labelType: "number", value: "1", onCommit: vi.fn(), numberPrecision: 2 });

        expect(container.querySelector("input")?.getAttribute("step")).toBe("0.01");
    });

    it("offers a select's options after the unset entry, keeping a stored value the options lost", async () => {
        const onCommit = vi.fn();
        await mount({
            labelType: "select",
            // A value the definition no longer names (its option renamed or removed) must stay shown.
            value: "Archived",
            selectOptions: [ "Todo", "Done" ],
            onCommit,
            commitOn: "blur",
            inputProps: { placeholder: "not set" }
        });

        const select = container.querySelector("select");
        expect([ ...(select?.options ?? []) ].map((option) => option.value))
            .toEqual([ "", "Todo", "Done", "Archived" ]);
        // The unset entry wears the host's placeholder, and the field dresses as a select.
        expect(select?.options[0]?.text).toBe("not set");
        expect(select?.value).toBe("Archived");
        expect(select?.className).toContain("form-select");

        // Picking commits at once even though the host asked for a blur commit.
        await act(async () => {
            if (select) {
                select.value = "Done";
                select.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
        expect(onCommit).toHaveBeenCalledWith("Done");
    });

    describe("creatable select combobox", () => {
        /** Lets the debounced suggestion fetch run; the dropdown is portaled to the body. */
        async function settleDropdown() {
            await act(async () => {
                await new Promise((resolve) => setTimeout(resolve, 200));
            });
            return [ ...document.querySelectorAll(".form-autocomplete-dropdown li") ];
        }

        async function typeInto(input: HTMLInputElement | null, value: string) {
            await act(async () => {
                if (input) {
                    input.value = value;
                    input.dispatchEvent(new Event("input", { bubbles: true }));
                }
            });
        }

        it("lists every option on focus, and commits a pick, not the typing before it", async () => {
            const onCommit = vi.fn();
            await mount({
                labelType: "select", value: "Todo", selectOptions: [ "Todo", "Done" ],
                onCommit, onCreateOption: vi.fn()
            });

            // A combobox rather than a fixed dropdown.
            expect(container.querySelector("select")).toBeNull();
            const input = container.querySelector("input");
            expect(input?.value).toBe("Todo");

            // The box still holds the stored value, so the whole list is offered, unfiltered.
            await act(async () => input?.focus());
            expect((await settleDropdown()).map((item) => item.textContent)).toEqual([ "Todo", "Done" ]);

            await typeInto(input, "Do");
            expect(onCommit).not.toHaveBeenCalled();

            // "Do" matches both options as a substring, plus the entry offering to create it.
            const items = await settleDropdown();
            const done = items.find((item) => item.textContent === "Done");
            await act(async () => (done as HTMLElement | undefined)?.click());
            expect(onCommit).toHaveBeenCalledWith("Done");
        });

        it("offers creating unmatched text as an explicit entry, never committing it on its own", async () => {
            const onCommit = vi.fn();
            const onCreateOption = vi.fn();
            await mount({
                labelType: "select", value: "", selectOptions: [ "Todo", "Done" ],
                onCommit, onCreateOption
            });

            const input = container.querySelector("input");
            await act(async () => input?.focus());
            await typeInto(input, "Blocked");

            // Nothing matches, so the create entry is the only row. Recognized by its class rather
            // than its label: `t()` renders empty under the test environment's uninitialized i18n.
            const items = await settleDropdown();
            expect(items).toHaveLength(1);
            expect(items[0]?.querySelector(".label-select-create-option")).not.toBeNull();

            await act(async () => (items[0] as HTMLElement | undefined)?.click());
            expect(onCreateOption).toHaveBeenCalledWith("Blocked");
            expect(onCommit).toHaveBeenCalledWith("Blocked");
        });

        it("reverts unpicked text on blur, while an emptied box commits the unset value", async () => {
            const onCommit = vi.fn();
            await mount({
                labelType: "select", value: "Todo", selectOptions: [ "Todo", "Done" ],
                onCommit, onCreateOption: vi.fn()
            });

            const input = container.querySelector("input");
            await typeInto(input, "Blo");
            await act(async () => {
                input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            });
            expect(onCommit).not.toHaveBeenCalled();
            expect(input?.value).toBe("Todo");

            await typeInto(input, "");
            await act(async () => {
                input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
            });
            expect(onCommit).toHaveBeenCalledWith("");
        });
    });

    it("opens an email or a phone through its scheme, not doubling one an old value carries", async () => {
        const open = vi.spyOn(window, "open").mockImplementation(() => null);
        try {
            await mount({ labelType: "email", value: "contact@acme.com", onCommit: vi.fn() });
            expect(container.querySelector("input")?.type).toBe("email");
            await act(async () => container.querySelector<HTMLElement>(".open-external-link-button")?.click());
            expect(open).toHaveBeenLastCalledWith("mailto:contact@acme.com", "_blank");

            // A value imported as a url label before the typed field existed already carries its scheme.
            await mount({ labelType: "phone", value: "tel:12345", onCommit: vi.fn() });
            expect(container.querySelector("input")?.type).toBe("tel");
            await act(async () => container.querySelector<HTMLElement>(".open-external-link-button")?.click());
            expect(open).toHaveBeenLastCalledWith("tel:12345", "_blank");
        } finally {
            open.mockRestore();
        }
    });

    it("maps every label type to a field, colour included", () => {
        // Guards the mapping against a type being added to the vocabulary without a field to edit it.
        expect(Object.keys(LABEL_MAPPINGS).length).toBeGreaterThan(0);
        expect(LABEL_MAPPINGS.color).toBe("hidden");
        expect(LABEL_MAPPINGS.textarea).toBeUndefined();
    });
});
