import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import Dropdown from "./Dropdown";

// Bootstrap is left real here — unlike Dropdown.spec.tsx, which mocks it away to assert the component's
// wiring — because what is under test is which element Bootstrap ends up attached to.

class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
}
globalThis.ResizeObserver = globalThis.ResizeObserver ?? (ResizeObserverStub as unknown as typeof ResizeObserver);

describe("Dropdown tooltip", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
        for (const orphan of document.querySelectorAll(".tooltip")) {
            orphan.remove();
        }
    });

    it("hangs the tooltip off the toggle rather than off the wrapper the open menu sits in", () => {
        act(() => render(<Dropdown title="Show help" iconAction hideToggleArrow>item</Dropdown>, container));

        const wrapper = container.querySelector(".dropdown");
        const toggle = container.querySelector("button");
        const menu = container.querySelector(".dropdown-menu");
        expect(toggle).not.toBeNull();
        expect(menu).not.toBeNull();

        // Bootstrap takes the `title` of whatever it is initialised on over to `data-bs-original-title`
        // — so this says which element it is driving the hover of, without reaching into its internals.
        expect(toggle?.getAttribute("data-bs-original-title"), "driven by the toggle").toBe("Show help");
        expect(wrapper?.getAttribute("data-bs-original-title"), "not by the wrapper").toBeNull();

        // Which is the point of it: the wrapper holds the menu as well, so a tooltip driven by the
        // wrapper stayed up over the menu the pointer had moved into. The toggle never holds the menu.
        expect(wrapper?.contains(menu ?? null), "the wrapper holds the menu").toBe(true);
        expect(toggle?.contains(menu ?? null), "the toggle does not").toBe(false);

        // And with nothing left on the wrapper, the browser's own tooltip can't double up with ours.
        expect(wrapper?.getAttribute("title")).toBeNull();
        expect(toggle?.getAttribute("title"), "handed over to Bootstrap").toBeNull();
    });
});
