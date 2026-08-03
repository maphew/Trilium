import type { MindElixirInstance } from "mind-elixir";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import MapToolbar from "./MapToolbar";

/**
 * A stand-in for the Mind Elixir instance exposing only what the toolbar touches: the scale and its
 * range, the element that goes fullscreen, the map's own transform, and the ways it is moved.
 */
function buildMind({ scaleVal = 1 } = {}) {
    const el = document.createElement("div");
    el.requestFullscreen = vi.fn(async () => {});
    document.body.appendChild(el);

    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    const scale = vi.fn((value: number) => {
        mind.scaleVal = value;
        for (const listener of listeners.get("scale") ?? []) listener(value);
    });

    const mind = {
        el,
        container: { getBoundingClientRect: () => ({ width: 800, height: 600 }) },
        map: { style: { transform: "translate3d(0px, 0px, 0) scale(1)" } },
        scaleVal,
        scaleSensitivity: 0.1,
        scaleMin: 0.2,
        scaleMax: 1.4,
        scale,
        toCenter: vi.fn(),
        move: vi.fn(),
        bus: {
            addListener: (type: string, listener: (...args: unknown[]) => void) => {
                listeners.set(type, [ ...(listeners.get(type) ?? []), listener ]);
            },
            removeListener: (type: string, listener: (...args: unknown[]) => void) => {
                listeners.set(type, (listeners.get(type) ?? []).filter((held) => held !== listener));
            }
        }
    } as unknown as MindElixirInstance;

    return mind;
}

/** The order the toolbar lays its buttons out in. */
const ZOOM_IN = 0;
const ZOOM_OUT = 1;
const CENTER = 2;
const FULLSCREEN = 3;

/** Builds the bar and settles it, so that what it listens to is listened to before it is spoken to. */
function renderToolbar(mind: MindElixirInstance) {
    let container: HTMLElement | undefined;
    act(() => { container = renderInto(<MapToolbar mind={mind} />); });
    if (!container) throw new Error("the toolbar was not rendered");
    return container;
}

function buttons(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLButtonElement>(".mind-map-toolbar button") ];
}

function press(container: HTMLElement, index: number) {
    act(() => buttons(container)[index].click());
}

/** Puts the document in or out of fullscreen and tells whoever is listening, as the browser does. */
function setFullscreenElement(element: Element | null) {
    Object.defineProperty(document, "fullscreenElement", { value: element, configurable: true });
    act(() => { document.dispatchEvent(new Event("fullscreenchange")); });
}

beforeEach(() => {
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    document.exitFullscreen = vi.fn(async () => {});
});

describe("MapToolbar", () => {
    it("offers the four things the map's own bar did, in one row", () => {
        const container = renderToolbar(buildMind());

        expect(buttons(container)).toHaveLength(4);
        expect(buttons(container)[CENTER].className).toContain("bx-current-location");
        expect(buttons(container)[FULLSCREEN].className).toContain("bx-fullscreen");
    });

    it("zooms by one step of the map's own sensitivity, in either direction", () => {
        const mind = buildMind();
        const container = renderToolbar(mind);

        press(container, ZOOM_IN);
        expect(vi.mocked(mind.scale).mock.calls[0][0]).toBeCloseTo(1.1);

        press(container, ZOOM_OUT);
        expect(vi.mocked(mind.scale).mock.calls[1][0]).toBeCloseTo(1);
    });

    it("disables the step that would carry the map past the scale it is allowed", () => {
        const mind = buildMind({ scaleVal: 1.35 });
        const container = renderToolbar(mind);

        expect(buttons(container)[ZOOM_IN].disabled).toBe(true);
        expect(buttons(container)[ZOOM_OUT].disabled).toBe(false);
    });

    it("follows the scale as the map reports it, not only as the buttons set it", () => {
        const mind = buildMind({ scaleVal: 1 });
        const container = renderToolbar(mind);
        expect(buttons(container)[ZOOM_IN].disabled).toBe(false);

        // As the wheel or a fit of the map would.
        act(() => mind.scale(1.4));

        expect(buttons(container)[ZOOM_IN].disabled).toBe(true);
    });

    it("centres the map", () => {
        const mind = buildMind();
        const container = renderToolbar(mind);

        press(container, CENTER);

        expect(mind.toCenter).toHaveBeenCalled();
    });

    it("gives the map the screen and takes it back, saying which it is offering", () => {
        const mind = buildMind();
        const container = renderToolbar(mind);

        press(container, FULLSCREEN);
        expect(mind.el.requestFullscreen).toHaveBeenCalled();

        setFullscreenElement(mind.el);
        expect(buttons(container)[FULLSCREEN].className).toContain("bx-exit-fullscreen");

        press(container, FULLSCREEN);
        expect(document.exitFullscreen).toHaveBeenCalled();
    });

    it("puts back what was in the middle of the view once the screen has changed size", () => {
        const mind = buildMind();
        const container = renderToolbar(mind);

        press(container, FULLSCREEN);
        // The middle of the map was 400/300 from its origin; the screen it lands on is larger.
        mind.container.getBoundingClientRect = () => ({ width: 1920, height: 1080 }) as DOMRect;
        setFullscreenElement(mind.el);

        expect(mind.move).toHaveBeenCalledWith((1920 - 800) / 2, (1080 - 600) / 2);
    });

    it("leaves the map alone on a change of screen it was not asked for", () => {
        const mind = buildMind();
        const container = renderToolbar(mind);

        press(container, FULLSCREEN);
        setFullscreenElement(mind.el);
        vi.mocked(mind.move).mockClear();

        // Left by pressing Escape rather than the button, so there is no point to put back — as
        // there was none in the map's own bar.
        setFullscreenElement(null);

        expect(mind.move).not.toHaveBeenCalled();
        expect(buttons(container)[FULLSCREEN].className).toContain("bx-fullscreen");
    });
});
