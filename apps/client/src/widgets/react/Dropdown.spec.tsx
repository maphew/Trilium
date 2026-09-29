import { render } from "preact";
import { useRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Dropdown, { type DropdownHandle, type DropdownProps } from "./Dropdown";

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

    function renderDropdown(props: Partial<DropdownProps> = {}) {
        let handle: { current: DropdownHandle | null } = { current: null };
        function Harness() {
            const dropdownRef = useRef<DropdownHandle | null>(null);
            handle = dropdownRef;
            return (
                <Dropdown text="Sort" dropdownRef={dropdownRef} dropdownContainerClassName="sort-menu" {...props}>
                    <li className="dropdown-item">By title</li>
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
        const { toggle } = renderDropdown({ onShown, onHidden });
        expect(popup()).toBeNull();
        expect(toggle.getAttribute("aria-expanded")).toBe("false");

        click(toggle);
        await vi.waitFor(() => expect(popup()?.style.visibility).toBe("visible"));
        const opened = popup();
        expect([ ...opened?.classList ?? [] ]).toEqual([ "tn-popup", "dropdown-menu", "show", "tn-dropdown-menu", "sort-menu" ]);
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
});
