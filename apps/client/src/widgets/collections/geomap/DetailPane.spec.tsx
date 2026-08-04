import $ from "jquery";
import { render } from "preact";
import { useState } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import linkContextMenu from "../../../menus/link_context_menu";
import froca from "../../../services/froca";
import link from "../../../services/link";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { useLegacyImperativeHandlers, useNoteContext, useTriliumEvent } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import DetailPane, { OTHER_WAYS_TO_OPEN, PaneSelection } from "./DetailPane";
import { ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";

/** Navigating the tab the map is in, which is a module function rather than a command. */
const openInCurrentNoteContext = vi.fn();
vi.mock("../../../components/note_context", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    openInCurrentNoteContext: (...args: unknown[]) => openInCurrentNoteContext(...args)
}));

/**
 * The note's own editor, which has a spec of its own and drags the whole app in with it. What
 * matters here is that the pane mounts it under a context it can read, and tells it to save before
 * going away — so the stand-in listens for exactly what a real editor listens for.
 */
const editorAskedToSave = vi.fn();
vi.mock("../../NoteDetail", () => ({
    default: () => {
        const { note, viewScope } = useNoteContext();
        useTriliumEvent("beforeNoteContextRemove", editorAskedToSave);
        // The text editor puts what it offers the app onto its parent component, and reaches it again
        // from the DOM (see the host test below). Registered here as the real editor registers it.
        useLegacyImperativeHandlers({ loadReferenceLinkTitle: async () => {} });
        return (
            <div
                className="note-detail-stub"
                data-floating-toolbar={String(!!viewScope?.floatingToolbar)}
            >
                {note?.title}
            </div>
        );
    }
}));

/** What the pane puts on the clipboard, the writing of it being the browser's business. */
const copied = vi.fn();
vi.mock("../../../services/clipboard_ext", async (importOriginal) => ({
    ...(await importOriginal<object>()),
    copyTextWithToast: (...args: unknown[]) => copied(...args)
}));

// A promoted text field suggests what other notes hold under its name, asked for through the Algolia
// jQuery plugin and answered by the server. Neither is loaded here.
type PluggedIn = { autocomplete(...args: unknown[]): PluggedIn };
($.fn as unknown as PluggedIn).autocomplete = function (this: PluggedIn) { return this; };
server.get = (async () => []) as unknown as typeof server.get;

/** What a marker click hands the handler, and what the pane reads the note out of. */
type Listener = (e?: unknown) => void;

/** How wide the map is in these tests, which is room enough for the pane and then some. */
const MAP_WIDTH = 1200;

