/**
 * The marker preview, which is the app's own note tooltip drawn into a MapLibre popup.
 *
 * The notes are drawn into one symbol layer rather than an element apiece, so none of the tooltip
 * service's element-hovering applies: what has to be got right here is reading the note behind the
 * pixel under the pointer, and keeping the preview up long enough to be reached and read.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import { ParentMap } from "./map";
import { MARKER_HEIGHT, MARKER_LAYER, MARKER_WIDTH } from "./Markers";
import Tooltips from "./Tooltips";

/** What a note's preview renders to, standing in for the shared tooltip renderer. */
const renderTooltip = vi.fn(async (note: FNote | null) =>
    note ? `<h5 class="note-tooltip-title">${note.title}</h5><p>Body of ${note.title}</p>` : undefined);

vi.mock("../../../services/note_tooltip", () => ({ renderTooltip: (note: FNote | null) => renderTooltip(note) }));

/**
 * The popup MapLibre would draw, recording what it was shown and whether it is up. Hoisted because
 * the module mock below it is, and the mock is what hands the class to the component.
 */
const { FakePopup } = vi.hoisted(() => {
    class FakePopup {
        static open: FakePopup[] = [];

        html = "";
        lngLat: unknown;
        element: HTMLElement | null = null;
        options: { offset?: Record<string, [ number, number ]> };

        constructor(options: { offset?: Record<string, [ number, number ]> }) {
            this.options = options;
        }

        setLngLat(lngLat: unknown) { this.lngLat = lngLat; return this; }

        setHTML(html: string) {
            this.html = html;
            if (this.element) this.element.innerHTML = html;
            return this;
        }

        addTo() {
            // Rebuilt on every opening, as MapLibre rebuilds it — which is why the listeners that
            // keep the preview open have to be bound per opening.
            this.element = document.createElement("div");
            this.element.innerHTML = this.html;
            document.body.appendChild(this.element);
            FakePopup.open.push(this);
            return this;
        }

        getElement() { return this.element; }

        remove() {
            this.element?.remove();
            this.element = null;
            FakePopup.open = FakePopup.open.filter((popup) => popup !== this);
            return this;
        }
    }

    return { FakePopup };
});

vi.mock("maplibre-gl", () => ({ Popup: FakePopup }));

/** A map that only delegates layer events, which is all this component asks of one. */
function fakeMap() {
    const listeners = new Map<string, Set<(e: unknown) => void>>();
    const key = (event: string, layer: string) => `${event}:${layer}`;

    return {
        on(event: string, layer: string, fn: (e: unknown) => void) {
            const listenersForKey = listeners.get(key(event, layer)) ?? new Set();
            listeners.set(key(event, layer), listenersForKey.add(fn));
        },
        off(event: string, layer: string, fn: (e: unknown) => void) {
            listeners.get(key(event, layer))?.delete(fn);
        },
        /** The pointer coming to rest on a marker, as MapLibre reports it. */
        hover(note: FNote) {
            const feature = {
                geometry: { type: "Point", coordinates: [ 1, 2 ] },
                properties: { id: note.noteId, name: note.title }
            };
            for (const fn of listeners.get(key("mousemove", MARKER_LAYER)) ?? []) fn({ features: [ feature ] });
        },
        /** The pointer leaving every marker. */
        leave() {
            for (const fn of listeners.get(key("mouseleave", MARKER_LAYER)) ?? []) fn({});
        },
        get listenerCount() {
            return [ ...listeners.values() ].reduce((total, set) => total + set.size, 0);
        }
    };
}

/** A preview about the size the app renders one at, for the placement arithmetic below. */
const PREVIEW_WIDTH = 500;
const PREVIEW_HEIGHT = 120;

/** The pin, in pixels around the coordinate it stands on. */
const PIN = {
    left: -MARKER_WIDTH / 2,
    right: MARKER_WIDTH / 2,
    top: -MARKER_HEIGHT,
    bottom: 0
};

/**
 * Where each of MapLibre's placements puts the preview's top-left corner before the offset is
 * applied — its `anchorTranslate` table, worked out for a preview of the size above. `center` is
 * left out: MapLibre's own placement logic never arrives at it.
 */
const PLACEMENTS: Record<string, [ number, number ]> = {
    "top": [ -PREVIEW_WIDTH / 2, 0 ],
    "bottom": [ -PREVIEW_WIDTH / 2, -PREVIEW_HEIGHT ],
    "left": [ 0, -PREVIEW_HEIGHT / 2 ],
    "right": [ -PREVIEW_WIDTH, -PREVIEW_HEIGHT / 2 ],
    "top-left": [ 0, 0 ],
    "top-right": [ -PREVIEW_WIDTH, 0 ],
    "bottom-left": [ 0, -PREVIEW_HEIGHT ],
    "bottom-right": [ -PREVIEW_WIDTH, -PREVIEW_HEIGHT ]
};

/** Drains the promise chain in `show` (note read → preview rendered) without moving the clock. */
async function flush() {
    await act(async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
    });
}

/** Moves the clock on and lets whatever that started finish. */
async function advance(ms: number) {
    await act(async () => { vi.advanceTimersByTime(ms); });
    await flush();
}

