import { type ComponentChildren, render } from "preact";
import { describe, expect, it, vi } from "vitest";

// FormList instantiates a real Bootstrap dropdown in an effect; stub it so the
// component mounts without pulling in Bootstrap's layout-dependent machinery.
vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance: () => ({ dispose() {} }) },
    Tooltip: class { static getInstance() { return null; } }
}));

import FormList, { FormDropdownDivider, FormDropdownSubmenu, FormListCustomItem, FormListHeader, FormListItem } from "./FormList";

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
            "bx bx-copy use-note-color tn-icon", "tn-menu-gap", "badge"
        ]);
        expect(span?.textContent).toBe("Copynew");
    });

    it("ends its row with a shortcut, then a trailing icon, leaving its own icon standing", () => {
        const host = document.createElement("div");
        render((
            <menu>
                <FormListItem icon="bx bx-sort" shortcut="Ctrl+S" trailingIcon="bx bx-check">By title</FormListItem>
            </menu>
        ), host);
        const span = host.querySelector("li.dropdown-item > span");

        expect([ ...span?.children ?? [] ].map((child) => `${child.tagName.toLowerCase()}.${child.className}`)).toEqual([
            "span.bx bx-sort tn-icon", "span.tn-menu-gap", "kbd.", "span.bx bx-check tn-icon menu-trailing-icon"
        ]);
        expect(span?.textContent).toBe("By titleCtrl+S");
    });
});

describe("FormListItem presses", () => {
    function renderRow(props: { disabled?: boolean } = {}) {
        const host = document.createElement("div");
        const onClick = vi.fn();
        render((
            <menu>
                <FormListItem {...props} onClick={onClick}>Size <input className="size" /><input type="checkbox" /></FormListItem>
            </menu>
        ), host);
        const row = host.querySelector<HTMLElement>("li.dropdown-item");
        if (!row) throw new Error("expected the row");
        return { row, onClick };
    }
    const mousedown = (target: Element, button = 0) => {
        const event = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button });
        target.dispatchEvent(event);
        return event;
    };

    it("keeps focus where it was on a press, and runs on its release", () => {
        const { row, onClick } = renderRow();

        expect(mousedown(row).defaultPrevented).toBe(true);
        // As a switch, which works by its click.
        const checkbox = row.querySelector("input[type=checkbox]");
        if (!checkbox) throw new Error("expected the checkbox");
        expect(mousedown(checkbox).defaultPrevented).toBe(true);
        expect(onClick).not.toHaveBeenCalled();

        row.click();
        expect(onClick).toHaveBeenCalledTimes(1);
    });

    it("lets a field in the row take focus, and a button other than the primary one be", () => {
        const { row } = renderRow();
        const field = row.querySelector(".size");
        if (!field) throw new Error("expected the field");

        expect(mousedown(field).defaultPrevented).toBe(false);
        expect(mousedown(row, 2).defaultPrevented).toBe(false);
    });

    it("runs nothing when disabled, though a click reaches it", () => {
        const { row, onClick } = renderRow({ disabled: true });

        row.click();
        expect(onClick).not.toHaveBeenCalled();
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

describe("FormDropdownSubmenu", () => {
    it("heads its rows with its title outside any menu, where there is no layer to open", () => {
        const host = document.createElement("div");
        render(<menu><FormDropdownSubmenu icon="bx bx-chip" title="Advanced">
            <FormListItem>Reload</FormListItem>
        </FormDropdownSubmenu></menu>, host);
        const rows = [ ...host.querySelectorAll("menu > li") ];

        expect(rows.map((row) => row.textContent)).toEqual([ "Advanced", "Reload" ]);
        expect(rows[0]?.querySelector("h6.dropdown-header")).not.toBeNull();
        expect(host.querySelector(".dropdown-submenu")).toBeNull();
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
