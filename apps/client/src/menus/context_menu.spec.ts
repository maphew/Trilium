import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/note_tooltip", () => ({ default: { dismissAllTooltips: vi.fn() } }));
vi.mock("../services/keyboard_actions", () => ({
    getActionSync: (name: string) => ({
        effectiveShortcuts: name === "copyNotesToClipboard" ? [ "Ctrl+C", "Ctrl+Insert" ] : []
    })
}));
const layout = vi.hoisted(() => ({ onMobile: false }));
vi.mock("../services/utils", async (importOriginal) => {
    const original = await importOriginal<typeof import("../services/utils")>();
    // `Menu` imports `isMobile()` by name, `contextMenu` through the default export.
    return {
        ...original,
        isMobile: () => layout.onMobile,
        default: { ...original.default, isMobile: () => layout.onMobile }
    };
});
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
            expect(contextMenu.isShown).toBe(false);
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
            expect(contextMenu.isShown).toBe(true);
        });

        it("shows a header as text above the items it introduces", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    // A name the user wrote, such as a board column's status.
                    { kind: "header", title: "<b>Doing</b>" },
                    { title: "Move left" },
                    { kind: "separator" },
                    { kind: "header", title: "Colour" },
                    { title: "Red" }
                ]
            });

            const rows = [ ...menuElement()?.children ?? [] ]
                .map(row => `${row.tagName.toLowerCase()}.${row.className} ${row.innerHTML.includes("<b>") ? "(markup)" : row.textContent}`);
            expect(rows).toEqual([
                "h6.dropdown-header <b>Doing</b>",
                "li.dropdown-item Move left",
                "div.dropdown-divider ",
                "h6.dropdown-header Colour",
                "li.dropdown-item Red"
            ]);
        });

        it("shows badges after the title, and a trailing icon at the end of the row", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    {
                        title: "Done", uiIcon: "bx bx-columns",
                        badges: [ { title: "<i>archived</i>", className: "archived" }, { title: "new" } ],
                        shortcut: "Ctrl+D",
                        trailingIcon: "bx bx-check"
                    },
                    { title: "Doing", uiIcon: "bx bx-columns", trailingIcon: undefined }
                ]
            });

            const [ done, doing ] = [ ...menuElement()?.querySelectorAll("li.dropdown-item > span") ?? [] ]
                .map(row => [ ...row.children ].map(child => `${child.tagName.toLowerCase()}.${child.className} ${child.textContent}`));
            expect(done).toEqual([
                "span.bx bx-columns tn-icon ",
                "span.tn-menu-gap ",
                "span. Done",
                // A badge's title is text, as a column's status is a name the user wrote.
                "span.badge archived <i>archived</i>",
                "span.badge new",
                "kbd. Ctrl+D",
                // The item's own icon stands, unlike with `checked`.
                "span.bx bx-check tn-icon menu-trailing-icon "
            ]);
            expect(doing).toHaveLength(3);
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
            expect(contextMenu.isShown).toBe(true);

            const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 });
            row.dispatchEvent(press);
            expect(calls).toEqual([ "handler", "select Copy" ]);
            expect(contextMenu.isShown).toBe(false);
            // The press does not move focus, so a text editor keeps its selection for the command.
            expect(press.defaultPrevented).toBe(true);
        });
    });

    describe("submenus", () => {
        const noteTypes = [ { title: "Text" }, { title: "Code" } ];
        const templates = [ { title: "Meeting", items: [ { title: "Weekly" } ] } ];
        const submenuItems = [
            { title: "Copy" },
            { title: "Insert child note", command: "insertChildNote", items: noteTypes },
            { title: "Templates", items: templates }
        ];

        async function openMenu(onSelect: (title: string) => void = () => {}) {
            buildPage();
            const contextMenu = await buildContextMenu();
            await contextMenu.show({
                x: 10, y: 10, items: submenuItems,
                selectMenuItemHandler: (item) => onSelect(String(item.title))
            });
            return contextMenu;
        }

        /** The row titled `title`, read off its own line: a row's text also holds its submenu's. */
        function row(title: string) {
            const found = [ ...document.querySelectorAll<HTMLElement>("li.dropdown-item") ]
                .find((item) => item.querySelector(":scope > span")?.textContent === title);
            if (!found) throw new Error(`expected a row titled ${title}`);
            return found;
        }

        /** The submenu layers standing open, each as the titles of its rows. */
        function layers() {
            return [ ...menuElement()?.querySelectorAll(":scope > div.dropdown-submenu > ul.dropdown-menu") ?? [] ]
                .map((layer) => [ ...layer.querySelectorAll(":scope > li") ].map((item) => item.textContent));
        }

        const hover = (element: HTMLElement) => element.dispatchEvent(new PointerEvent("pointerenter"));
        const press = (element: HTMLElement) =>
            element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));

        afterEach(() => {
            layout.onMobile = false;
            vi.restoreAllMocks();
        });

        it("opens a layer of its own for each level, beside the row it opens from", async () => {
            await openMenu();
            const parent = row("Templates");
            // The arrow the theme draws, and the markup its submenu rules expect.
            expect(parent.classList.contains("dropdown-submenu")).toBe(true);
            expect(parent.querySelector(":scope > span")?.classList.contains("dropdown-toggle")).toBe(true);
            expect(layers()).toEqual([]);

            hover(parent);
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ] ]));
            expect(parent.classList.contains("submenu-open")).toBe(true);

            hover(row("Meeting"));
            // Each level stands beside the others, none nested in another's scrolling box.
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ], [ "Weekly" ] ]));

            // Pointing at another row of the root closes both.
            hover(row("Copy"));
            await vi.waitFor(() => expect(layers()).toEqual([]));
            expect(parent.classList.contains("submenu-open")).toBe(false);
        });

        it("places a layer beside its row, flipped where it does not fit, and hides it while its row is scrolled away", async () => {
            vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
            vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
            // Only the layer: a size unlike its rect would read to Floating UI as a CSS scale.
            vi.spyOn(HTMLUListElement.prototype, "offsetWidth", "get").mockReturnValue(150);
            vi.spyOn(HTMLUListElement.prototype, "offsetHeight", "get").mockReturnValue(100);
            await openMenu();
            const root = menuElement();
            if (!root) throw new Error("expected the menu to render");
            // happy-dom loads no stylesheet, so the menu is made to scroll as `Menu.css` makes it.
            root.style.overflowY = "auto";
            vi.spyOn(root, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x: 0, y: 0, width: 1000, height: 300 }));
            // Floating UI clips to a scrolling ancestor's client box, which happy-dom leaves at 0.
            vi.spyOn(root, "clientWidth", "get").mockReturnValue(1000);
            vi.spyOn(root, "clientHeight", "get").mockReturnValue(300);
            const parent = row("Templates");
            let rowRect = DOMRect.fromRect({ x: 10, y: 100, width: 200, height: 24 });
            vi.spyOn(parent, "getBoundingClientRect").mockImplementation(() => rowRect);

            hover(parent);
            const layer = () => menuElement()?.querySelector<HTMLElement>("div.dropdown-submenu > ul");
            // Overlapping the row by 2px, its top at the row's.
            await vi.waitFor(() => expect([ layer()?.style.left, layer()?.style.top ]).toEqual([ "208px", "100px" ]));
            expect(layer()?.style.visibility).toBe("visible");

            // Scrolled out of the menu's view, the row takes its submenu out of sight with it.
            rowRect = DOMRect.fromRect({ x: 10, y: 400, width: 200, height: 24 });
            root.dispatchEvent(new Event("scroll"));
            await vi.waitFor(() => expect(layer()?.style.visibility).toBe("hidden"));

            // Near the right edge, it opens to the row's left.
            rowRect = DOMRect.fromRect({ x: 850, y: 100, width: 100, height: 24 });
            root.dispatchEvent(new Event("scroll"));
            await vi.waitFor(() => expect([ layer()?.style.left, layer()?.style.visibility ]).toEqual([ "702px", "visible" ]));
        });

        it("runs a submenu's row and closes everything, and keeps a submenu's row that only opens it", async () => {
            const picked: string[] = [];
            const contextMenu = await openMenu((title) => picked.push(title));

            // Nothing to run, so the menu stays up with its submenu open.
            press(row("Templates"));
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ] ]));
            expect(contextMenu.isShown).toBe(true);

            press(row("Meeting"));
            await vi.waitFor(() => expect(layers()).toEqual([ [ "Meeting" ], [ "Weekly" ] ]));
            press(row("Weekly"));
            expect(picked).toEqual([ "Templates", "Meeting", "Weekly" ]);
            expect(contextMenu.isShown).toBe(false);

            // A row with a command of its own runs it, like any other.
            await openMenu((title) => picked.push(title));
            press(row("Insert child note"));
            expect(picked.at(-1)).toBe("Insert child note");
        });

        it("lays a submenu with columns out on an element of its own, so a capped layer scrolls them", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [ { title: "Insert child note", items: noteTypes, columns: 2 } ]
            });

            hover(row("Insert child note"));
            await vi.waitFor(() => expect(menuElement()?.querySelector("div.dropdown-submenu > ul > .tn-menu-columns")).not.toBeNull());
            const columns = menuElement()?.querySelector<HTMLElement>(".tn-menu-columns");
            expect(columns?.style.columnCount).toBe("2");
            expect(columns?.textContent).toBe("TextCode");
        });

        it("keeps a header with the row after it, and a separator with the rows around it, in one column", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            const columnItems = [
                { title: "Text" }, { title: "Code" },
                { kind: "separator" as const },
                { title: "Templates", kind: "header" as const },
                { title: "Meeting" }, { title: "Weekly" }
            ];
            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Insert child note", items: columnItems, columns: 2 },
                    { title: "Insert note after", items: columnItems }
                ]
            });
            /** The layer's rows, a group of rows that must not break as the list of its rows. */
            const layout = (list: Element | null | undefined) => [ ...list?.children ?? [] ].map((child) =>
                child.classList.contains("dropdown-no-break")
                    ? [ ...child.children ].map((grouped) => grouped.textContent || "---")
                    : child.textContent || "---");

            hover(row("Insert child note"));
            await vi.waitFor(() => expect(menuElement()?.querySelector(".tn-menu-columns")).not.toBeNull());
            expect(layout(menuElement()?.querySelector(".tn-menu-columns"))).toEqual([
                "Text", [ "Code", "---", "Templates", "Meeting" ], "Weekly"
            ]);

            // A single column has no breaks to avoid, so nothing is grouped.
            hover(row("Insert note after"));
            await vi.waitFor(() => expect(menuElement()?.querySelector(".tn-menu-columns")).toBeNull());
            expect(layout(menuElement()?.querySelector("div.dropdown-submenu > ul"))).toEqual([
                "Text", "Code", "---", "Templates", "Meeting", "Weekly"
            ]);
        });

        it("unfolds a submenu under its row on a phone", async () => {
            layout.onMobile = true;
            const picked: string[] = [];
            await openMenu((title) => picked.push(title));
            const parent = row("Templates");

            hover(parent);
            expect(layers()).toEqual([]);

            press(parent);
            await vi.waitFor(() => expect(parent.classList.contains("submenu-open")).toBe(true));
            const nested = parent.querySelector(":scope > ul.dropdown-menu");
            expect(nested?.classList.contains("show")).toBe(true);
            expect(nested?.textContent).toBe("Meeting");
            // Unfolding runs nothing.
            expect(picked).toEqual([]);
            expect(layers()).toEqual([]);

            press(parent);
            await vi.waitFor(() => expect(parent.classList.contains("submenu-open")).toBe(false));
        });
    });

    it("keeps a right-click or a long press inside it to itself, at every level", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();
        // Such as a host that would open a menu of its own, or Electron's for the editor.
        const heard = vi.fn();
        document.addEventListener("contextmenu", heard);

        await contextMenu.show({
            x: 10, y: 10, selectMenuItemHandler: () => {},
            items: [ { title: "Copy" }, { title: "Templates", items: [ { title: "Meeting" } ] } ]
        });
        const rows = [ ...menuElement()?.querySelectorAll<HTMLElement>("li.dropdown-item") ?? [] ];
        rows[1]?.dispatchEvent(new PointerEvent("pointerenter"));
        await vi.waitFor(() => expect(menuElement()?.querySelector("div.dropdown-submenu li")).not.toBeNull());
        const targets = [ rows[0], menuElement(), menuElement()?.querySelector("div.dropdown-submenu li") ];
        expect(targets.every(Boolean)).toBe(true);

        for (const target of targets) {
            const rightClick = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
            target?.dispatchEvent(rightClick);
            // The browser's own menu does not open over it.
            expect(rightClick.defaultPrevented).toBe(true);
        }
        expect(heard).not.toHaveBeenCalled();
        expect(contextMenu.isShown).toBe(true);
        document.removeEventListener("contextmenu", heard);
    });

    describe("on a phone", () => {
        afterEach(() => {
            layout.onMobile = false;
        });

        it("rises from the bottom as a sheet, which the stylesheet places and caps", async () => {
            layout.onMobile = true;
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({ x: 10, y: 20, items, selectMenuItemHandler: () => {} });

            const menu = menuElement();
            expect(menu?.classList.contains("mobile-bottom-menu")).toBe(true);
            await vi.waitFor(() => expect(menu?.style.visibility).toBe("visible"));
            // Nothing inline for the sheet's rules to contend with: its `max-height` is not `!important`.
            expect([ menu?.style.left, menu?.style.top, menu?.style.maxHeight ]).toEqual([ "", "", "" ]);
        });

        it("opens at the pointer instead when the caller asks", async () => {
            layout.onMobile = true;
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({ x: 10, y: 20, items, selectMenuItemHandler: () => {}, forcePositionOnMobile: true });

            const menu = menuElement();
            expect(menu?.classList.contains("mobile-bottom-menu")).toBe(false);
            await vi.waitFor(() => expect(menu?.style.visibility).toBe("visible"));
            expect(menu?.style.left).not.toBe("");
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

    describe("dismissal", () => {
        function pressOn(target: Element | null | undefined, init: PointerEventInit = {}) {
            target?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0, ...init }));
        }

        it("hides on a press outside it, with any button, even one its target stops", async () => {
            buildPage();
            const app = document.getElementById("app");
            // As the note tree and the calendar stop their own presses and clicks.
            app?.addEventListener("pointerdown", (e) => e.stopPropagation());
            app?.addEventListener("click", (e) => e.stopPropagation());
            const contextMenu = await buildContextMenu();

            await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
            pressOn(app);
            expect(contextMenu.isShown).toBe(false);

            // Ctrl+right-click, which opens a note in a popup instead of a menu, and fires no click.
            await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
            pressOn(app, { button: 2, ctrlKey: true });
            expect(contextMenu.isShown).toBe(false);
        });

        it("stays up on a press or a click inside it that runs nothing", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [ { kind: "header", title: "Colour" }, { title: "Red" } ]
            });
            const header = menuElement()?.querySelector(".dropdown-header");
            if (!header) throw new Error("expected a header");
            pressOn(header);
            header.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            expect(contextMenu.isShown).toBe(true);
        });

        it("hides on Escape, which goes no further", async () => {
            buildPage();
            const contextMenu = await buildContextMenu();
            // A dialog under the menu, which Escape would otherwise close too.
            const dialogHeard = vi.fn();
            document.addEventListener("keydown", dialogHeard);

            await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            expect(contextMenu.isShown).toBe(false);
            expect(dialogHeard).not.toHaveBeenCalled();

            // With no menu up, Escape is left to whatever else listens.
            document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
            expect(dialogHeard).toHaveBeenCalledTimes(1);
            document.removeEventListener("keydown", dialogHeard);
        });

        it("says whether the press behind a click put a menu away, for a host that acts on neither", async () => {
            buildPage();
            const app = document.getElementById("app");
            const contextMenu = await buildContextMenu();
            const click = () => app?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

            await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
            pressOn(app);
            expect(contextMenu.dismissedByLastPress).toBe(true);

            // Only until the click that press makes has been handled.
            click();
            await vi.waitFor(() => expect(contextMenu.dismissedByLastPress).toBe(false));

            // A press with no menu up put nothing away.
            pressOn(app);
            expect(contextMenu.dismissedByLastPress).toBe(false);
        });
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

        expect(contextMenu.isShown).toBe(false);

        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
        expect(contextMenu.isShown).toBe(true);

        await contextMenu.hide();
        expect(contextMenu.isShown).toBe(false);
    });
});
