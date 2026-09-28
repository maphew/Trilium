import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/note_tooltip", () => ({ default: { dismissAllTooltips: vi.fn() } }));
vi.mock("../services/keyboard_actions", () => ({
    getActionSync: (name: string) => ({
        effectiveShortcuts: name === "copyNotesToClipboard" ? [ "Ctrl+C", "Ctrl+Insert" ] : []
    })
}));
// Key names are translated; the formatting has specs of its own.
vi.mock("../services/keyboard_shortcut_display", () => ({
    formatShortcut: (shortcut: string) => shortcut.split("+"),
    joinShortcut: (tokens: string[]) => tokens.join("+")
}));

/** The page as the shell leaves it. */
function buildPage() {
    document.body.innerHTML = `<div id="app"></div>`;
}

/** The open menu, under the id the stylesheets and the app's floating layers know it by. */
function menuElement() {
    return document.getElementById("context-menu-container");
}

/** Puts an element on a screen of its own, as the browser reports one. */
function setFullscreenElement(element: Element | null) {
    Object.defineProperty(document, "fullscreenElement", { value: element, configurable: true });
}

/** A fresh menu service, built against the page as it now stands. */
async function buildContextMenu() {
    vi.resetModules();
    return (await import("./context_menu")).default;
}

const items = [ { title: "Add a marker at this location", handler: () => {} } ];

beforeEach(() => {
    setFullscreenElement(null);
});

