import { render } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@excalidraw/excalidraw", () => ({ exportToSvg: vi.fn() }));
vi.mock("./Canvas", () => ({ CanvasEditor: MockCanvasEditor }));
vi.mock("./persistence", () => ({ useCanvasDrawingPersistence: () => ({}) }));

const canvasEditorProps = vi.fn();

/** Renders Excalidraw's focusable container after a render, as once its language loads. */
function MockCanvasEditor(props: { isDesktopLayout?: boolean }) {
    canvasEditorProps(props);
    const [ isLoaded, setIsLoaded ] = useState(false);
    useEffect(() => setIsLoaded(true), []);
    return isLoaded ? <div className="excalidraw" tabIndex={0} /> : <span className="loading" />;
}

// happy-dom has no ResizeObserver; the spec runs the callback itself.
let resizeCallback: (() => void) | undefined;
globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
        resizeCallback = callback;
    }
    observe() {}
    unobserve() {}
    disconnect() {}
} as unknown as typeof ResizeObserver;

const {
    default: CanvasDrawing, useIsToolbarOverPanel, useSidePanels
} = await import("./CanvasDrawing");

/** Horizontal edges by class name; happy-dom computes no layout. */
const edges: Record<string, { left: number; right: number }> = {
    "App-toolbar-container": { left: 200, right: 800 }
};

function Probe() {
    const rootRef = useRef<HTMLDivElement>(null);
    const isOver = useIsToolbarOverPanel(rootRef);
    return (
        <div ref={rootRef} className="probe" data-over={String(isOver)}>
            <div className="App-toolbar-container" />
        </div>
    );
}

describe("useIsToolbarOverPanel", () => {
    let container: HTMLElement;

    beforeEach(() => {
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
            const box = edges[this.className] ?? { left: 0, right: 0 };
            return { ...box, top: 0, bottom: 0, width: box.right - box.left, height: 0 } as DOMRect;
        });
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.restoreAllMocks();
    });

    async function mountPanel(left: number) {
        edges["App-menu__left"] = { left, right: left + 210 };
        await act(async () => {
            render(<Probe />, container);
        });
        const root = container.querySelector(".probe");
        expect(root?.getAttribute("data-over")).toBe("false");

        const panel = document.createElement("div");
        panel.className = "App-menu__left";
        await act(async () => {
            root?.append(panel);
            await Promise.resolve();
        });
        return root;
    }

    it("tells when the panel that mounts sits under the toolbar", async () => {
        const root = await mountPanel(700);
        expect(root?.getAttribute("data-over")).toBe("true");
    });

    it("leaves the panel at the top while it clears the toolbar, and follows resizes", async () => {
        const root = await mountPanel(810);
        expect(root?.getAttribute("data-over")).toBe("false");

        edges["App-menu__left"] = { left: 790, right: 1000 };
        await act(async () => resizeCallback?.());
        expect(root?.getAttribute("data-over")).toBe("true");
    });
});

