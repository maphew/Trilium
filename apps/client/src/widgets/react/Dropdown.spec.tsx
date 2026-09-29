import { type ComponentChildren, render } from "preact";
import { useRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Dropdown, { type DropdownHandle, type DropdownProps } from "./Dropdown";

// A dialog's focus trap would pull focus out of a menu portaled over it.
const focusTraps = vi.hoisted(() => ({ suspend: vi.fn(() => () => {}) }));
vi.mock("./modal_focustrap", () => ({ suspendModalFocusTraps: focusTraps.suspend }));

describe("Dropdown", () => {
    const host = document.createElement("div");
    document.body.append(host);

    beforeEach(() => {
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
    });

    afterEach(() => {
        render(null, host);
        vi.restoreAllMocks();
    });

    function renderDropdown(props: Partial<DropdownProps> = {}, content: ComponentChildren = <li className="dropdown-item">By title</li>) {
        let handle: { current: DropdownHandle | null } = { current: null };
        function Harness() {
            const dropdownRef = useRef<DropdownHandle | null>(null);
            handle = dropdownRef;
            return (
                <Dropdown text="Sort" dropdownRef={dropdownRef} dropdownContainerClassName="sort-menu" {...props}>
                    {content}
                </Dropdown>
            );
        }
        render(<Harness />, host);
        const toggle = host.querySelector<HTMLButtonElement>("button");
        if (!toggle) throw new Error("expected the toggle to render");
        vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 100, y: 50, width: 80, height: 30 }));
        return { toggle, handle: () => handle.current };
    }

    const popup = () => document.querySelector<HTMLElement>(".tn-popup");
    const click = (element: HTMLElement) => {
        // A press comes before its click, and would reach the popup's dismissal first.
        element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        element.click();
    };

    it("opens a popup below its toggle on a click, and closes it on another", async () => {
        const onShown = vi.fn();
        const onHidden = vi.fn();
        const { toggle } = renderDropdown({ onShown, onHidden, className: "sort-dropdown" });
        expect(popup()).toBeNull();
        expect(toggle.getAttribute("aria-expanded")).toBe("false");

        click(toggle);
        await vi.waitFor(() => expect(popup()?.style.visibility).toBe("visible"));
        const opened = popup();
        expect([ ...opened?.classList ?? [] ]).toEqual([ "tn-popup", "dropdown-menu", "show", "tn-dropdown-menu", "sort-menu", "tn-dropdown-list" ]);
        expect(opened?.textContent).toBe("By title");
        // In the page's body, in a wrapper with the dropdown's class, so CSS scoped under it applies.
        expect(opened?.parentElement?.className).toBe("tn-dropdown-portal sort-dropdown");
        expect(opened?.getAttribute("aria-labelledby")).toBe(toggle.id);
        // 2px below the toggle, as Bootstrap's dropdowns stood.
        expect([ opened?.style.left, opened?.style.top ]).toEqual([ "100px", "82px" ]);
        expect(toggle.getAttribute("aria-expanded")).toBe("true");
        expect(toggle.classList.contains("show")).toBe(true);
        expect(onShown).toHaveBeenCalledTimes(1);

        // The toggle's own press is not a press outside, so its click closes rather than reopens.
        click(toggle);
        await vi.waitFor(() => expect(popup()).toBeNull());
        expect(toggle.getAttribute("aria-expanded")).toBe("false");
        expect(onHidden).toHaveBeenCalledTimes(1);
    });

    it("closes on a press outside, and on Escape, which hands focus back to the toggle", async () => {
        const { toggle } = renderDropdown();

        click(toggle);
        await vi.waitFor(() => expect(popup()).not.toBeNull());
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        await vi.waitFor(() => expect(popup()).toBeNull());

        click(toggle);
        await vi.waitFor(() => expect(popup()).not.toBeNull());
        document.body.focus();
        popup()?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await vi.waitFor(() => expect(popup()).toBeNull());
        expect(document.activeElement).toBe(toggle);
    });

    it("opens, closes and toggles through its handle, for a caller that decides when", async () => {
        const { handle } = renderDropdown();
        await vi.waitFor(() => expect(handle()).not.toBeNull());

        handle()?.show();
        await vi.waitFor(() => expect(popup()).not.toBeNull());
        handle()?.hide();
        await vi.waitFor(() => expect(popup()).toBeNull());
        handle()?.toggle();
        await vi.waitFor(() => expect(popup()).not.toBeNull());
        handle()?.toggle();
        await vi.waitFor(() => expect(popup()).toBeNull());
    });

    it("closes an open popup once it is disabled, and does not open while it is", async () => {
        const { toggle } = renderDropdown();
        click(toggle);
        await vi.waitFor(() => expect(popup()).not.toBeNull());

        renderDropdown({ disabled: true });
        await vi.waitFor(() => expect(popup()).toBeNull());
        const disabledToggle = host.querySelector<HTMLButtonElement>("button");
        expect(disabledToggle?.disabled).toBe(true);
    });

    describe("content", () => {
        const items = <>
            <li className="dropdown-item" tabIndex={0}>By title</li>
            <li className="dropdown-item disabled" tabIndex={0}>By size</li>
            {/* As `FormListToggleableItem`, which stops its click so the menu stays up. */}
            <li className="dropdown-item" tabIndex={0} onClick={(e) => e.stopPropagation()}>Descending</li>
            <li><input className="filter" /></li>
            <li className="dropdown-item" tabIndex={0}>By date</li>
        </>;
        const item = (title: string) => {
            const found = [ ...popup()?.querySelectorAll<HTMLElement>("li") ?? [] ].find((li) => li.textContent === title);
            if (!found) throw new Error(`expected an item titled ${title}`);
            return found;
        };

        it("closes on a click on an item, but not on one the item stops, in a field, or on the menu itself", async () => {
            const { toggle } = renderDropdown({}, items);
            click(toggle);
            await vi.waitFor(() => expect(popup()).not.toBeNull());

            item("Descending").click();
            popup()?.querySelector<HTMLElement>("input")?.click();
            popup()?.click();
            expect(popup()).not.toBeNull();

            item("By title").click();
            await vi.waitFor(() => expect(popup()).toBeNull());
        });

        it("stays up for a click inside when it closes only on one outside", async () => {
            const { toggle } = renderDropdown({ dropdownOptions: { autoClose: "outside" } }, items);
            click(toggle);
            await vi.waitFor(() => expect(popup()).not.toBeNull());

            item("By title").click();
            expect(popup()).not.toBeNull();
            document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
            await vi.waitFor(() => expect(popup()).toBeNull());
        });

        it("opens above its toggle when asked to", async () => {
            const { toggle } = renderDropdown({ dropdownOptions: { popperConfig: { placement: "top" } } });
            vi.spyOn(toggle, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 100, y: 500, width: 80, height: 30 }));
            click(toggle);
            // Centered over the toggle, and ending 2px above it: 500 - 100 - 2.
            await vi.waitFor(() => expect([ popup()?.style.left, popup()?.style.top ]).toEqual([ "40px", "398px" ]));
        });

        it("moves focus over the items with Up and Down, keeping them from Bootstrap, and opens from the toggle", async () => {
            const bootstrapHeard = vi.fn();
            document.addEventListener("keydown", bootstrapHeard, true);
            const { toggle } = renderDropdown({}, items);
            const key = (target: Element, name: string) =>
                target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

            toggle.focus();
            key(toggle, "ArrowDown");
            await vi.waitFor(() => expect(document.activeElement?.textContent).toBe("By title"));
            // Bootstrap reacts on a toggle only with `data-bs-toggle`, which this one does not carry.
            bootstrapHeard.mockClear();

            // Past the disabled item, round from the last to the first, and back.
            key(item("By title"), "ArrowDown");
            expect(document.activeElement?.textContent).toBe("Descending");
            key(item("Descending"), "ArrowDown");
            expect(document.activeElement?.textContent).toBe("By date");
            key(item("By date"), "ArrowDown");
            expect(document.activeElement?.textContent).toBe("By title");
            key(item("By title"), "ArrowUp");
            expect(document.activeElement?.textContent).toBe("By date");
            expect(bootstrapHeard).not.toHaveBeenCalled();

            // A field keeps its own arrows.
            const field = popup()?.querySelector("input");
            if (!field) throw new Error("expected the field");
            key(field, "ArrowDown");
            expect(bootstrapHeard).toHaveBeenCalledTimes(1);
            document.removeEventListener("keydown", bootstrapHeard, true);
        });

        it("suspends the focus traps of the dialogs under it while it is up, and restores them after", async () => {
            const restore = vi.fn();
            focusTraps.suspend.mockReturnValue(restore);
            const { toggle } = renderDropdown();

            click(toggle);
            await vi.waitFor(() => expect(popup()).not.toBeNull());
            expect(focusTraps.suspend).toHaveBeenCalledTimes(1);
            expect(restore).not.toHaveBeenCalled();

            click(toggle);
            await vi.waitFor(() => expect(popup()).toBeNull());
            expect(restore).toHaveBeenCalledTimes(1);
        });
    });
});
