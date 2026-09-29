import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Popup, { type PopupProps } from "./Popup";

describe("Popup", () => {
    const host = document.createElement("div");
    document.body.append(host);
    let anchor: HTMLButtonElement;

    beforeEach(() => {
        anchor = document.createElement("button");
        document.body.append(anchor);
        // Floating UI reads the viewport from the root element's client size, and the popup's own
        // size from its offset size; happy-dom lays out nothing.
        vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
        vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(200);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(100);
    });

    afterEach(() => {
        render(null, host);
        anchor.remove();
        vi.restoreAllMocks();
        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    });

    function anchorAt(x: number, y: number) {
        vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(DOMRect.fromRect({ x, y, width: 80, height: 30 }));
    }

    /** Renders the popup and waits for it to be placed, which is when it shows. */
    async function open(props: Partial<PopupProps> = {}) {
        render(<Popup anchor={anchor} onDismiss={() => {}} {...props}><span>content</span></Popup>, host);
        const popup = document.querySelector<HTMLElement>(".tn-popup");
        if (!popup) throw new Error("expected the popup to render");
        await vi.waitFor(() => expect(popup.style.visibility).toBe("visible"));
        return popup;
    }

    it("stands in the page's body, below its anchor and lined up with its start", async () => {
        anchorAt(100, 50);
        const popup = await open({ className: "dropdown-menu", role: "menu" });

        expect(popup.parentElement).toBe(document.body);
        expect([ ...popup.classList ]).toEqual([ "tn-popup", "dropdown-menu" ]);
        expect(popup.getAttribute("role")).toBe("menu");
        expect(popup.textContent).toBe("content");
        expect([ popup.style.left, popup.style.top ]).toEqual([ "100px", "80px" ]);
    });

    it("keeps the gap it is given from its anchor", async () => {
        anchorAt(100, 50);
        const popup = await open({ offset: 2 });

        expect(popup.style.top).toBe("82px");
    });

    it("flips above its anchor where there is no room below, and caps its height to the room it has", async () => {
        anchorAt(100, 740);
        const popup = await open();
        // 740 - 100: it ends where the anchor starts.
        expect(popup.style.top).toBe("640px");

        render(null, host);
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
        anchorAt(100, 300);
        const tall = await open();
        // The side with the most room, less the gap it keeps from the viewport's edges.
        expect(tall.style.maxHeight).toBe(`${800 - 330 - 5}px`);
    });

    it("grows past the viewport without its height cap, stands in a wrapper it is given, and says when it is placed", async () => {
        vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockReturnValue(1000);
        anchorAt(100, 300);
        const onPlaced = vi.fn();
        const popup = await open({ capHeight: false, portalClassName: "tn-dropdown-portal note-actions", onPlaced });

        expect(popup.style.maxHeight).toBe("");
        expect(popup.parentElement?.className).toBe("tn-dropdown-portal note-actions");
        expect(popup.parentElement?.parentElement).toBe(document.body);
        expect(onPlaced).toHaveBeenCalledTimes(1);
    });

    it("says nothing of a placement that settles once it has closed", async () => {
        anchorAt(100, 50);
        const onPlaced = vi.fn();
        render(<Popup anchor={anchor} onPlaced={onPlaced}>content</Popup>, host);
        // Closed before the placement it started has settled, as a row picked at once closes a menu.
        render(null, host);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(onPlaced).not.toHaveBeenCalled();
    });

    it("opens at a point, as a menu opened where a right-click landed does", async () => {
        const popup = await open({ anchor: { x: 300, y: 200 }, placement: "right-start" });

        expect([ popup.style.left, popup.style.top ]).toEqual([ "300px", "200px" ]);
    });

    it("stands inside whatever has the screen, which is all a browser paints then", async () => {
        const fullscreen = document.createElement("div");
        document.body.append(fullscreen);
        Object.defineProperty(document, "fullscreenElement", { value: fullscreen, configurable: true });
        anchorAt(100, 50);

        const popup = await open();
        expect(popup.parentElement).toBe(fullscreen);
        fullscreen.remove();
    });

    it("is dismissed by a press outside it and its anchor, and by Escape, which goes no further", async () => {
        anchorAt(100, 50);
        const onDismiss = vi.fn();
        const popup = await open({ onDismiss });
        const pressOn = (target: Element) => target.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        // As the note tree stops its own presses.
        const outside = document.createElement("div");
        outside.addEventListener("pointerdown", (e) => e.stopPropagation());
        document.body.append(outside);

        pressOn(popup.firstElementChild ?? popup);
        // The anchor is a dropdown's toggle, which opens and closes the popup itself.
        pressOn(anchor);
        expect(onDismiss).not.toHaveBeenCalled();

        pressOn(outside);
        expect(onDismiss).toHaveBeenCalledWith("outside");

        const dialogHeard = vi.fn();
        document.addEventListener("keydown", dialogHeard);
        popup.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        expect(onDismiss).toHaveBeenLastCalledWith("escape");
        expect(dialogHeard).not.toHaveBeenCalled();
        document.removeEventListener("keydown", dialogHeard);
        outside.remove();
    });
});
