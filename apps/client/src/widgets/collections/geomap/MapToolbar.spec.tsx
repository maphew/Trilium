/**
 * The zoom buttons, which used to be MapLibre's own `NavigationControl` — a white box on a map that
 * may well be dark, dressed in neither Trilium's buttons nor its colors. What is checked here is what
 * the control did for us: the two steps, and a step that would carry the map past either end of the
 * range it is allowed being refused rather than merely doing nothing.
 */
import type { Map as MapLibreGLMap } from "maplibre-gl";
import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import { ParentMap } from "./map";
import MapToolbar from "./MapToolbar";

/** The order the bar lays its buttons out in. */
const ZOOM_IN = 0;
const ZOOM_OUT = 1;

/** A map that only zooms and says so, which is all this bar asks of one. */
function fakeMap({ zoom = 5, minZoom = 2, maxZoom = 22 } = {}) {
    const listeners = new Set<() => void>();

    const setZoom = (value: number) => {
        zoom = Math.min(Math.max(value, minZoom), maxZoom);
        for (const listener of listeners) listener();
    };

    return {
        getZoom: () => zoom,
        getMinZoom: () => minZoom,
        getMaxZoom: () => maxZoom,
        zoomIn: vi.fn(() => setZoom(zoom + 1)),
        zoomOut: vi.fn(() => setZoom(zoom - 1)),
        /** The map being zoomed by something other than these buttons — the wheel, or a pinch. */
        zoomTo: setZoom,
        on: (event: string, listener: () => void) => { if (event === "zoom") listeners.add(listener); },
        off: (event: string, listener: () => void) => { if (event === "zoom") listeners.delete(listener); },
        get listenerCount() { return listeners.size; }
    };
}

/** Builds the bar over a map and settles it, so that it is listening before it is spoken to. */
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
    return [ ...container.querySelectorAll<HTMLButtonElement>(".tn-overlay-toolbar button") ];
}

function press(container: HTMLElement, index: number) {
    act(() => buttons(container)[index].click());
}

describe("geo map MapToolbar", () => {
    it("offers the two steps the map's own control did, in one row", () => {
        const container = renderToolbar(fakeMap());

        expect(buttons(container).map((button) => button.className)).toEqual([
            expect.stringContaining("bx-zoom-in"),
            expect.stringContaining("bx-zoom-out")
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

    it("stops listening to a map it is taken off", () => {
        const map = fakeMap();
        const container = renderToolbar(map);
        expect(map.listenerCount).toBe(1);

        // A map torn down under a bar that stayed behind would go on being reported to.
        act(() => { render(null, container); });

        expect(map.listenerCount).toBe(0);
    });
});
