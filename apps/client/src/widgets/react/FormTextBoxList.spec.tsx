import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FormTextBoxList from "./FormTextBoxList";

describe("FormTextBoxList", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(props: Parameters<typeof FormTextBoxList>[0]) {
        await act(async () => render(<FormTextBoxList {...props} />, container));
        return container;
    }

    function inputs() {
        return [ ...container.querySelectorAll("input") ];
    }

    async function typeInto(input: HTMLInputElement | undefined, value: string) {
        await act(async () => {
            if (input) {
                input.value = value;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
    }

    const buttonTexts = { addButtonText: "Add", removeButtonText: "Remove" };

    it("seeds a row per value, and a single blank row when there are none", async () => {
        await mount({ initialValues: [ "a", "b" ], onChange: vi.fn(), ...buttonTexts });
        expect(inputs().map((input) => input.value)).toEqual([ "a", "b" ]);

        await act(async () => render(null, container));
        await mount({ initialValues: [], onChange: vi.fn(), ...buttonTexts });
        expect(inputs().map((input) => input.value)).toEqual([ "" ]);
    });

    it("reports only the filled rows, keeping a blank one in place for typing", async () => {
        const onChange = vi.fn();
        await mount({ initialValues: [ "a", "b" ], onChange, ...buttonTexts });

        // Emptying a row keeps it shown but drops it from what the host is told.
        await typeInto(inputs()[0], "");
        expect(onChange).toHaveBeenLastCalledWith([ "b" ]);
        expect(inputs()).toHaveLength(2);

        await typeInto(inputs()[0], "c");
        expect(onChange).toHaveBeenLastCalledWith([ "c", "b" ]);
    });

    it("removes the pressed row, leaving the drafts of the others untouched", async () => {
        const onChange = vi.fn();
        await mount({ initialValues: [ "a", "b", "c" ], onChange, ...buttonTexts });

        // A draft not yet reported (blank) must survive a removal above it.
        await typeInto(inputs()[2], "");
        await act(async () => container.querySelectorAll<HTMLElement>(".form-textbox-list-row .icon-action")[0]?.click());

        expect(onChange).toHaveBeenLastCalledWith([ "b" ]);
        expect(inputs().map((input) => input.value)).toEqual([ "b", "" ]);
    });

    it("adds a blank, focused row without reporting it to the host", async () => {
        const onChange = vi.fn();
        await mount({ initialValues: [ "a" ], onChange, ...buttonTexts });

        await act(async () => container.querySelector<HTMLElement>(".form-textbox-list-add")?.click());

        expect(inputs().map((input) => input.value)).toEqual([ "a", "" ]);
        expect(document.activeElement).toBe(inputs()[1]);
        // Only typing into the new row changes the values, so nothing is reported yet.
        expect(onChange).not.toHaveBeenCalled();
    });

    it("disables the rows and both kinds of button when asked to", async () => {
        await mount({ initialValues: [ "a" ], disabled: true, onChange: vi.fn(), ...buttonTexts });

        expect(inputs()[0]?.disabled).toBe(true);
        expect(container.querySelector<HTMLButtonElement>(".form-textbox-list-add")?.disabled).toBe(true);
        expect(container.querySelector<HTMLButtonElement>(".form-textbox-list-row .icon-action")?.disabled).toBe(true);
    });
});