describe("useSidePanels", () => {
    /** Boxes by class name, in pixels; happy-dom computes no layout. */
    const rects: Record<string, { left: number; top: number; right: number; bottom: number }> = {};
    let container: HTMLElement;
    let showPopover: ReturnType<typeof vi.fn>;

    function SidePanelProbe({ isEnabled, hasLibrary }: {
        isEnabled: boolean;
        hasLibrary: boolean;
    }) {
        const rootRef = useRef<HTMLDivElement>(null);
        useSidePanels(rootRef, isEnabled);
        return (
            <div className="scrolling-container">
                <div className="include-note-body active">
                    <div ref={rootRef} className="drawing">
                        {hasLibrary && <div className="Island sidebar default-sidebar" />}
                        <div className="App-menu__left" />
                    </div>
                </div>
            </div>
        );
    }

    beforeEach(() => {
        // A window of 1280 × 900 and a 1rem of 16px. The note area of the split is 750 × 700,
        // from 240 to 990 and from 100 to 800.
        Object.defineProperties(document.documentElement, {
            clientWidth: { value: 1280, configurable: true },
            clientHeight: { value: 900, configurable: true }
        });
        rects["scrolling-container"] = { left: 240, top: 100, right: 1000, bottom: 800 };
        rects.drawing = { left: 340, top: 200, right: 840, bottom: 520 };
        vi.spyOn(HTMLElement.prototype, "getBoundingClientRect")
            .mockImplementation(function (this: HTMLElement) {
                const { left, top, right, bottom } = rects[this.className] ?? rects.drawing;
                const size = { width: right - left, height: bottom - top };
                return { left, top, right, bottom, ...size } as DOMRect;
            });
        vi.spyOn(window, "getComputedStyle")
            .mockReturnValue({ fontSize: "16px" } as CSSStyleDeclaration);
        // happy-dom has no Popover API.
        showPopover = vi.fn();
        Object.defineProperty(HTMLElement.prototype, "showPopover", {
            value: showPopover,
            configurable: true
        });
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        render(null, container);
        container.remove();
        vi.restoreAllMocks();
        Reflect.deleteProperty(HTMLElement.prototype, "showPopover");
        Reflect.deleteProperty(document.documentElement, "clientWidth");
        Reflect.deleteProperty(document.documentElement, "clientHeight");
        Reflect.deleteProperty(document, "fullscreenElement");
    });

    async function mount(panelHeight: number, hasLibrary = false) {
        await act(async () => {
            render(<SidePanelProbe isEnabled={false} hasLibrary={hasLibrary} />, container);
        });
        const viewport = container.querySelector(".scrolling-container");
        const body = container.querySelector(".include-note-body");
        const panel = container.querySelector<HTMLElement>(".App-menu__left");
        const library = container.querySelector<HTMLElement>(".default-sidebar");
        if (!viewport || !body || !panel) {
            throw new Error("Expected the probe.");
        }
        Object.defineProperties(viewport, {
            clientWidth: { value: 750 },
            clientHeight: { value: 700 }
        });
        Object.defineProperties(panel, {
            offsetWidth: { value: 200 },
            offsetHeight: { value: panelHeight, configurable: true }
        });
        if (library) {
            Object.defineProperty(library, "offsetWidth", { value: 200 });
        }

        await act(async () => {
            render(<SidePanelProbe isEnabled hasLibrary={hasLibrary} />, container);
        });
        return { viewport, body, panel, library };
    }

    /** The position of `panel` beside the drawing, or `false` while it is in the drawing. */
    function getPlacement(panel: HTMLElement | null) {
        const isPlaced = !!panel?.hasAttribute("data-side-panel");
        expect(panel?.getAttribute("popover") ?? null).toBe(isPlaced ? "manual" : null);
        return isPlaced && [ "left", "top", "max-height" ]
            .map((name) => panel?.style.getPropertyValue(`--side-panel-${name}`));
    }

    it("places the panel level with the drawing's top, on its right or else its left", async () => {
        const { viewport, panel } = await mount(300);
        expect(getPlacement(panel)).toEqual([ "848px", "200px", "884px" ]);

        rects.drawing = { left: 340, top: 200, right: 1100, bottom: 520 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "132px", "200px", "884px" ]);
        expect(showPopover).toHaveBeenCalledTimes(1);
    });

    it("places the library first, as tall as the drawing, the panel on a free side", async () => {
        const { viewport, panel, library } = await mount(300, true);
        expect(getPlacement(library)).toEqual([ "848px", "200px", "884px" ]);
        expect(library?.style.getPropertyValue("--side-panel-height")).toBe("320px");
        expect(getPlacement(panel)).toEqual([ "132px", "200px", "884px" ]);
        expect(panel.style.getPropertyValue("--side-panel-height")).toBe("");

        // A drawing of 160px gives the library its least height of 20rem.
        rects.drawing = { left: 340, top: 200, right: 1100, bottom: 360 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(library)).toEqual([ "132px", "200px", "884px" ]);
        expect(library?.style.getPropertyValue("--side-panel-height")).toBe("320px");
        expect(getPlacement(panel)).toBe(false);

        rects.drawing = { left: 340, top: 100, right: 840, bottom: 1100 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(library)).toEqual([ "848px", "8px", "884px" ]);
        expect(library?.style.getPropertyValue("--side-panel-height")).toBe("884px");
        expect(getPlacement(panel)).toEqual([ "132px", "100px", "884px" ]);
    });

    it("keeps the panel inside the window while the note scrolls", async () => {
        const { viewport, panel } = await mount(300);

        rects.drawing = { left: 340, top: -50, right: 840, bottom: 270 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "848px", "8px", "884px" ]);

        rects.drawing = { left: 340, top: 700, right: 840, bottom: 1020 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "848px", "592px", "884px" ]);

        Object.defineProperty(panel, "offsetHeight", { value: 1000 });
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toEqual([ "848px", "8px", "884px" ]);
    });

    it("keeps the panel in the drawing without room beside it or out of view", async () => {
        const { viewport, panel } = await mount(300);

        rects.drawing = { left: 100, top: 200, right: 1100, bottom: 520 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toBe(false);

        // Inside the window, but scrolled out of the note area.
        rects.drawing = { left: 340, top: 810, right: 840, bottom: 1130 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toBe(false);

        rects.drawing = { left: 340, top: -300, right: 840, bottom: 90 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).toBe(false);

        rects.drawing = { left: 340, top: 200, right: 840, bottom: 520 };
        viewport.dispatchEvent(new Event("scroll"));
        expect(getPlacement(panel)).not.toBe(false);
        expect(showPopover).toHaveBeenCalledTimes(2);

        await act(async () => {
            render(<SidePanelProbe isEnabled={false} hasLibrary={false} />, container);
        });
        expect(getPlacement(panel)).toBe(false);
    });

    it("keeps the panel in the drawing without the focus or in fullscreen", async () => {
        const { body, panel } = await mount(300);

        await act(async () => body.classList.remove("active"));
        expect(getPlacement(panel)).toBe(false);

        await act(async () => body.classList.add("active"));
        expect(getPlacement(panel)).not.toBe(false);

        Object.defineProperty(document, "fullscreenElement", {
            value: container,
            configurable: true
        });
        document.dispatchEvent(new Event("fullscreenchange"));
        expect(getPlacement(panel)).toBe(false);
    });
});

