/**
 * The map that cannot be built at all.
 *
 * MapLibre draws through WebGL and has no other way to draw, so a browser that will not give it a
 * context — WebGL turned off, or a GPU that is unavailable with no software fallback — makes the
 * constructor throw. Nothing caught it, and since the throw happens inside an effect with no error
 * boundary over the widgets, what the user got was the empty container the map would have filled:
 * a blank panel and a console message they never see. It says what happened now.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type MapLayer } from "./map_layer";

/** What MapLibre throws when it cannot get a context, message and all. */
const WEBGL_FAILURE_MESSAGE = JSON.stringify({
    statusMessage: "Could not create a WebGL context, GL_VENDOR = Disabled, GL_RENDERER = Disabled",
    type: "webglcontextcreationerror",
    message: "Failed to initialize WebGL"
});

/** The constructor of a browser that will not give MapLibre a context. */
function failingMap(): never {
    throw new Error(WEBGL_FAILURE_MESSAGE);
}

const { MapConstructor } = vi.hoisted(() => ({ MapConstructor: vi.fn() }));

vi.mock("maplibre-gl", () => ({
    Map: MapConstructor,
    ScaleControl: class {},
    AttributionControl: class {}
}));

vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

// t() returns the key, so the assertion below is on which message is shown rather than on its
// English wording.
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

const LAYER: MapLayer = {
    name: "OpenStreetMap",
    type: "raster",
    url: "https://tile.example.org/{z}/{x}/{y}.png",
    attribution: "&copy; Example"
};

/** The last map built, for the tests that ask what was done to it. */
let lastMap: ReturnType<typeof buildWorkingMap> | undefined;

/**
 * A map that builds, recording only the little the component asks of it.
 *
 * A `function` rather than an arrow: the component calls this through `new`, and Vitest refuses to
 * construct a mock whose implementation is not constructible.
 */
function workingMap(this: unknown) {
    lastMap = buildWorkingMap();
    return lastMap;
}

/**
 * What such a map does, including the part of MapLibre's own bookkeeping that matters here: a map
 * being removed hands every control it holds its notice and forgets them all, and `removeControl`
 * passes that notice on whether the map still holds the control or not — so a control told twice
 * reaches for the map it has already let go of.
 */
function buildWorkingMap() {
    const controls = new Set<unknown>();
    let removed = false;

    return {
        addControl: vi.fn((control: unknown) => { controls.add(control); }),
        removeControl: vi.fn((control: unknown) => {
            if (removed) {
                throw new TypeError(`can't access property "off", this._map is undefined`);
            }
            controls.delete(control);
        }),
        hasControl: vi.fn((control: unknown) => controls.has(control)),
        remove: vi.fn(() => {
            removed = true;
            controls.clear();
        }),
        on: vi.fn(),
        off: vi.fn(),
        once: vi.fn(),
        resize: vi.fn(),
        setStyle: vi.fn(),
        setCenter: vi.fn(),
        setZoom: vi.fn(),
        getCenter: () => ({ lat: 0, lng: 0 }),
        getZoom: () => 2
    };
}

describe("Map initialization", () => {
    let container: HTMLElement;
    let Map: typeof import("./map").default;
    let warn: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
        ({ default: Map } = await import("./map"));
        container = document.createElement("div");
        document.body.appendChild(container);
        warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.clearAllMocks();
        warn.mockRestore();
    });

    /** Puts the map up, with whatever the mocked constructor has been told to do. */
    function renderMap({ scale = false } = {}) {
        act(() => {
            render(
                <Map
                    coordinates={{ lat: 0, lng: 0 }}
                    zoom={2}
                    layerData={LAYER}
                    viewportChanged={vi.fn()}
                    scale={scale}
                >
                    <div className="map-child">A child of the map</div>
                </Map>,
                container
            );
        });
    }

    it("says why there is no map, rather than leaving the panel blank", () => {
        MapConstructor.mockImplementation(failingMap);

        renderMap();

        // The placeholder stands where the map would have been...
        const placeholder = container.querySelector(".no-items");
        expect(placeholder).not.toBeNull();
        // i18next is not initialized in the client tests, so a key renders as itself.
        expect(placeholder?.textContent).toContain("geo-map.webgl-unavailable");

        // ...the children are not rendered, since they have no map to draw on...
        expect(container.querySelector(".map-child")).toBeNull();

        // ...and the reason is reported once, without a stack.
        expect(warn).toHaveBeenCalledOnce();
        expect(warn.mock.calls[0][0]).toContain("Could not create a WebGL context");
    });

    it("keeps the container, so a remount has somewhere to build", () => {
        MapConstructor.mockImplementation(failingMap);

        renderMap();

        expect(container.querySelector(".geo-map-container")).not.toBeNull();
    });

    it("draws the children and no placeholder when the map builds", () => {
        MapConstructor.mockImplementation(workingMap);

        renderMap();

        expect(container.querySelector(".no-items")).toBeNull();
        expect(container.querySelector(".map-child")).not.toBeNull();
    });

    /**
     * Leaving a geo map for another note, which used to throw where nobody could catch it: the scale
     * was taken off a map that had already gone, and a control given its notice twice reaches for the
     * map it has let go of.
     */
    it("leaves a scale to the teardown of the map that holds it", () => {
        MapConstructor.mockImplementation(workingMap);
        renderMap({ scale: true });
        expect(lastMap?.addControl).toHaveBeenCalled();

        expect(() => act(() => { render(null, container); })).not.toThrow();

        expect(lastMap?.remove).toHaveBeenCalled();
        expect(lastMap?.removeControl).not.toHaveBeenCalled();
    });

    it("takes the scale off a map that is staying", () => {
        MapConstructor.mockImplementation(workingMap);
        renderMap({ scale: true });

        // The scale switched off while the map goes on being read, which is the one time this
        // cleanup has anything to do.
        renderMap({ scale: false });

        expect(lastMap?.removeControl).toHaveBeenCalledOnce();
        expect(lastMap?.remove).not.toHaveBeenCalled();
    });
});
