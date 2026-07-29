import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ValuesInput from "./values_input";

describe("ValuesInput", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    async function mount(props: Parameters<typeof ValuesInput>[0]) {
        await act(async () => render(<ValuesInput {...props} />, container));
        return container.querySelector("input");
    }

    async function typeInto(input: HTMLInputElement | null, value: string) {
        await act(async () => {
            if (input) {
                input.value = value;
                input.dispatchEvent(new Event("input", { bubbles: true }));
            }
        });
    }

    async function press(input: HTMLInputElement | null, key: string) {
        await act(async () => {
            input?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
        });
    }

    it("shows the values held as chips, and drops the one pressed", async () => {
        const onCommit = vi.fn();
        await mount({ labelType: "text", values: [ "one", "two" ], onCommit });

        const chips = [ ...container.querySelectorAll(".tn-chip") ];
        expect(chips.map((chip) => chip.textContent?.trim())).toEqual([ "one", "two" ]);

        await act(async () => chips[0]?.querySelector<HTMLElement>(".tn-chip-remove")?.click());
        expect(onCommit).toHaveBeenCalledWith([ "two" ]);
    });

    it("takes what was typed on Enter and empties the box, refusing a second of the same", async () => {
        const onCommit = vi.fn();
        const input = await mount({ labelType: "text", values: [ "one" ], onCommit });

        // Surrounding space goes with the typing, not into the value.
        await typeInto(input, "  two  ");
        await press(input, "Enter");
        expect(onCommit).toHaveBeenCalledWith([ "one", "two" ]);
        expect(input?.value).toBe("");

        // A value already held would come out as a second chip there is no telling apart.
        onCommit.mockClear();
        await typeInto(input, "one");
        await press(input, "Enter");
        expect(onCommit).not.toHaveBeenCalled();
        expect(input?.value).toBe("");
    });

    it("takes what was typed when the field is left, rather than throwing it away", async () => {
        // What is typed here is the value itself, so leaving with something in the box would lose it
        // — and a date is picked rather than typed, with no Enter to end it.
        const onCommit = vi.fn();
        const input = await mount({ labelType: "date", values: [], onCommit });

        expect(input?.type).toBe("date");
        await typeInto(input, "2026-07-29");
        await act(async () => {
            input?.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
        });
        expect(onCommit).toHaveBeenCalledWith([ "2026-07-29" ]);
    });

    it("drops the last chip on backspace in an empty box, and leaves a filled one alone", async () => {
        const onCommit = vi.fn();
        const input = await mount({ labelType: "text", values: [ "one", "two" ], onCommit });

        await press(input, "Backspace");
        expect(onCommit).toHaveBeenCalledWith([ "one" ]);

        // With something typed, backspace is the box's own to erase with.
        onCommit.mockClear();
        await typeInto(input, "th");
        await press(input, "Backspace");
        expect(onCommit).not.toHaveBeenCalled();
    });
});