describe("contextMenu", () => {
    it("mounts the menu while it is up, and leaves nothing behind once hidden", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();
        const onHide = vi.fn();

        await contextMenu.show({ x: 10, y: 20, items, selectMenuItemHandler: () => {}, onHide });

        const menu = menuElement();
        expect(menu?.parentElement?.parentElement).toBe(document.body);
        expect(menu?.getAttribute("role")).toBe("menu");
        // The classes the old menu carried, which the stylesheets and themes style it by.
        expect([ ...menu?.classList ?? [] ]).toEqual(expect.arrayContaining([
            "dropdown-menu", "dropdown-menu-sm", "dropend", "show"
        ]));
        expect(document.body.classList.contains("context-menu-shown")).toBe(true);

        await contextMenu.hide();
        expect(menuElement()).toBeNull();
        expect(document.body.innerHTML).toBe(`<div id="app"></div>`);
        expect(document.body.classList.contains("context-menu-shown")).toBe(false);
        expect(onHide).toHaveBeenCalledTimes(1);

        // A later click on the page hides nothing, so `onHide` does not run again.
        await contextMenu.hide();
        expect(onHide).toHaveBeenCalledTimes(1);
    });

    describe("items", () => {
        it("lists the items and separators in order, without repeating a separator", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Cut" },
                    { title: "Copy", className: "destructive-action" },
                    { kind: "separator" },
                    { kind: "separator" },
                    { title: "Paste" }
                ]
            });

            const rows = [ ...menuElement()?.children ?? [] ]
                .map(row => `${row.tagName.toLowerCase()}.${row.className} ${row.textContent}`);
            expect(rows).toEqual([
                "li.dropdown-item Cut",
                "li.dropdown-item destructive-action Copy",
                "div.dropdown-divider ",
                "li.dropdown-item Paste"
            ]);
        });

        it("renders a title as HTML, as callers escape and mark it up", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [ { title: `Tolkien &amp; &lt;sons&gt; <span class="tn-menu-name">Not set</span>` } ]
            });

            const row = menuElement()?.querySelector("[role=menuitem]");
            expect(row?.textContent).toBe("Tolkien & <sons> Not set");
            expect(row?.querySelector(".tn-menu-name")).not.toBeNull();
        });

        it("shows an item's icon, a check mark in its place when checked, and a slot for none", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "To Do", uiIcon: "bx bx-list-ul", iconColorClass: "use-note-color color-e64d4d" },
                    { title: "Done", uiIcon: "bx bx-list-ul", checked: true },
                    { title: "Aligned", uiIcon: undefined },
                    { title: "Plain" }
                ]
            });

            // Each row is a span of icon slot, gap and title, which `.dropdown-item > span` lays out.
            const slots = [ ...menuElement()?.querySelectorAll("li.dropdown-item") ?? [] ].map(row => {
                const [ icon, gap ] = row.querySelector(":scope > span")?.children ?? [];
                expect(gap?.className).toBe("tn-menu-gap");
                return icon?.className || icon?.textContent;
            });
            expect(slots).toEqual([
                "bx bx-list-ul tn-icon use-note-color color-e64d4d",
                "bx bx-check tn-icon",
                "\u00a0",
                ""
            ]);
            // Only the icon is tinted, so the title keeps the menu's own colour.
            expect(menuElement()?.querySelectorAll(".use-note-color")).toHaveLength(1);
        });

        it("shows a keyboard action's shortcuts, or a literal shortcut, after the title", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Copy", keyboardShortcut: "copyNotesToClipboard" },
                    { title: "Paste", shortcut: "Ctrl+V" },
                    { title: "Cut", keyboardShortcut: "cutNotesToClipboard" }
                ]
            });

            const shortcuts = [ ...menuElement()?.querySelectorAll("li.dropdown-item > span") ?? [] ]
                .map(row => row.lastElementChild?.outerHTML);
            expect(shortcuts).toEqual([
                `<span class="keyboard-shortcut"><kbd>Ctrl</kbd>+<kbd>C</kbd>,<kbd>Ctrl</kbd>+<kbd>Insert</kbd></span>`,
                "<kbd>Ctrl+V</kbd>",
                // An action with no shortcut assigned shows none.
                `<span>Cut</span>`
            ]);
        });

        it("renders a custom item's component in its place, and hides on a click inside it", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const { h } = await import("preact");
            const { useState } = await import("preact/hooks");
            // A component with state of its own, as the colour pickers are.
            function Swatches() {
                const [ picked ] = useState("red");
                return h("div", { className: "swatches" }, picked);
            }

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Delete" },
                    { kind: "separator" },
                    { kind: "custom", componentFn: Swatches },
                    { kind: "separator" },
                    { title: "Export" }
                ]
            });

            const rows = [ ...menuElement()?.children ?? [] ].map(row => `${row.tagName.toLowerCase()}.${row.className}`);
            expect(rows).toEqual([
                "li.dropdown-item", "div.dropdown-divider", "li.dropdown-custom-item", "div.dropdown-divider", "li.dropdown-item"
            ]);
            const custom = menuElement()?.querySelector<HTMLElement>(".dropdown-custom-item");
            expect(custom?.innerHTML).toBe(`<div class="swatches">red</div>`);

            // On its own, without reaching the page's listener: on mobile only the cover has one.
            custom?.dispatchEvent(new MouseEvent("click", { bubbles: false }));
            expect(contextMenu.isShown()).toBe(false);
        });

        it("marks an item that is not enabled as disabled, and does not run it", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const handler = vi.fn();
            const selectMenuItemHandler = vi.fn();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler,
                items: [
                    { title: "Delete", enabled: false, handler },
                    { title: "Export", enabled: true },
                    { title: "Import" }
                ]
            });

            const rows = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ];
            expect(rows.map(row => [ row.classList.contains("disabled"), row.getAttribute("aria-disabled") ]))
                .toEqual([ [ true, "true" ], [ false, null ], [ false, null ] ]);

            // The stylesheets keep the pointer off it; a press that still arrives does nothing.
            rows[0].dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
            expect(handler).not.toHaveBeenCalled();
            expect(selectMenuItemHandler).not.toHaveBeenCalled();
            expect(contextMenu.isShown()).toBe(true);
        });

        it("runs an item pressed with the primary button, then hides", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const calls: string[] = [];
            const item = { title: "Copy", handler: () => { calls.push("handler"); } };

            await contextMenu.show({
                x: 10, y: 10, items: [ item ],
                selectMenuItemHandler: (selected) => { calls.push(`select ${selected.title}`); }
            });
            const row = menuElement()?.querySelector<HTMLElement>("[role=menuitem]");
            if (!row) throw new Error("expected a menu item");

            // Other buttons do nothing.
            row.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 2 }));
            expect(calls).toEqual([]);
            expect(contextMenu.isShown()).toBe(true);

            const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
            row.dispatchEvent(press);
            expect(calls).toEqual([ "handler", "select Copy" ]);
            expect(contextMenu.isShown()).toBe(false);
            // The press does not move focus, so a text editor keeps its selection for the command.
            expect(press.defaultPrevented).toBe(true);
        });
    });

    describe("placement", () => {
        /** Opens the menu with the size a browser would lay it out at; happy-dom lays out nothing. */
        async function place(options: { x: number, y: number, width: number, height: number, orientation?: "left" }) {
            buildPage();
            const contextMenu = await buildContextMenu();
            // Floating UI reads the viewport from the root element's client size.
            vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
            vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
            vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(options.width);
            vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(options.height);

            await contextMenu.show({ ...options, items, selectMenuItemHandler: () => {} });
            const menu = menuElement();
            if (!menu) throw new Error("expected the menu to render");
            await vi.waitFor(() => expect(menu.style.visibility).toBe("visible"));
            return menu;
        }

        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("opens at the pointer, towards the bottom right", async () => {
            const menu = await place({ x: 10, y: 20, width: 200, height: 300 });
            expect([ menu.style.left, menu.style.top ]).toEqual([ "10px", "20px" ]);
        });

        it("opens towards the left when asked to", async () => {
            const menu = await place({ x: 500, y: 20, width: 200, height: 300, orientation: "left" });
            expect([ menu.style.left, menu.style.top ]).toEqual([ "300px", "20px" ]);
        });

        it("flips to the other side of the pointer where it does not fit", async () => {
            const menu = await place({ x: 900, y: 700, width: 200, height: 300 });
            // Its bottom right corner is at the pointer, as a native menu opened in that corner.
            expect([ menu.style.left, menu.style.top ]).toEqual([ "700px", "400px" ]);
        });

        it("shifts inside the viewport where it fits on neither side", async () => {
            // 600px overflows by 155px to the right of the pointer and by 55px to its left.
            const menu = await place({ x: 550, y: 20, width: 600, height: 300 });
            expect([ menu.style.left, menu.style.top ]).toEqual([ "5px", "20px" ]);
        });

        it("caps its height to the viewport so that it scrolls", async () => {
            const menu = await place({ x: 10, y: 20, width: 200, height: 2000 });
            expect(menu.style.maxHeight).toBe("790px");
        });

        it("places itself again when the viewport changes size", async () => {
            const menu = await place({ x: 700, y: 20, width: 200, height: 300 });
            expect([ menu.style.left, menu.style.maxHeight ]).toEqual([ "700px", "790px" ]);

            vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(800);
            vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(600);
            window.dispatchEvent(new Event("resize"));

            // It no longer fits right of the pointer, so it flips to its left, and its cap shrinks.
            await vi.waitFor(() => expect([ menu.style.left, menu.style.maxHeight ]).toEqual([ "500px", "590px" ]));
        });
    });

    it("hides on a click anywhere on the page", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();

        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
        document.getElementById("app")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(contextMenu.isShown()).toBe(false);
    });

    it("opens inside whatever has the screen, and in the body once nothing does", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();
        const map = document.getElementById("app");
        const show = () => contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });

        setFullscreenElement(map);
        await show();
        // A browser paints only the fullscreen element, so a menu outside it never shows.
        expect(menuElement()?.parentElement?.parentElement).toBe(map);

        setFullscreenElement(null);
        await show();
        expect(menuElement()?.parentElement?.parentElement).toBe(document.body);
        // The host the fullscreen menu was mounted into went with it.
        expect(map?.childElementCount).toBe(0);
    });

    it("hides a Bootstrap tooltip that is up when the menu opens", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();
        // Imported after `vi.resetModules()` so that the spec and `context_menu` share one
        // Bootstrap instance registry.
        const { Tooltip } = await import("bootstrap");

        const button = document.createElement("button");
        document.body.append(button);
        const tooltip = new Tooltip(button, {
            title: "Calendar",
            animation: false,
            trigger: "hover focus"
        });
        // A field that points `aria-describedby` at its help text has no Bootstrap tooltip.
        const field = document.createElement("input");
        field.setAttribute("aria-describedby", "field-help");
        document.body.append(field);
        const showMenu = () =>
            contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });

        tooltip.show();
        expect(document.querySelector(".tooltip")).not.toBeNull();
        expect(button.hasAttribute("aria-describedby")).toBe(true);

        await showMenu();
        expect(document.querySelector(".tooltip")).toBeNull();
        expect(button.hasAttribute("aria-describedby")).toBe(false);
        expect(field.getAttribute("aria-describedby")).toBe("field-help");

        // A right-click also focuses the trigger, which keeps the focus trigger active. Bootstrap
        // shows the tooltip from a timer, so the spec waits for it.
        button.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
        await vi.waitFor(() => expect(document.querySelector(".tooltip")).not.toBeNull());

        await showMenu();
        expect(document.querySelector(".tooltip")).toBeNull();
        expect(button.hasAttribute("aria-describedby")).toBe(false);

        tooltip.dispose();
        button.remove();
        field.remove();
    });

    it("says whether it is up, for a host whose own press would otherwise not know", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();

        expect(contextMenu.isShown()).toBe(false);

        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
        expect(contextMenu.isShown()).toBe(true);

        await contextMenu.hide();
        expect(contextMenu.isShown()).toBe(false);
    });
});