describe("CanvasDrawing", () => {
    let box: HTMLElement;

    beforeEach(() => {
        box = document.createElement("div");
        box.className = "include-note-content";
        box.tabIndex = -1;
        document.body.appendChild(box);
    });

    afterEach(() => {
        render(null, box);
        box.remove();
    });

    async function mount() {
        await act(async () => {
            render(<CanvasDrawing attachment={{ attachmentId: "a1" } as never} />, box);
        });
        return box.querySelector(".excalidraw");
    }

    it("takes the focus that its embed box holds once Excalidraw renders", async () => {
        box.focus();
        const excalidraw = await mount();
        expect(excalidraw).not.toBeNull();
        await vi.waitFor(() => expect(document.activeElement).toBe(excalidraw));
    });

    it("leaves the focus anywhere else alone", async () => {
        const editable = document.createElement("div");
        editable.tabIndex = 0;
        document.body.appendChild(editable);
        editable.focus();

        await mount();
        expect(document.activeElement).toBe(editable);
        editable.remove();
    });

    it("keeps the desktop layout of Excalidraw in the desktop layout of Trilium only", async () => {
        const device = window.glob.device;
        await mount();
        expect(canvasEditorProps).toHaveBeenLastCalledWith(
            expect.objectContaining({ isDesktopLayout: true })
        );

        render(null, box);
        window.glob.device = "mobile";
        await mount();
        window.glob.device = device;
        expect(canvasEditorProps).toHaveBeenLastCalledWith(
            expect.objectContaining({ isDesktopLayout: false })
        );
    });
});
