import { type ComponentChildren, render } from "preact";
import { describe, expect, it, vi } from "vitest";

// FormList instantiates a real Bootstrap dropdown in an effect; stub it so the
// component mounts without pulling in Bootstrap's layout-dependent machinery.
vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance: () => ({ dispose() {} }) },
    Tooltip: class { static getInstance() { return null; } }
}));

import FormList, { FormDropdownDivider, FormListCustomItem, FormListHeader, FormListItem } from "./FormList";

describe("FormDropdownDivider", () => {
    it("draws a separator among the rows, whose click closes no menu", () => {
        const host = document.createElement("div");
        render(<menu><FormDropdownDivider /></menu>, host);
        const divider = host.querySelector(".dropdown-divider");
        const pageHeard = vi.fn();
        host.addEventListener("click", pageHeard);

        // A list item, as the menu's rows are, and a separator to assistive technology.
        expect(divider?.tagName).toBe("LI");
        expect(divider?.getAttribute("role")).toBe("separator");
        divider?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        expect(pageHeard).not.toHaveBeenCalled();
    });
});

describe("FormListHeader", () => {
    it("heads the rows after it as text, out of the list's own roles", () => {
        const host = document.createElement("div");
        // A name the user wrote, such as a board column's status.
        render(<menu><FormListHeader text="<b>Doing</b>" /></menu>, host);
        const row = host.querySelector("menu > li");

        // Its heading speaks for it, so the row reads as no list item of the menu's.
        expect(row?.getAttribute("role")).toBe("none");
        expect(row?.querySelector("h6.dropdown-header")?.textContent).toBe("<b>Doing</b>");
    });
});

describe("FormListItem", () => {
    it("lays its row out as one span of icon, gap and content, as a menu's rows are", () => {
        const host = document.createElement("div");
        render((
            <menu>
                <FormListItem icon="bx bx-copy" iconClassName="use-note-color" badges={[ { text: "new" } ]}>Copy</FormListItem>
            </menu>
        ), host);
        const row = host.querySelector("li.dropdown-item");

        const [ span, ...others ] = [ ...row?.children ?? [] ];
        expect(others).toEqual([]);
        expect(span?.tagName).toBe("SPAN");
        expect(span?.className).toBe("");
        expect([ ...span?.children ?? [] ].map((child) => child.className)).toEqual([
            "bx bx-copy use-note-color tn-icon", "tn-menu-gap", "badge "
        ]);
        expect(span?.textContent).toBe("Copynew");
    });
});

describe("FormListCustomItem", () => {
    it("holds a control of its own in a row outside any menu too, where there is none to join", () => {
        const host = document.createElement("div");
        render(<menu><FormListCustomItem><button className="swatch" /></FormListCustomItem></menu>, host);
        const row = host.querySelector("menu > li");

        expect(row?.className).toBe("dropdown-custom-item");
        // Its content carries the roles of what it acts with.
        expect(row?.getAttribute("role")).toBe("none");
        expect(row?.querySelector("button.swatch")).not.toBeNull();
    });
});

describe("FormList keyboard activation", () => {
    it.each([ "Enter", " " ])("activates the focused item on %j like a click", (key) => {
        const { container, onSelect } = renderList();
        const item = getItem(container, "text");

        const event = press(item, key);

        expect(onSelect).toHaveBeenCalledExactlyOnceWith("text");
        expect(event.defaultPrevented).toBe(true);
    });

    it("ignores keys other than Enter/Space", () => {
        const { container, onSelect } = renderList();

        const event = press(getItem(container, "text"), "a");

        expect(onSelect).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });

    it("does not activate a disabled item", () => {
        const { container, onSelect } = renderList();

        press(getItem(container, "code"), "Enter");

        expect(onSelect).not.toHaveBeenCalled();
    });

    it("leaves typing inside an embedded input alone", () => {
        const onSelect = vi.fn();
        const container = mount(
            <FormList onSelect={onSelect}>
                <input className="embedded-search" />
                <FormListItem value="text">Text</FormListItem>
            </FormList>
        );
        const input = container.querySelector<HTMLInputElement>(".embedded-search");
        expect(input).not.toBeNull();

        const event = press(input as HTMLInputElement, "Enter");

        expect(onSelect).not.toHaveBeenCalled();
        expect(event.defaultPrevented).toBe(false);
    });
});

function renderList() {
    const onSelect = vi.fn();
    const container = mount(
        <FormList onSelect={onSelect}>
            <FormListItem value="text">Text</FormListItem>
            <FormListItem value="code" disabled>Code</FormListItem>
        </FormList>
    );
    return { container, onSelect };
}

function mount(node: ComponentChildren) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    render(node, container);
    return container;
}

function getItem(container: HTMLElement, value: string) {
    const item = container.querySelector<HTMLElement>(`.dropdown-item[data-value="${value}"]`);
    if (!item) {
        throw new Error(`No dropdown item with value "${value}"`);
    }
    return item;
}

function press(el: Element, key: string) {
    const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
    el.dispatchEvent(event);
    return event;
}
