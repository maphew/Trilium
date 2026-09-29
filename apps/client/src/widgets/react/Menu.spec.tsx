import { render } from "preact";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FormDropdownDivider, FormDropdownSubmenu, FormListHeader, FormListItem } from "./FormList";
import Menu, { rowInNextColumn } from "./Menu";

/** A row 20px tall, `left` into the menu and `top` down it. */
function row(left: number, top: number) {
    return { left, top, bottom: top + 20 };
}

describe("rowInNextColumn", () => {
    // Three rows in the first column, two in the second, one in the third.
    const columns = [
        row(0, 0), row(0, 20), row(0, 40),
        row(100, 0), row(100, 20),
        row(200, 0)
    ];

    it("goes to the row at the same height in the column beside", () => {
        expect(rowInNextColumn(columns, 1, "right")).toBe(4);
        expect(rowInNextColumn(columns, 4, "left")).toBe(1);
        // The nearest column, not the one after it.
        expect(rowInNextColumn(columns, 0, "right")).toBe(3);
    });

    it("goes to the nearest row where the column beside is shorter", () => {
        expect(rowInNextColumn(columns, 2, "right")).toBe(4);
        expect(rowInNextColumn(columns, 4, "right")).toBe(5);
    });

    it("finds nothing past the outermost column, in a single column, or for a row it cannot place", () => {
        expect(rowInNextColumn(columns, 0, "left")).toBeUndefined();
        expect(rowInNextColumn(columns, 5, "right")).toBeUndefined();
        expect(rowInNextColumn([ row(0, 0), row(0, 20) ], 0, "right")).toBeUndefined();
        expect(rowInNextColumn(columns, -1, "right")).toBeUndefined();
        // A row not laid out yet is passed over.
        expect(rowInNextColumn([ row(0, 0), undefined, row(100, 0) ], 0, "right")).toBe(2);
    });
});

describe("Menu with declared rows", () => {
    const host = document.createElement("div");
    document.body.append(host);
    afterEach(() => render(null, host));

    /**
     * A menu written as components, with a submenu declared inside a component of its own, as the
     * global menu declares its "Advanced" submenu.
     */
    function renderMenu() {
        const calls: string[] = [];
        const onClose = vi.fn(() => calls.push("close"));
        function Advanced() {
            return (
                <FormDropdownSubmenu title="Advanced" icon="bx bx-chip">
                    <FormListItem onClick={() => calls.push("log")}>Show log</FormListItem>
                    <FormListItem onClick={() => calls.push("reload")}>Reload</FormListItem>
                </FormDropdownSubmenu>
            );
        }
        render((
            <Menu x={10} y={10} onClose={onClose}>
                <FormListHeader text="Note" />
                <FormListItem onClick={() => calls.push("copy")}>Copy</FormListItem>
                <FormListItem disabled onClick={() => calls.push("delete")}>Delete</FormListItem>
                <FormDropdownDivider />
                <Advanced />
            </Menu>
        ), host);

        const menu = host.querySelector<HTMLElement>(".tn-menu");
        if (!menu) throw new Error("expected the menu to render");
        return { menu, calls, onClose };
    }

    function rowTitled(title: string) {
        const found = [ ...document.querySelectorAll<HTMLElement>("li.dropdown-item") ]
            .find((item) => item.querySelector(":scope > span")?.textContent === title);
        if (!found) throw new Error(`expected a row titled ${title}`);
        return found;
    }

    /** The open submenus' layers, each as the titles of its rows. */
    function layers(menu: HTMLElement) {
        return [ ...menu.querySelectorAll(":scope > div.dropdown-submenu > .dropdown-menu") ]
            .map((layer) => [ ...layer.querySelectorAll(":scope > .tn-menu-scroll > li") ].map((item) => item.textContent));
    }

    /** A press and its release, which runs a row. */
    const press = (element: HTMLElement) => {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 }));
    };
    const key = (menu: HTMLElement, name: string) =>
        menu.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true }));

    it("draws the rows it is given in order, and opens a declared submenu as a layer beside the scroller", async () => {
        const { menu, calls } = renderMenu();

        const rows = [ ...menu.querySelectorAll(":scope > .tn-menu-scroll > li") ]
            .map((item) => `${item.className || item.firstElementChild?.className} ${item.textContent}`);
        expect(rows).toEqual([
            "dropdown-header Note",
            "dropdown-item Copy",
            "dropdown-item disabled Delete",
            "dropdown-divider ",
            "dropdown-item dropdown-submenu Advanced"
        ]);

        rowTitled("Advanced").dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(layers(menu)).toEqual([ [ "Show log", "Reload" ] ]));
        expect(calls).toEqual([]);
    });

    it("closes the menu before running a row, but not for a row that opens a submenu or is disabled", async () => {
        const { menu, calls } = renderMenu();

        press(rowTitled("Delete"));
        press(rowTitled("Advanced"));
        await vi.waitFor(() => expect(layers(menu)).toHaveLength(1));
        expect(calls).toEqual([]);

        press(rowTitled("Show log"));
        expect(calls).toEqual([ "close", "log" ]);
    });

    it("walks the rows as they are drawn, into a declared submenu and back, skipping what cannot run", async () => {
        const { menu, calls } = renderMenu();
        const active = () => menu.querySelector(".tn-menu-active > span")?.textContent;

        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(active()).toBe("Copy"));
        // "Delete" is disabled, and the header and the separator are not rows to stand on.
        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(active()).toBe("Advanced"));

        key(menu, "ArrowRight");
        await vi.waitFor(() => expect(layers(menu)).toEqual([ [ "Show log", "Reload" ] ]));
        await vi.waitFor(() => expect(active()).toBe("Show log"));
        key(menu, "ArrowDown");
        await vi.waitFor(() => expect(active()).toBe("Reload"));

        key(menu, "ArrowLeft");
        await vi.waitFor(() => expect(layers(menu)).toEqual([]));
        expect(active()).toBe("Advanced");

        key(menu, "ArrowRight");
        await vi.waitFor(() => expect(active()).toBe("Show log"));
        key(menu, "Enter");
        expect(calls).toEqual([ "close", "log" ]);
    });
});
