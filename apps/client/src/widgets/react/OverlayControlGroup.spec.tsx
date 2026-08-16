import { type ComponentChildren, render, type RefObject } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// The bootstrap tooltip needs real layout; capture what it would have been given instead.
const { staticTooltipSpy } = vi.hoisted(() => ({ staticTooltipSpy: vi.fn() }));
vi.mock("./hooks", () => ({ useStaticTooltip: staticTooltipSpy }));

import OverlayControlGroup, { OverlayControlButton } from "./OverlayControlGroup";

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    staticTooltipSpy.mockClear();
});

function mount(children: ComponentChildren) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(children, container));
    return container;
}

/** The tooltip config the hook was handed for the button bearing the given accessible name. */
function tooltipFor(label: string) {
    const call = staticTooltipSpy.mock.calls.find(
        (args) => (args[0] as RefObject<HTMLElement>).current?.getAttribute("aria-label") === label
    );
    return call?.[1] as { title: string; placement: string } | undefined;
}

describe("OverlayControlGroup", () => {
    it("renders a group of icon and text buttons, each labelled by its title", () => {
        mount(
            <OverlayControlGroup className="my-position">
                <OverlayControlButton title="Zoom out" icon="bx-minus-circle" />
                <OverlayControlButton title="Reset zoom" className="my-readout">100%</OverlayControlButton>
            </OverlayControlGroup>
        );

        expect(container.querySelector(".tn-overlay-control-group.my-position")).not.toBeNull();
        const [ icon, text ] = container.querySelectorAll("button");
        // A button is driven by its onClick and must never submit a form it happens to stand in.
        expect(icon.getAttribute("type")).toBe("button");
        expect(icon.className.split(" ")).toEqual(expect.arrayContaining([ "tn-overlay-icon-button", "bx", "bx-minus-circle" ]));
        expect(icon.getAttribute("aria-label")).toBe("Zoom out");
        // No icon given: drawn at a word's width, saying what it has to say through its children.
        expect(text.className.split(" ")).toEqual(expect.arrayContaining([ "tn-overlay-text-button", "my-readout" ]));
        expect(text.className).not.toContain("tn-overlay-icon-button");
        expect(text.getAttribute("aria-label")).toBe("Reset zoom");
        expect(text.textContent).toBe("100%");
    });

    it("leaves a readout to be named by what it shows, with nothing to say on hover", () => {
        mount(
            <OverlayControlGroup>
                <OverlayControlButton className="my-readout" disabled>3/12</OverlayControlButton>
            </OverlayControlGroup>
        );

        const readout = container.querySelector("button");
        expect(readout?.hasAttribute("aria-label")).toBe(false);
        expect(readout?.textContent).toBe("3/12");
        // No title, so the hook finds nothing to build a tooltip from.
        expect(staticTooltipSpy.mock.calls.at(-1)?.[1]?.title).toBeUndefined();
    });

    it("marks a button held down or refused when asked to", () => {
        mount(
            <OverlayControlGroup>
                <OverlayControlButton title="Placing" icon="bx-pin" active />
                <OverlayControlButton title="Refused" icon="bx-trip" disabled />
            </OverlayControlGroup>
        );

        const [ active, refused ] = container.querySelectorAll("button");
        expect(active.classList.contains("active")).toBe(true);
        expect(refused.disabled).toBe(true);
        expect(refused.classList.contains("active")).toBe(false);
    });

    it("gives each button a tooltip saying what its label does, opening the way the group says", () => {
        mount(
            <OverlayControlGroup titlePosition="bottom">
                <OverlayControlButton title="Zoom out" icon="bx-minus-circle" />
                <OverlayControlButton title="Elsewhere" icon="bx-pin" titlePosition="left" />
            </OverlayControlGroup>
        );

        expect(tooltipFor("Zoom out")).toEqual({ title: "Zoom out", placement: "bottom" });
        // A button placed unlike its neighbours overrides what the group hands down.
        expect(tooltipFor("Elsewhere")).toEqual({ title: "Elsewhere", placement: "left" });
    });

    it("opens tooltips away from the bottom edge unless told otherwise", () => {
        mount(
            <OverlayControlGroup>
                <OverlayControlButton title="Zoom in" icon="bx-plus-circle" />
            </OverlayControlGroup>
        );

        expect(tooltipFor("Zoom in")?.placement).toBe("top");
    });

    it("keeps the same tooltip config across renders that don't change it, so it isn't rebuilt", () => {
        const group = (label: string) => (
            <OverlayControlGroup>
                <OverlayControlButton title="Reset zoom">{label}</OverlayControlButton>
            </OverlayControlGroup>
        );
        mount(group("100%"));
        const first = staticTooltipSpy.mock.calls.at(-1)?.[1];

        // Only the readout changes — what the tooltip says and where it opens are untouched.
        act(() => render(group("250%"), container));

        expect(container.querySelector("button")?.textContent).toBe("250%");
        expect(staticTooltipSpy.mock.calls.at(-1)?.[1]).toBe(first);
    });
});
