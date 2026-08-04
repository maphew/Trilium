import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import link from "../../../services/link";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import DetailPane from "./DetailPane";
import { ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";

/** Navigating the tab the map is in, which is a module function rather than a command. */
const openInCurrentNoteContext = vi.fn();
vi.mock("../../../components/note_context", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    openInCurrentNoteContext: (...args: unknown[]) => openInCurrentNoteContext(...args)
}));

/** What a marker click hands the handler, and what the pane reads the note out of. */
type Listener = (e?: unknown) => void;

/** How wide the map is in these tests, which is room enough for the pane and then some. */
const MAP_WIDTH = 1200;

/**
 * A map that records what the pane asks of it, standing in for MapLibre.
 *
 * What it has to answer is the hit test: the pane is bound to the map at large rather than to the
 * marker layer, and asks what is under the point that was clicked (see DetailPane).
 */
function fakeMap({ width = MAP_WIDTH, features = [] as unknown[] } = {}) {
    const listeners = new Map<string, Set<Listener>>();
    const eased: unknown[] = [];
    let under: unknown[] = features;

    return {
        /** Every camera move the pane has asked for, which is how it holds a marker clear of itself. */
        get eased() { return eased; },
        /** What the next click will land on: a marker's feature, or nothing at all. */
        setUnderPointer(hit: unknown[]) { under = hit; },
        /** A click on the map, wherever `setUnderPointer` says it landed. */
        click() {
            for (const fn of listeners.get("click") ?? []) fn({ point: { x: 0, y: 0 } });
        },
        on(event: string, fnOrLayer: unknown, fn?: () => void) {
            const key = fn ? `${event}:${fnOrLayer}` : event;
            const handler = (fn ?? fnOrLayer) as Listener;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)?.add(handler);
        },
        off(event: string, fnOrLayer: unknown, fn?: () => void) {
            listeners.get(fn ? `${event}:${fnOrLayer}` : event)?.delete((fn ?? fnOrLayer) as Listener);
        },
        queryRenderedFeatures(_point: unknown, { layers }: { layers: string[] }) {
            return layers.includes(MARKER_LAYER) ? under : [];
        },
        easeTo(options: unknown) { eased.push(options); },
        getContainer: () => ({ clientWidth: width })
    };
}

/** A marker of the layer, as MapLibre reports one that was hit. */
function markerFeature(note: FNote, coordinates: [number, number] = [ 2, 1 ]) {
    return { geometry: { type: "Point", coordinates }, properties: { id: note.noteId } };
}