/** The preview currently on screen, or `undefined` where there is none. */
function shownPreview() {
    return FakePopup.open[0]?.element?.textContent ?? undefined;
}

describe("Tooltips", () => {
    let container: HTMLElement | undefined;

    beforeEach(() => {
        vi.useFakeTimers();
        FakePopup.open = [];
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        vi.useRealTimers();
        renderTooltip.mockClear();
    });

    function mount(map: ReturnType<typeof fakeMap>) {
        return act(async () => {
            render(
                <ParentMap.Provider value={map as never}>
                    <Tooltips />
                </ParentMap.Provider>,
                container as HTMLElement
            );
        });
    }

    it("shows the note's preview once the pointer has rested on its marker", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        // A marker merely passed over is not a note worth reading.
        await advance(200);
        expect(shownPreview()).toBeUndefined();
        expect(renderTooltip).not.toHaveBeenCalled();

        await advance(400);
        expect(shownPreview()).toContain("Body of Somewhere");
        // Drawn in the shape the app's tooltip styles are written against.
        expect(FakePopup.open[0]?.html).toContain(`class="tooltip note-tooltip show"`);
        expect(FakePopup.open[0]?.html).toContain(`class="note-tooltip-content"`);
        // `.tooltip-inner` is `pre-line`, so a line break laid out between the tags is a blank line
        // drawn in the preview — one above it and one below, 43px of nothing. The rendered note
        // brings no newline of its own here, so the wrapper is where any of them would come from.
        expect(FakePopup.open[0]?.html).not.toContain("\n");
    });

    /**
     * `mouseenter` fires on entering the layer, not on entering a marker, so a pointer dragged from
     * one pin straight onto the next never leaves it — the first note's preview used to stay up over
     * the second, which is why the move is what is watched.
     */
    it("swaps the preview when the pointer moves straight from one marker to another", async () => {
        const first = buildNote({ title: "Here", "#geolocation": "1,2" });
        const second = buildNote({ title: "There", "#geolocation": "3,4" });
        const map = fakeMap();
        await mount(map);

        map.hover(first);
        await advance(500);
        expect(shownPreview()).toContain("Body of Here");

        // The pointer crosses onto the second marker without ever leaving the layer.
        map.hover(second);
        // The first note's preview goes at once rather than standing there wrong for as long as the
        // second takes to read.
        await flush();
        expect(shownPreview()).toBeUndefined();

        await advance(500);
        expect(shownPreview()).toContain("Body of There");
        expect(FakePopup.open).toHaveLength(1);
    });

    it("stays up while the pointer is on it, and closes once the pointer leaves it", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        const element = FakePopup.open[0]?.element;

        // The preview sits a little away from the pin, so reaching it means leaving the marker.
        map.leave();
        await act(async () => { element?.dispatchEvent(new Event("mouseenter")); });
        await advance(2000);
        expect(shownPreview()).toContain("Body of Somewhere");

        await act(async () => { element?.dispatchEvent(new Event("mouseleave")); });
        await advance(500);
        expect(shownPreview()).toBeUndefined();
    });

    /**
     * A pin stands on its coordinate, so every placement MapLibre can choose opens onto some part of
     * it. Checked as the geometry it is rather than as a rule per axis: the first attempt cleared the
     * pin's height, which reads as right until a corner placement — which spreads sideways from the
     * point, not upwards — lies across half the pin anyway.
     */
    it("keeps clear of the pin wherever the map decides to put it", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        const offset = FakePopup.open[0]?.options.offset;

        for (const [ placement, corner ] of Object.entries(PLACEMENTS)) {
            const [ offsetX, offsetY ] = offset?.[placement] ?? [ 0, 0 ];
            const left = corner[0] + offsetX;
            const top = corner[1] + offsetY;
            const clear = left >= PIN.right || left + PREVIEW_WIDTH <= PIN.left
                || top >= PIN.bottom || top + PREVIEW_HEIGHT <= PIN.top;

            // Named in the assertion so a failure says which placement covers the pin.
            expect(`${placement} is ${clear ? "clear of" : "over"} the pin`).toBe(`${placement} is clear of the pin`);
        }
    });

    it("closes the preview when the pointer leaves the marker without reaching it", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        expect(shownPreview()).toContain("Body of Somewhere");

        map.leave();
        await advance(500);
        expect(shownPreview()).toBeUndefined();
    });

    /** Reading a note is asynchronous, so a marker skimmed past is usually left before it lands. */
    it("drops a preview whose marker was left before it finished rendering", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        let release: (() => void) | undefined;
        renderTooltip.mockImplementationOnce(async () => {
            await new Promise<void>((resolve) => { release = resolve; });
            return "<p>Body of Somewhere</p>";
        });

        map.hover(note);
        await advance(500);
        expect(renderTooltip).toHaveBeenCalled();

        map.leave();
        await act(async () => { release?.(); });
        await flush();

        expect(shownPreview()).toBeUndefined();
    });

    it("takes its listeners and any open preview with it when it goes away", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount(map);

        map.hover(note);
        await advance(500);
        expect(shownPreview()).toContain("Body of Somewhere");

        await act(async () => { render(null, container as HTMLElement); });

        expect(FakePopup.open).toHaveLength(0);
        expect(map.listenerCount).toBe(0);
    });
});
