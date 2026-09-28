import { beforeEach, describe, expect, it, vi } from "vitest";

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
        expect(menu?.textContent).toBe("Hello world");
        expect(document.body.classList.contains("context-menu-shown")).toBe(true);

        await contextMenu.hide();
        expect(container?.querySelector(".tn-menu")).toBeNull();
        expect(document.body.classList.contains("context-menu-shown")).toBe(false);
        expect(onHide).toHaveBeenCalledTimes(1);

        // A later click on the page hides nothing, so `onHide` does not run again.
        await contextMenu.hide();
        expect(onHide).toHaveBeenCalledTimes(1);
    });

    it("opens at the pointer and stays inside the viewport", async () => {
        const container = buildPage();
        const contextMenu = await buildContextMenu();
        Object.defineProperty(document.documentElement, "clientWidth", { value: 1000, configurable: true });
        Object.defineProperty(document.documentElement, "clientHeight", { value: 800, configurable: true });
        const menu = () => container?.querySelector<HTMLElement>(".tn-menu");

        await contextMenu.show({ x: 10, y: 20, items, selectMenuItemHandler: () => {} });
        expect([ menu()?.style.left, menu()?.style.top ]).toEqual([ "10px", "20px" ]);

        // happy-dom measures the menu as 0×0, so it is pushed back to the edge less the padding.
        await contextMenu.show({ x: 2000, y: 2000, items, selectMenuItemHandler: () => {} });
        await vi.waitFor(() => expect([ menu()?.style.left, menu()?.style.top ]).toEqual([ "995px", "795px" ]));
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
