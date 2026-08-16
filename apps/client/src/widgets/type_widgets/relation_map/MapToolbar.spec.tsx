import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

// The bootstrap tooltip the buttons wear needs real layout, which happy-dom hasn't.
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    useStaticTooltip: () => {}
}));
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

import MapToolbar, { type MapCommand } from "./MapToolbar";

let container: HTMLDivElement;

afterEach(() => {
    act(() => render(null, container));
    container.remove();
});

describe("MapToolbar", () => {
    it("says the scale the map is drawn at, following it as the map is moved", () => {
        const map = fakeMap();
        mount(map);

        expect(readout().textContent).toBe("100%");

        act(() => map.moveTo(2.5));
        expect(readout().textContent).toBe("250%");

        // A pan leaves the scale where it was, so the readout says the same thing.
        act(() => map.moveTo(2.5));
        expect(readout().textContent).toBe("250%");
    });

    it("leaves a step with no room left to it disabled", () => {
        const map = fakeMap();
        mount(map);

        expect([ zoomOut().disabled, zoomIn().disabled ]).toEqual([ false, false ]);

        act(() => map.moveTo(MIN_ZOOM));
        expect([ zoomOut().disabled, zoomIn().disabled ]).toEqual([ true, false ]);

        act(() => map.moveTo(MAX_ZOOM));
        expect([ zoomOut().disabled, zoomIn().disabled ]).toEqual([ false, true ]);
    });

    it("asks for what each button stands for rather than moving the map itself", () => {
        const commands: MapCommand[] = [];
        const map = fakeMap();
        mount(map, (command) => commands.push(command));

        act(() => zoomOut().click());
        act(() => readout().click());
        act(() => zoomIn().click());

        expect(commands).toEqual([ "relationMapResetZoomOut", "relationMapResetPanZoom", "relationMapResetZoomIn" ]);
        expect(map.transformListeners()).toBe(1);
    });

    it("stands aside while there is no map to read, and stops listening to one that is torn down", () => {
        const map = fakeMap();
        mount(undefined);
        expect(container.querySelector(".relation-map-toolbar")).toBeNull();

        mount(map);
        expect(map.transformListeners()).toBe(1);

        act(() => render(null, container));
        expect(map.transformListeners()).toBe(0);
    });
});

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 2;

/** A stand-in for panzoom: a scale that can be moved, told to whoever asked to be told. */
function fakeMap() {
    let scale = 1;
    const listeners = new Set<() => void>();

    return {
        getTransform: () => ({ x: 0, y: 0, scale }),
        getMinZoom: () => MIN_ZOOM,
        getMaxZoom: () => MAX_ZOOM,
        on: (_event: string, handler: () => void) => listeners.add(handler),
        off: (_event: string, handler: () => void) => listeners.delete(handler),
        /** Reports a move, as the library does for a pan as well as for a zoom. */
        moveTo: (newScale: number) => {
            scale = newScale;
            for (const listener of listeners) listener();
        },
        transformListeners: () => listeners.size
    };
}

function mount(map: ReturnType<typeof fakeMap> | undefined, onCommand: (command: MapCommand) => void = () => {}) {
    container ??= document.createElement("div");
    document.body.appendChild(container);
    act(() => render(
        <MapToolbar panZoom={map as unknown as Parameters<typeof MapToolbar>[0]["panZoom"]} onCommand={onCommand} />,
        container
    ));
    return container;
}

function buttons() {
    return container.querySelectorAll<HTMLButtonElement>(".relation-map-toolbar button");
}

const zoomOut = () => buttons()[0];
const readout = () => buttons()[1];
const zoomIn = () => buttons()[2];