/**
 * A map that records what the pane asks of it, standing in for MapLibre. What it has to answer is
 * the hit test: the pane is bound to the map at large, not to the marker layer (see DetailPane).
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

        // `tabManager` is only built when the app starts, and the pane asks it where the reader is
        // hoisted.
        (appContext as unknown as { tabManager: unknown }).tabManager = {
            getActiveContext: () => undefined,
            getActiveContextNotePath: () => undefined,
            openContextWithNote: async () => undefined
        };
        editorAskedToSave.mockClear();
        onRelocate.mockClear();
    });

    afterEach(() => {
        (appContext as unknown as { tabManager: unknown }).tabManager = undefined;
        mapComponent = undefined;

        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    /** Stands in for the map's own component, which is what the pane hangs under. */
    let mapComponent: Component | undefined;

    /**
     * Stands in for the map view, which is what owns the selection now (see PaneSelection): the pane
     * asks for changes through `onSelect` and is handed the result back, exactly as GeoView does it.
     * `initialSelection` is the map view opening the pane by hand — on a note it has just created.
     */
    function Harness({ notes, placing, isReadOnly, initialSelection }: {
        notes: FNote[]; placing: boolean; isReadOnly: boolean; initialSelection?: PaneSelection;
    }) {
        const [ selection, setSelection ] = useState<PaneSelection | null>(initialSelection ?? null);
        return <DetailPane
            notes={notes}
            placing={placing}
            isReadOnly={isReadOnly}
            selection={selection}
            onSelect={setSelection}
            onRelocate={onRelocate}
        />;
    }

    /** Renders into the same container, so calling it again is a re-render with fresh props. */
    function mount(notes: FNote[], map: ReturnType<typeof fakeMap>, placing = false, isReadOnly = false, initialSelection?: PaneSelection) {
        mapComponent ??= new Component();
        return act(async () => {
            render(
                <ParentComponent.Provider value={mapComponent as Component}>
                    <ParentMap.Provider value={map as never}>
                        <Harness notes={notes} placing={placing} isReadOnly={isReadOnly} initialSelection={initialSelection} />
                    </ParentMap.Provider>
                </ParentComponent.Provider>,
                container as HTMLElement
            );
        });
    }

    /** Arming the map for the next click to be where the marker goes, which the map owns (index.tsx). */
    const onRelocate = vi.fn();

    /** Lets the pane's note context resolve its path and announce the note it landed on. */
    async function settle() {
        await act(async () => {
            for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve));
        });
    }

    function pane() {
        return container?.querySelector(".geo-detail-pane") ?? null;
    }

    /**
     * The title row reads the note out of a note context rather than taking one as a prop, so what
     * this asserts is that the pane points that context at the marker clicked.
     */
    it("stands for the marker that was clicked, naming its note", async () => {
        // Hung under the root so there is a path to point the note context at.
        buildNote({ id: "root", title: "root", children: [ { id: "somewhere", title: "Somewhere", "#geolocation": "1,2" } ] });
        const note = froca.notes["somewhere"];
        const map = fakeMap();
        await mount([ note ], map);

        // Nothing is selected to begin with, so there is no pane over the map at all.
        expect(pane()).toBeNull();

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        await settle();

        // A field and a picker, not a heading drawn for the occasion.
        expect(pane()?.querySelector<HTMLInputElement>(".title-row input")?.value).toBe("Somewhere");
        expect(pane()?.querySelector<HTMLButtonElement>(".title-row .note-icon")?.disabled).toBe(false);
    });

    /**
     * Regression test for a click on a marker whiting out the map and losing its WebGL context.
     *
     * An unbound `useNoteContext` rebinds to whatever context a note switch names. Announced to the
     * map's component, the collection view around the pane rebound to the marker's note and tore the
     * map down mid-click. The pane keeps its own component so its switches reach only its contents.
     */
    it("keeps its own note switches from reaching the map's component", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "somewhere", title: "Somewhere", "#geolocation": "1,2" } ] });
        const note = froca.notes["somewhere"];
        const map = fakeMap();
        await mount([ note ], map);

        const heardByTheMap = vi.fn();
        for (const event of [ "noteSwitched", "noteSwitchedAndActivated", "beforeNoteSwitch" ] as const) {
            mapComponent?.registerHandler(event, heardByTheMap);
        }

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());
        await settle();

        // The pane heard its own switch — it is showing the note — and nothing else did.
        expect(pane()?.querySelector<HTMLInputElement>(".title-row input")?.value).toBe("Somewhere");
        expect(heardByTheMap).not.toHaveBeenCalled();
    });

    /**
     * The icon in the title row is dressed by the hue of whatever carries the colour class around it
     * (see theme-next-{light,dark}.css). The pane stands inside the map's note split, which carries
     * the map note's colour, so without one of its own the marker wore the map's hue.
     */
    it("carries the marker's own colour, and none where it has no colour", async () => {
        buildNote({ id: "root", title: "root", children: [
            { id: "red", title: "Red", "#geolocation": "1,2", "#color": "#ff0000" },
            { id: "plain", title: "Plain", "#geolocation": "3,4" }
        ] });
        const red = froca.notes["red"];
        const plain = froca.notes["plain"];
        const map = fakeMap();
        await mount([ red, plain ], map);

        map.setUnderPointer([ markerFeature(red) ]);
        await act(async () => map.click());
        await settle();

        expect(pane()?.classList.contains("use-note-color")).toBe(true);
        expect(pane()?.classList.contains("with-hue")).toBe(true);
        expect(pane()?.className).toContain(red.getColorClass());

        // Switching markers is a note switch within a standing pane, so the colour has to follow it.
        map.setUnderPointer([ markerFeature(plain) ]);
        await act(async () => map.click());
        await settle();

        expect(pane()?.classList.contains("use-note-color")).toBe(false);
        expect(pane()?.classList.contains("with-hue")).toBe(false);
    });

    /** The marker is brought to the middle of what the pane leaves uncovered, not of the map. */
    it("holds the marker it opens for clear of itself", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note, [ 2, 1 ]) ]);
        await act(async () => map.click());

        // Half of what the pane reaches into the map: its width plus the gap it stands off by.
        expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ -200, 0 ] } ]);
    });

    /** An embedded map may be narrower than the pane, leaving nowhere to move to. */
    it("leaves the marker where it is on a map the pane covers whole", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap({ width: 300 });
        await mount([ note ], map);

        map.setUnderPointer([ markerFeature(note) ]);
        await act(async () => map.click());

        expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ 0, 0 ] } ]);
    });

    /**
     * The way in for a note the map has just created (see `createNoteAt` in index.tsx): no click —
     * the map hands the pane the selection, marked as new, and the pane opens ready for the one
     * thing the note still lacks, a name.
     */
    it("opens on a note it is handed, with the stock name selected to be typed over", async () => {
        buildNote({ id: "root", title: "root", children: [ { id: "fresh", title: "new note", "#geolocation": "1,2" } ] });
        const note = froca.notes["fresh"];
        const map = fakeMap();

        // What the title widget asks before taking the focus; nothing in this DOM has a layout to
        // answer it with, so the answer a drawn pane would give is supplied by hand.
        (HTMLElement.prototype as { checkVisibility?: () => boolean }).checkVisibility = () => true;
        // The selecting itself is asserted as a call: happy-dom keeps no faithful selection range —
        // the controlled value write walks the caret to the end regardless of what select() did.
        const select = vi.spyOn(HTMLInputElement.prototype, "select");

        try {
            await mount([ note ], map, false, false, { noteId: note.noteId, isNew: true });
            await settle();

            // Open and held clear of the pane, exactly as if the marker had been clicked.
            expect(pane()).toBeTruthy();
            expect(map.eased).toEqual([ { center: [ 2, 1 ], offset: [ -200, 0 ] } ]);

            // The caret is in the title with the whole of the stock name selected: naming the
            // place is typing over it, not clearing a field first.
            const title = pane()?.querySelector<HTMLInputElement>(".title-row input");
            expect(title?.value).toBe("new note");
            expect(document.activeElement).toBe(title);
            expect(select.mock.instances).toContain(title);
        } finally {
            select.mockRestore();
        }
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


    /** The panel stops key presses reaching the map, which would stop them reaching this too. */
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

    /** Removal clears the location and leaves the note in the tree, so the pane cannot wait to be
     *  told the note has gone. */
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
            const goToLinkExt = vi.spyOn(link, "goToLinkExt").mockReturnValue(true);

            try {
                await openPaneFor(note, map);

                // The half of the split that is a button in its own right, the rest being behind its
                // arrow.
                container?.querySelector<HTMLButtonElement>(".geo-detail-pane-open-note")?.click();
                expect(openInCurrentNoteContext).toHaveBeenCalledWith(expect.anything(), notePath);

                // Latitude first, as a geo URI is written and as the map's own menu hands one over —
                // the note stores it that way round, and the features the map draws do not.
                press("bx-map-alt");
                expect(goToLinkExt).toHaveBeenCalledWith(null, "geo:1,2");
            } finally {
                bestNotePath.mockRestore();
                goToLinkExt.mockRestore();
                openInCurrentNoteContext.mockClear();
            }
        });

        /**
         * The rest live behind the split's arrow, and are the same ways a link offers anywhere in
         * the app — which is how a split view, the one worth having beside a map, comes to be
         * offered at all: the row of buttons this replaced never had one.
         *
         * The pane names them itself, the shared menu wanting an event it cannot be handed before
         * anything is pressed, so what is pinned here is that the two lists stay the same list. Add
         * a fifth way to open a link and this fails until the pane offers it too.
         */
        it("offers behind the split exactly the ways a link is opened anywhere else", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            await openPaneFor(note, map);

            expect(container?.querySelector(".dropdown-toggle-split")).toBeTruthy();
            expect(OTHER_WAYS_TO_OPEN.map((way) => way.command)).toEqual(
                linkContextMenu.getItems(new MouseEvent("click"))
                    .map((item) => ("command" in item ? item.command : undefined)));
        });
    });

    describe("the note itself", () => {
        async function openPane(map: ReturnType<typeof fakeMap>) {
            buildNote({ id: "root", title: "root", children: [ { id: "somewhere", title: "Somewhere", "#geolocation": "1,2" } ] });
            const note = froca.notes["somewhere"];
            await mount([ note ], map);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());
            await settle();
            return note;
        }

        it("is drawn in the pane, by the widget its type calls for", async () => {
            const map = fakeMap();
            await openPane(map);

            // Mounted under the pane's own note context, which is what it reads its note out of.
            expect(pane()?.querySelector(".note-detail-stub")?.textContent).toBe("Somewhere");
        });

        /** A toolbar built for the width of a note does not fit a pane a third that wide. */
        it("is asked for the floating toolbar rather than a bar of its own", async () => {
            const map = fakeMap();
            await openPane(map);

            expect(pane()?.querySelector(".note-detail-stub")?.getAttribute("data-floating-toolbar")).toBe("true");
        });

        /**
         * Regression test for `component.loadReferenceLinkTitle is not a function`, which a marker
         * whose note carried a reference link died on.
         *
         * Everything the text editor asks of the app it asks of a component it finds from its own
         * element — `glob.getComponentByEl(editor.editing.view.getDomRoot())` — while what it offers
         * is put onto the component it was mounted under. The pane mounts it under one of its own, so
         * unless the pane says in the DOM which component that is, the editor arrives at the widget
         * enclosing the map, which answers to none of it.
         */
        it("stands for its own component where the editor looks for one", async () => {
            const map = fakeMap();
            await openPane(map);

            const editorEl = pane()?.querySelector(".note-detail-stub");
            const host = appContext.getComponentByEl(editorEl as HTMLElement);

            // The pane itself is what carries it, and what it carries is the component the editor's
            // own registration landed on — the pane's, not the map's.
            expect(pane()?.getAttribute("data-component-id")).toBeTruthy();
            expect(host).not.toBe(mapComponent);
            expect(typeof host?.loadReferenceLinkTitle).toBe("function");
        });

        /**
         * Switching markers announces a note switch the editor saves on, but closing the pane
         * announces nothing — the widgets are only unmounted — so the pane says it itself.
         */
        it("is told to save before the pane closes", async () => {
            const map = fakeMap();
            await openPane(map);
            expect(editorAskedToSave).not.toHaveBeenCalled();

            await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });

            expect(editorAskedToSave).toHaveBeenCalledWith({ ntxIds: [ "_geo-detail-pane" ] });
            expect(pane()).toBeNull();
        });
    });

    /**
     * The place has a line of its own under the name, and is kept out of the grid of fields: the
     * collection promotes `geolocation` so that a marker can be placed from the tree, but in the
     * pane that field is a box of raw digits standing beside a map of the very place it names.
     */
    it("names the place under the title rather than among the fields", async () => {
        // An id of its own: the froca raised for a test keeps the attributes of every note built
        // under a given id, so reusing one would read back whatever an earlier test placed there.
        buildNote({ id: "root", title: "root", children: [ {
            id: "placeDesVosges",
            title: "Somewhere",
            // What the map writes when a marker is placed, which is a float's worth of decimals.
            "#geolocation": "48.855653506551015,2.36549253686366",
            // As the geo map template promotes it (see hidden_subtree_templates.ts).
            "#label:geolocation": "promoted,single,text"
        } ] });
        const map = fakeMap();
        await mount([ froca.notes["placeDesVosges"] ], map);

        map.setUnderPointer([ markerFeature(froca.notes["placeDesVosges"], [ 2.365, 48.855 ]) ]);
        await act(async () => map.click());
        await settle();

        // Rounded to a stride, which is as finely as anywhere is pointed out on a map.
        const location = pane()?.querySelector<HTMLButtonElement>(".geo-detail-pane-location");
        expect(location?.textContent).toBe("48.855654, 2.365493");
        expect(pane()?.querySelector(".promoted-attribute-cell")).toBeNull();

        // Carried at every digit the note holds, so what is pasted elsewhere is the place itself.
        await act(async () => { location?.click(); });
        expect(copied).toHaveBeenCalledWith("48.855653506551015, 2.365492536863660");

        // Named by the app's own tooltip, as the buttons beneath it are, rather than by the one the
        // browser draws from a `title` — which is what carrying no such attribute leaves.
        expect(location?.getAttribute("title")).toBeNull();
    });

    /**
     * A marker is very often a note whose fields say more about the place than its content does — the
     * grid of them is the quick editor's, standing where the quick editor puts it.
     */
    it("offers the note's own promoted fields, and none where a note promotes none", async () => {
        buildNote({ id: "root", title: "root", children: [
            {
                id: "somewhere",
                title: "Somewhere",
                "#geolocation": "1,2",
                "#label:visited": "promoted,single,text",
                "#visited": "2026-08-04"
            },
            { id: "elsewhere", title: "Elsewhere", "#geolocation": "3,4" }
        ] });
        const map = fakeMap();
        await mount([ froca.notes["somewhere"], froca.notes["elsewhere"] ], map);

        map.setUnderPointer([ markerFeature(froca.notes["somewhere"]) ]);
        await act(async () => map.click());
        await settle();

        const cell = pane()?.querySelector(".promoted-attribute-cell");
        expect(cell?.querySelector("label")?.textContent).toBe("visited");
        expect(cell?.querySelector<HTMLInputElement>("input")?.value).toBe("2026-08-04");

        // Moving between markers is a note switch within the standing pane, so the fields follow it.
        map.setUnderPointer([ markerFeature(froca.notes["elsewhere"], [ 4, 3 ]) ]);
        await act(async () => map.click());
        await settle();

        expect(pane()?.querySelector(".promoted-attribute-cell")).toBeNull();
    });

    describe("moving the marker", () => {
        function moveButton() {
            return container?.querySelector<HTMLButtonElement>(".geo-detail-pane-actions button.bx-move") ?? null;
        }

        /**
         * The map is armed rather than the marker dragged, and the pane goes away while it waits: the
         * click that names the new place has to land on the map, and the pane covers the part of it
         * nearest the marker.
         */
        it("arms the map for the next click and stands down", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();

            await mount([ note ], map);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());
            await settle();

            await act(async () => { moveButton()?.click(); });

            // The arming belongs to the map, which alone knows what the next click on it is for.
            expect(onRelocate).toHaveBeenCalledWith(note.noteId);
            expect(pane()).toBeNull();
            // Going away this way is still a close, so whatever was being written is saved first.
            expect(editorAskedToSave).toHaveBeenCalledWith({ ntxIds: [ "_geo-detail-pane" ] });
        });

        it("is not offered at all on a map that cannot be edited", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();

            await mount([ note ], map, false, true);
            map.setUnderPointer([ markerFeature(note) ]);
            await act(async () => map.click());

            expect(pane()).toBeTruthy();
            expect(moveButton()).toBeNull();
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
            expect(container?.querySelector(".geo-detail-pane-open-note")).toBeTruthy();
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
