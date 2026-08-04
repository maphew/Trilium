/**
 * The controls over a geo map, which used to be MapLibre's own — white boxes on a map that may well
 * be dark, dressed in neither Trilium's buttons nor its colors. What is checked here is what they
 * did for us: the two steps, a step that would carry the map past either end of the range it is
 * allowed being refused rather than merely doing nothing, the readout between the steps saying how
 * close in the map is, and the screen being given and taken back.
 */
import type { Map as MapLibreGLMap } from "maplibre-gl";
import { render } from "preact";
import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import { ParentMap } from "./map";
import MapToolbar from "./MapToolbar";

/** The order the group lays its buttons out in — the image viewer's, with the screen at the end. */
const ZOOM_OUT = 0;
const ZOOM_LEVEL = 1;
const ZOOM_IN = 2;
const FULLSCREEN = 3;

/** A map that zooms, says so, and stands somewhere — all these controls ask of one. */
function fakeMap({ zoom = 5, minZoom = 2, maxZoom = 22 } = {}) {
    const listeners = new Set<() => void>();
    const container = document.createElement("div");
    container.requestFullscreen = vi.fn(async () => {});
    document.body.appendChild(container);

    const setZoom = (value: number) => {
        zoom = Math.min(Math.max(value, minZoom), maxZoom);
        for (const listener of listeners) listener();
    };

    return {
        getZoom: () => zoom,
        getMinZoom: () => minZoom,
        getMaxZoom: () => maxZoom,
        getContainer: () => container,
        zoomIn: vi.fn(() => setZoom(zoom + 1)),
        zoomOut: vi.fn(() => setZoom(zoom - 1)),
        /** The map being zoomed by something other than these buttons — the wheel, or a pinch. */
        zoomTo: setZoom,
        on: (event: string, listener: () => void) => { if (event === "zoom") listeners.add(listener); },
        off: (event: string, listener: () => void) => { if (event === "zoom") listeners.delete(listener); },
        get listenerCount() { return listeners.size; }
    };
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

/** Builds the controls over a map and settles them, so they are listening before being spoken to. */
function renderToolbar(map: ReturnType<typeof fakeMap> | null) {
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <MapToolbar />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the toolbar was not rendered");
    return container;
}

function buttons(container: HTMLElement) {
    return [ ...container.querySelectorAll<HTMLButtonElement>(".tn-overlay-control-group button") ];
}

function press(container: HTMLElement, index: number) {
    act(() => buttons(container)[index].click());
}

describe("geo map MapToolbar", () => {
    it("offers what the map's own controls did, laid out as the image viewer's group", () => {
        const container = renderToolbar(fakeMap());

        expect(buttons(container).map((button) => button.className)).toEqual([
            expect.stringContaining("bx-minus-circle"),
            expect.stringContaining("tn-overlay-text-button"),
            expect.stringContaining("bx-plus-circle"),
            expect.stringContaining("bx-fullscreen")
        ]);
    });

    it("stands aside until there is a map to zoom", () => {
        const container = renderToolbar(null);

        expect(buttons(container)).toHaveLength(0);
    });

    it("zooms the map in either direction", () => {
        const map = fakeMap();
        const container = renderToolbar(map);

        press(container, ZOOM_IN);
        expect(map.zoomIn).toHaveBeenCalled();

        press(container, ZOOM_OUT);
        expect(map.zoomOut).toHaveBeenCalled();
    });

    it("says how close in the map is, in whole levels, following the wheel as much as the buttons", () => {
        const map = fakeMap({ zoom: 5 });
        const container = renderToolbar(map);
        expect(buttons(container)[ZOOM_LEVEL].textContent).toBe("5");

        // As the wheel or a pinch would — landing between levels, which the readout does not split.
        act(() => map.zoomTo(13.6));

        expect(buttons(container)[ZOOM_LEVEL].textContent).toBe("14");
        // The readout is told, not asked: unlike the image viewer's, pressing it resets nothing.
        expect(buttons(container)[ZOOM_LEVEL].disabled).toBe(true);
    });

    it("disables the step that would carry the map past the range it is allowed", () => {
        const atTheTop = renderToolbar(fakeMap({ zoom: 22 }));
        expect(buttons(atTheTop)[ZOOM_IN].disabled).toBe(true);
        expect(buttons(atTheTop)[ZOOM_OUT].disabled).toBe(false);

        const atTheBottom = renderToolbar(fakeMap({ zoom: 2 }));
        expect(buttons(atTheBottom)[ZOOM_IN].disabled).toBe(false);
        expect(buttons(atTheBottom)[ZOOM_OUT].disabled).toBe(true);
    });

    it("follows the zoom as the map reports it, not only as the buttons set it", () => {
        const map = fakeMap({ zoom: 5, maxZoom: 6 });
        const container = renderToolbar(map);
        expect(buttons(container)[ZOOM_IN].disabled).toBe(false);

        // As the wheel or a pinch would.
        act(() => map.zoomTo(6));

        expect(buttons(container)[ZOOM_IN].disabled).toBe(true);
    });

    it("gives the map the screen and takes it back, saying which it is offering", () => {
        const map = fakeMap();
        const container = renderToolbar(map);

        press(container, FULLSCREEN);
        // The map itself goes on the screen, not the note's chrome around it.
        expect(map.getContainer().requestFullscreen).toHaveBeenCalled();

        setFullscreenElement(map.getContainer());
        expect(buttons(container)[FULLSCREEN].className).toContain("bx-exit-fullscreen");

        press(container, FULLSCREEN);
        expect(document.exitFullscreen).toHaveBeenCalled();
    });

    it("follows a screen left by pressing Escape rather than by the button", () => {
        const map = fakeMap();
        const container = renderToolbar(map);

        setFullscreenElement(map.getContainer());
        expect(buttons(container)[FULLSCREEN].className).toContain("bx-exit-fullscreen");

        setFullscreenElement(null);

        expect(buttons(container)[FULLSCREEN].className).toContain("bx-fullscreen");
    });

    it("stops listening to a map it is taken off", () => {
        const map = fakeMap();
        const container = renderToolbar(map);
        expect(map.listenerCount).toBe(1);

        // A map torn down under controls that stayed behind would go on being reported to.
        act(() => { render(null, container); });

        expect(map.listenerCount).toBe(0);
    });
});
