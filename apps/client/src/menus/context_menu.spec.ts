import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../services/note_tooltip", () => ({ default: { dismissAllTooltips: vi.fn() } }));

/** The page as the shell leaves it: the menu's own element, at the end of the body. */
function buildPage() {
    document.body.innerHTML = `<div id="app"></div><div id="context-menu-container"></div>`;
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
    it("renders the menu into its container and removes it on hide", async () => {
        const container = buildPage();
        const contextMenu = await buildContextMenu();
        const onHide = vi.fn();

        await contextMenu.show({ x: 10, y: 20, items, selectMenuItemHandler: () => {}, onHide });

        const menu = container?.querySelector<HTMLElement>(".tn-menu");
        expect(menu?.getAttribute("role")).toBe("menu");
        expect(document.body.classList.contains("context-menu-shown")).toBe(true);

        await contextMenu.hide();
        expect(container?.querySelector(".tn-menu")).toBeNull();
        expect(document.body.classList.contains("context-menu-shown")).toBe(false);
        expect(onHide).toHaveBeenCalledTimes(1);

        // A later click on the page hides nothing, so `onHide` does not run again.
        await contextMenu.hide();
        expect(onHide).toHaveBeenCalledTimes(1);
    });

    describe("items", () => {
        it("lists the items and separators in order, without repeating a separator", async () => {
            const container = buildPage();
            const contextMenu = await buildContextMenu();

            await contextMenu.show({
                x: 10, y: 10, selectMenuItemHandler: () => {},
                items: [
                    { title: "Cut" },
                    { title: "Copy" },
                    { kind: "separator" },
                    { kind: "separator" },
                    { title: "Paste" }
                ]
            });

            const rows = [ ...container?.querySelectorAll(".tn-menu > *") ?? [] ]
                .map(row => row.getAttribute("role") === "separator" ? "---" : row.textContent);
            expect(rows).toEqual([ "Cut", "Copy", "---", "Paste" ]);
            expect(container?.querySelector("[role=menuitem]")?.classList.contains("tn-menu-item")).toBe(true);
        });

        it("runs an item pressed with the primary button, then hides", async () => {
            const container = buildPage();
            const contextMenu = await buildContextMenu();
            const calls: string[] = [];
            const item = { title: "Copy", handler: () => { calls.push("handler"); } };

            await contextMenu.show({
                x: 10, y: 10, items: [ item ],
                selectMenuItemHandler: (selected) => { calls.push(`select ${selected.title}`); }
            });
            const row = container?.querySelector<HTMLElement>("[role=menuitem]");
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
            const container = buildPage();
            const contextMenu = await buildContextMenu();
            // Floating UI reads the viewport from the root element's client size.
            vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
            vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
            vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(options.width);
            vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(options.height);

            await contextMenu.show({ ...options, items, selectMenuItemHandler: () => {} });
            const menu = container?.querySelector<HTMLElement>(".tn-menu");
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
    });

    it("hides on a click anywhere on the page", async () => {
        buildPage();
        const contextMenu = await buildContextMenu();

        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
        document.getElementById("app")?.dispatchEvent(new MouseEvent("click", { bubbles: true }));

        expect(contextMenu.isShown()).toBe(false);
    });

    it("stands at the end of the page while nothing has the screen", async () => {
        const menu = buildPage();
        const contextMenu = await buildContextMenu();

        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });

        expect(menu?.parentElement).toBe(document.body);
    });

    it("moves inside whatever has the screen, and back once nothing does", async () => {
        const menu = buildPage();
        const contextMenu = await buildContextMenu();
        const map = document.getElementById("app");

        setFullscreenElement(map);
        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });
        // A browser paints only the fullscreen element, so a menu outside it never shows.
        expect(menu?.parentElement).toBe(map);

        setFullscreenElement(null);
        await contextMenu.show({ x: 10, y: 10, items, selectMenuItemHandler: () => {} });

        expect(menu?.parentElement).toBe(document.body);
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