describe("DetailPane", () => {
    let container: HTMLElement | undefined;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);

        // The pane asks where the reader is hoisted, which the app has settled by the time a map is
        // ever drawn and a test has not: `tabManager` is only built when the app starts.
        (appContext as unknown as { tabManager: unknown }).tabManager = {
            getActiveContext: () => undefined,
            openContextWithNote: async () => undefined
        };
    });

    afterEach(() => {
        (appContext as unknown as { tabManager: unknown }).tabManager = undefined;

        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** Renders into the same container, so calling it again is a re-render with fresh props. */
    function mount(notes: FNote[], map: ReturnType<typeof fakeMap>, placing = false, isReadOnly = false) {
        return act(async () => {
            render(
                <ParentComponent.Provider value={new Component()}>
                    <ParentMap.Provider value={map as never}>
                        <DetailPane notes={notes} placing={placing} isReadOnly={isReadOnly} />
                    </ParentMap.Provider>
                </ParentComponent.Provider>,
                container as HTMLElement
            );
        });
    }

    function pane() {
        return container?.querySelector(".geo-detail-pane") ?? null;
    }

    it("stands for the marker that was clicked, naming its note", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        // Nothing is selected to begin with, so there is no pane over the map at all.
        expect(pane()).toBeNull();

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());

        expect(pane()?.querySelector(".tn-overlay-panel-title-text")?.textContent).toBe("Somewhere");
    });

    /**
     * The pane covers the trailing edge of the map, so the marker it stands for is brought to the
     * middle of what is left uncovered rather than to the middle of the map — where the pane itself
     * would be sitting on top of it.
     */
    it("holds the marker it opens for clear of itself", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note, [ 2, 1 ]) ]);
        await act(async () => map.click());

        // Half of what the pane reaches into the map: its own width, plus the air it is held off
        // the edge by.
        expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ -200, 0 ] } ]);
    });

    /** An embedded map may be narrower than the pane wants to be, and then there is nowhere to move to. */
    it("leaves the marker where it is on a map the pane covers whole", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap({ width: 300 });
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());

        expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ 0, 0 ] } ]);
    });

    it("clears on a click that misses every marker, and on Escape", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        map.setUnderPointer([]);
        await act(async () => map.click());
        expect(pane()).toBeNull();

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
        expect(pane()).toBeNull();
    });


    /**
     * The panel stops the key presses made inside it from reaching what is underneath, which is a
     * map with shortcuts of its own — and which would stop them reaching the pane's own listener
     * too, were that one not heard on the way down.
     */
    it("closes on Escape pressed with the focus inside the pane", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        await act(async () => {
            pane()?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
        });
        expect(pane()).toBeNull();
    });

    it("leaves the click alone while the map is armed to place something", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map, true);

        // The click belongs to the placement, which is handled where that state lives.
        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());

        expect(pane()).toBeNull();
        expect(map.eased).toEqual([]);
    });

    /**
     * Taking a marker off the map clears the note's location and leaves the note itself exactly where
     * it was, so the pane cannot wait to be told the note has gone — there is no pin left for it to
     * stand for either way.
     */
    it("goes away when its marker leaves the map, whether the note does or not", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        // The note has had its location cleared, which is all that taking a marker off the map does.
        const located = vi.spyOn(note, "getLabelValue").mockReturnValue(null);
        await mount([ note ], map);
        expect(pane()).toBeNull();

        located.mockRestore();
        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        expect(pane()).toBeTruthy();

        // And the note gone from the collection altogether.
        await mount([], map);
        expect(pane()).toBeNull();
    });

    describe("the ways of opening it", () => {
        async function openPaneFor(note: FNote, map: ReturnType<typeof fakeMap>, isReadOnly = false) {
            await mount([ note ], map, false, isReadOnly);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());
        }

        function press(icon: string) {
            container?.querySelector<HTMLButtonElement>(`.geo-detail-pane-actions button.${icon}`)?.click();
        }

        it("opens the note where every note in Trilium is opened", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();

            // What each of these opens is a path rather than an id, a note being reachable by more
            // than one. Which path that is belongs to the tree, not to the pane, so it is said here
            // instead of built: nothing in a froca raised for a test hangs under the root the real
            // one is searched from.
            const notePath = "root/places/somewhere";
            const bestNotePath = vi.spyOn(note, "getBestNotePathString").mockReturnValue(notePath);
            const openContextWithNote = vi.spyOn(appContext.tabManager, "openContextWithNote").mockResolvedValue(undefined as never);
            const triggerCommand = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
            const goToLinkExt = vi.spyOn(link, "goToLinkExt").mockReturnValue(true);

            try {
                await openPaneFor(note, map);

                press("bx-log-in");
                expect(openInCurrentNoteContext).toHaveBeenCalledWith(expect.anything(), notePath);

                press("bx-link-external");
                expect(openContextWithNote).toHaveBeenCalledWith(notePath, { hoistedNoteId: undefined });

                press("bx-window-open");
                expect(triggerCommand).toHaveBeenCalledWith("openInWindow", { notePath, hoistedNoteId: undefined });

                // Latitude first, as a geo URI is written and as the map's own menu hands one over —
                // the note stores it that way round, and the features the map draws do not.
                press("bx-map-alt");
                expect(goToLinkExt).toHaveBeenCalledWith(null, "geo:1,2");
            } finally {
                bestNotePath.mockRestore();
                openContextWithNote.mockRestore();
                triggerCommand.mockRestore();
                goToLinkExt.mockRestore();
                openInCurrentNoteContext.mockClear();
            }
        });
    });

    describe("taking the marker off the map", () => {
        function removeButton() {
            return container?.querySelector<HTMLButtonElement>(".geo-detail-pane-actions button.bx-trash") ?? null;
        }

        /**
         * Only the note's location goes — the note itself stays where it is in the tree — and the
         * pane goes with it, there being no marker left for it to stand for.
         */
        it("clears the note's location and stands down", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            const setLabel = vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);

            try {
                await mount([ note ], map);
                map.setUnderPointer([ markerFeature(note) ]);
                await act(async () => map.click());

                await act(async () => { removeButton()?.click(); });
                expect(setLabel).toHaveBeenCalledWith(note.noteId, "geolocation", "");

                // What the server would send back, which is the note carrying nowhere to be drawn.
                vi.spyOn(note, "getLabelValue").mockReturnValue(null);
                await mount([ note ], map);
                expect(pane()).toBeNull();
            } finally {
                setLabel.mockRestore();
            }
        });

        it("is not offered at all on a map that cannot be edited", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();

            await mount([ note ], map, false, true);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());

            // The ways of reading the note stay; the one that writes it does not.
            expect(pane()).toBeTruthy();
            expect(container?.querySelector(".geo-detail-pane-actions button.bx-log-in")).toBeTruthy();
            expect(removeButton()).toBeNull();
        });
    });

    it("keeps clicks and key presses from reaching the map underneath", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());

        const onMouseDown = vi.fn();
        const onKeyDown = vi.fn();
        container?.addEventListener("mousedown", onMouseDown);
        container?.addEventListener("keydown", onKeyDown);

        pane()?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        pane()?.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));

        expect(onMouseDown).not.toHaveBeenCalled();
        expect(onKeyDown).not.toHaveBeenCalled();
    });
});
