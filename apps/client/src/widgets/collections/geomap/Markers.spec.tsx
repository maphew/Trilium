/**
 * Regression test for every marker on a geo map blinking when a single note changed.
 *
 * The layer and the data it carries were built by one effect keyed on everything at once — the map,
 * the look of a marker, and the notes. Any change ran its cleanup, which removed the layer and its
 * source outright, and the markers only came back once all of them had been built again — a build
 * that is asynchronous. Recolouring one note therefore took every marker on the map off and put
 * them all back a few frames later.
 *
 * The two are separate now: the layer stands for as long as the map and the look do, and a note
 * being edited reaches it as data.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../../components/app_context";
import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import type { EntityChange } from "../../../server_types";
import LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { CLUSTER_COUNT_LAYER, CLUSTER_LAYER } from "./clusters";
import { ParentMap } from "./map";
import Markers, { MARKER_LAYER, MARKER_SOURCE } from "./Markers";

vi.mock("../../../services/icon_glyphs", () => ({
    renderIconImage: vi.fn(async () => "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")
}));

/** What a map that gathers its notes puts up: the pins, the bubbles, and the bubbles' counts. */
const CLUSTERED_LAYER_COUNT = 3;

interface FakeLayer {
    id: string;
    filter?: unknown;
    layout?: Record<string, unknown>;
    paint?: Record<string, unknown>;
}

/** What the component hands the map, which for a layer-scoped event is given the event itself. */
type Listener = (e?: unknown) => void;

/** A map that records what the component does to it, standing in for MapLibre. */
function fakeMap() {
    const layers = new Map<string, FakeLayer>();
    const sources = new Map<string, unknown>();
    const listeners = new Map<string, Set<Listener>>();
    const calls = { addLayer: 0, removeLayer: 0, addSource: 0, removeSource: 0, setData: 0 };
    const properties = new Map<string, unknown>();
    const canvas = { style: {} as Record<string, string> };
    let lastFeatures: unknown[] = [];
    let removed = false;

    /** What every style-reading call becomes once the map is gone: `this.style is undefined`. */
    function requireStyle() {
        if (removed) throw new TypeError("can't access property \"getLayer\", this.style is undefined");
    }

    return {
        calls,
        get lastFeatures() { return lastFeatures; },
        /** The filter, layout and paint a layer was added with, as `addLayer` was given them. */
        layer(id: string) { return layers.get(id); },
        /** What a layout or paint property of a layer has been set to since, by name. */
        property(id: string, name: string) { return properties.get(`${id}/${name}`); },
        /** What a source was added with, which is where the clustering options live. */
        source(id: string) { return sources.get(id); },
        fireStyleLoad() {
            for (const fn of listeners.get("style.load") ?? []) fn();
        },
        /**
         * The map going away under the component, as MapLibre does it: the style is dropped first
         * and the event announced afterwards, so everything that reads the style throws from here
         * on. This is what the parent Map component does in its own cleanup, which Preact runs
         * before this component's.
         */
        remove() {
            removed = true;
            for (const fn of listeners.get("remove") ?? []) fn();
        },
        /**
         * MapLibre lets a listener be scoped to a layer, which the cluster and marker handlers use —
         * the layer comes between the event and the handler when it does, and is part of the key so
         * that firing one of them does not reach a handler listening to the same event elsewhere.
         */
        on(event: string, fnOrLayer: unknown, fn?: () => void) {
            const key = fn ? `${event}:${fnOrLayer}` : event;
            const handler = (fn ?? fnOrLayer) as Listener;
            if (!listeners.has(key)) listeners.set(key, new Set());
            listeners.get(key)?.add(handler);
        },
        off(event: string, fnOrLayer: unknown, fn?: () => void) {
            listeners.get(fn ? `${event}:${fnOrLayer}` : event)?.delete((fn ?? fnOrLayer) as Listener);
        },
        /** A marker being clicked, as MapLibre reports a click that landed on the layer. */
        clickMarker(note: FNote) {
            for (const fn of listeners.get(`click:${MARKER_LAYER}`) ?? []) {
                fn({ features: [ { properties: { id: note.noteId } } ] });
            }
        },
        /** The pointer coming to rest on a marker, and leaving it again. */
        enterMarker() {
            for (const fn of listeners.get(`mouseenter:${MARKER_LAYER}`) ?? []) fn({});
        },
        leaveMarker() {
            for (const fn of listeners.get(`mouseleave:${MARKER_LAYER}`) ?? []) fn({});
        },
        /** What the map is currently showing the pointer as. */
        get cursor() { return canvas.style.cursor ?? ""; },
        isStyleLoaded: () => false,
        hasImage: () => false,
        addImage: () => {},
        getCanvas: () => canvas,
        getSource(id: string) {
            requireStyle();
            if (!sources.has(id)) return undefined;
            return {
                setData: ({ features }: { features: unknown[] }) => {
                    calls.setData++;
                    lastFeatures = features;
                }
            };
        },
        addSource(id: string, source: unknown) { sources.set(id, source); calls.addSource++; },
        removeSource(id: string) { sources.delete(id); calls.removeSource++; },
        getLayer: (id: string) => {
            requireStyle();
            return layers.has(id) ? { id } : undefined;
        },
        addLayer(layer: FakeLayer) {
            layers.set(layer.id, layer);
            calls.addLayer++;
        },
        removeLayer(id: string) { layers.delete(id); calls.removeLayer++; },
        setLayoutProperty(id: string, name: string, value: unknown) { properties.set(`${id}/${name}`, value); },
        setPaintProperty(id: string, name: string, value: unknown) { properties.set(`${id}/${name}`, value); }
    };
}

/** Drains the awaits in buildMarkerData (icon render → svg decode → setData). */
async function settle() {
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve));
}

/** An `entitiesReloaded` carrying a colour change to one of the map's notes. */
function colourChanged(note: FNote) {
    const attributeId = `attr-${note.noteId}`;
    const loadResults = new LoadResults([
        {
            entityName: "attributes",
            entityId: attributeId,
            entity: { attributeId, noteId: note.noteId, type: "label", name: "color", value: "red" },
            componentId: "comp-1"
        } as unknown as EntityChange
    ]);
    loadResults.addAttribute(attributeId, "comp-1");
    return loadResults;
}

describe("Markers", () => {
    let container: HTMLElement | undefined;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);

        // A pin is drawn by handing an SVG blob to an <img> and waiting for it to load, which no DOM
        // stand-in actually does. Without this the build never resolves and nothing is ever put on
        // the map.
        vi.stubGlobal("Image", class {
            onload: (() => void) | null = null;
            onerror: (() => void) | null = null;
            set src(_value: string) {
                setTimeout(() => this.onload?.());
            }
        });
        vi.stubGlobal("URL", { ...URL, createObjectURL: () => "blob:pin", revokeObjectURL: () => {} });
    });

    afterEach(() => {
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
        vi.unstubAllGlobals();
    });

    /** Renders into the same container, so calling it again is a re-render with fresh props. */
    function mount(notes: FNote[], map: ReturnType<typeof fakeMap>, parent: Component, look?: { hideLabels?: boolean, isDarkTheme?: boolean, clustered?: boolean, placing?: boolean, opensNotes?: boolean }) {
        return act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <ParentMap.Provider value={map as never}>
                        <Markers
                            notes={notes}
                            hideLabels={look?.hideLabels ?? false}
                            isDarkTheme={look?.isDarkTheme ?? false}
                            clustered={look?.clustered ?? false}
                            placing={look?.placing ?? false}
                            // What these tests are about, so on unless a case says otherwise. The geo
                            // map itself passes false, a marker being opened into the detail pane
                            // there instead (see index.tsx).
                            opensNotes={look?.opensNotes ?? true}
                        />
                    </ParentMap.Provider>
                </ParentComponent.Provider>,
                container as HTMLElement
            );
        });
    }

    it("redraws rather than rebuilds when a note changes", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        const parent = new Component();

        await mount([ note ], map, parent);
        // The style arrives after the component is up, as it does on a real map.
        await act(async () => {
            map.fireStyleLoad();
            await settle();
        });

        expect(map.getLayer(MARKER_LAYER)).toBeTruthy();
        expect(map.calls.addLayer).toBe(1);
        expect(map.lastFeatures).toHaveLength(1);
        const setDataBefore = map.calls.setData;

        // One note is recoloured.
        await act(async () => {
            await parent.handleEvent("entitiesReloaded", { loadResults: colourChanged(note) });
            await settle();
        });
        // The rebuild is started by the effect act() flushes on its way out, so its promise chain
        // only runs once act has returned.
        await act(async () => { await settle(); });

        // The layer stood throughout — it was handed fresh data rather than torn down and remade.
        expect(map.calls.removeLayer).toBe(0);
        expect(map.calls.removeSource).toBe(0);
        expect(map.calls.addLayer).toBe(1);
        expect(map.calls.setData).toBeGreaterThan(setDataBefore);
        expect(map.lastFeatures).toHaveLength(1);
    });

    it("repaints rather than rebuilds when the map switches between a light and a dark style", async () => {
        // The same array both times, as the view hands it over: the notes shown are keyed on the
        // note itself, and switching the style is nothing to do with them.
        const notes = [ buildNote({ title: "Somewhere", "#geolocation": "1,2" }) ];
        const map = fakeMap();
        const parent = new Component();

        await mount(notes, map, parent);
        await act(async () => {
            map.fireStyleLoad();
            await settle();
        });

        expect(map.layer(MARKER_LAYER)?.paint?.["text-color"]).toBe("#333");
        expect(map.layer(MARKER_LAYER)?.layout?.["text-field"]).toEqual([ "get", "name" ]);
        const setDataBefore = map.calls.setData;

        // The map is switched to a dark style, and its titles hidden.
        await mount(notes, map, parent, { isDarkTheme: true, hideLabels: true });
        await act(async () => { await settle(); });

        // The layer stood throughout, and the markers were never built again for it.
        expect(map.calls.removeLayer).toBe(0);
        expect(map.calls.removeSource).toBe(0);
        expect(map.calls.addLayer).toBe(1);
        expect(map.calls.setData).toBe(setDataBefore);

        expect(map.property(MARKER_LAYER, "text-color")).toBe("#fff");
        expect(map.property(MARKER_LAYER, "text-halo-color")).toBe("rgba(0, 0, 0, 0.8)");
        expect(map.property(MARKER_LAYER, "text-field")).toBe("");
    });

    it("gives a layer added after a style switch the look it is being shown with", async () => {
        const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const map = fakeMap();
        const parent = new Component();

        // Dark from the outset, so the first layer this map is given is the one under test.
        await mount([ note ], map, parent, { isDarkTheme: true, hideLabels: true });
        await act(async () => {
            map.fireStyleLoad();
            await settle();
        });

        expect(map.layer(MARKER_LAYER)?.paint?.["text-color"]).toBe("#fff");
        expect(map.layer(MARKER_LAYER)?.paint?.["text-halo-color"]).toBe("rgba(0, 0, 0, 0.8)");
        expect(map.layer(MARKER_LAYER)?.layout?.["text-field"]).toBe("");
        // Hiding the titles empties the field rather than dropping the layout, so the rest of it
        // still has to be there for showing them again to be a single property.
        expect(map.layer(MARKER_LAYER)?.layout?.["text-optional"]).toBe(true);
    });

    /**
     * Regression test for crowded notes appearing to vanish as the map was zoomed.
     *
     * Clustering was turned on at the source without anything being drawn for the groups it makes.
     * A clustered source hands its groups out through the same source as the notes it left alone,
     * and a group carries none of a note's properties — no `icon`, so the pin layer had no image to
     * stamp for one, and no `name`, so it had no title either. The pins therefore thinned out as the
     * map zoomed and nothing took their place, which read as markers flickering in and out at random
     * rather than as notes being gathered together.
     */
    it("draws a bubble for each group of notes and keeps the pins off them", async () => {
        const notes = [
            buildNote({ title: "One", "#geolocation": "1,2" }),
            buildNote({ title: "Two", "#geolocation": "1.001,2.001" })
        ];
        const map = fakeMap();
        const parent = new Component();

        await mount(notes, map, parent, { clustered: true });
        await act(async () => {
            map.fireStyleLoad();
            await settle();
        });

        // The source groups them; the pin layer is told to leave those groups alone.
        expect(map.source(MARKER_SOURCE)).toMatchObject({ cluster: true });
        expect(map.layer(MARKER_LAYER)?.filter).toEqual([ "!", [ "has", "point_count" ] ]);

        // ...and something is drawn in their place: a bubble, and the count that gives it meaning.
        expect(map.calls.addLayer).toBe(CLUSTERED_LAYER_COUNT);
        expect(map.layer(CLUSTER_LAYER)?.filter).toEqual([ "has", "point_count" ]);
        expect(map.layer(CLUSTER_COUNT_LAYER)?.filter).toEqual([ "has", "point_count" ]);
        expect(map.layer(CLUSTER_COUNT_LAYER)?.layout?.["text-field"]).toEqual([ "get", "point_count_abbreviated" ]);
        // A count that loses a placement contest leaves a bubble that means nothing.
        expect(map.layer(CLUSTER_COUNT_LAYER)?.layout?.["text-allow-overlap"]).toBe(true);
    });

    it("leaves every note its own pin when the map is not set to gather them", async () => {
        const notes = [
            buildNote({ title: "One", "#geolocation": "1,2" }),
            buildNote({ title: "Two", "#geolocation": "1.001,2.001" })
        ];
        const map = fakeMap();
        const parent = new Component();

        await mount(notes, map, parent);
        await act(async () => {
            map.fireStyleLoad();
            await settle();
        });

        expect(map.source(MARKER_SOURCE)).not.toMatchObject({ cluster: true });
        expect(map.layer(CLUSTER_LAYER)).toBeUndefined();
        expect(map.layer(CLUSTER_COUNT_LAYER)).toBeUndefined();
        expect(map.calls.addLayer).toBe(1);
        // The pin layer keeps its filter either way — a source that gathers nothing produces no
        // group for it to hide, so it passes every note through.
        expect(map.lastFeatures).toHaveLength(2);
    });

    /**
     * Whether a source gathers its notes is fixed when the source is made: MapLibre offers no way to
     * set `cluster` on one already standing, so the toggle has to take the source down and put a new
     * one up. Everything else about this component is careful *not* to rebuild; this is the one case
     * where rebuilding is the only thing that works, and it is easy to "optimise" back into a toggle
     * that silently does nothing.
     */
    it("rebuilds the source when the map is switched to gathering its notes", async () => {
        const notes = [ buildNote({ title: "One", "#geolocation": "1,2" }) ];
        const map = fakeMap();
        const parent = new Component();

        await mount(notes, map, parent);
        await act(async () => {
            map.fireStyleLoad();
            await settle();
        });
        expect(map.calls.addSource).toBe(1);
        expect(map.source(MARKER_SOURCE)).not.toMatchObject({ cluster: true });

        await mount(notes, map, parent, { clustered: true });
        await act(async () => { await settle(); });

        // The old source went and a clustered one took its place, bubbles and all.
        expect(map.calls.removeSource).toBe(1);
        expect(map.calls.addSource).toBe(2);
        expect(map.source(MARKER_SOURCE)).toMatchObject({ cluster: true });
        expect(map.layer(CLUSTER_LAYER)).toBeDefined();
        // ...and the markers are back on it rather than waiting on a fresh build.
        expect(map.lastFeatures).toHaveLength(1);
    });

    it("takes the layer down when the component goes away", async () => {
        const note = buildNote({ title: "Somewhere else", "#geolocation": "3,4" });
        const map = fakeMap();
        const parent = new Component();

        await mount([ note ], map, parent);
        await act(async () => {
            map.fireStyleLoad();
            await settle();
        });
        expect(map.calls.addLayer).toBe(1);

        await act(async () => {
            render(null, container as HTMLElement);
        });

        expect(map.calls.removeLayer).toBe(1);
        expect(map.calls.removeSource).toBe(1);
    });

    /**
     * Switching away from a geo map used to throw `can't access property "getLayer", this.style is
     * undefined`. The map is removed by the component above this one, and Preact runs a component's
     * cleanup before its children's, so this cleanup was handed a map whose style had already gone.
     * The throw was not confined to it either: Preact hands a cleanup's error to the nearest error
     * boundary and, finding none, rethrows it in the middle of unmounting the tree — so the GPX
     * tracks rendered after this component were never unmounted, and kept their markers and
     * listeners on a map nobody could see any more.
     */
    it("survives the map being removed before it is unmounted", async () => {
        const note = buildNote({ title: "Nowhere", "#geolocation": "5,6" });
        const map = fakeMap();
        const parent = new Component();

        await mount([ note ], map, parent);
        await act(async () => {
            map.fireStyleLoad();
            await settle();
        });
        expect(map.calls.addLayer).toBe(1);

        map.remove();

        expect(() => render(null, container as HTMLElement)).not.toThrow();
        // The layer went with the map, so there was nothing to take off it.
        expect(map.calls.removeLayer).toBe(0);
        expect(map.calls.removeSource).toBe(0);
    });

    /**
     * What a click on a marker is for.
     *
     * A note used to open only on a map that could not be edited, since on one that could the mouse
     * belonged to dragging the marker. Nothing is dragged any more — a marker is moved by being
     * placed again, from its own context menu — so a click means the same thing on every map.
     */
    describe("opening a note", () => {
        let openInPopup: ReturnType<typeof vi.spyOn>;

        beforeEach(() => {
            openInPopup = vi.spyOn(appContext, "triggerCommand").mockResolvedValue(undefined);
        });

        afterEach(() => openInPopup.mockRestore());

        it("opens the note behind the marker that was clicked", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            await mount([ note ], map, new Component());

            map.enterMarker();
            // A marker is a thing to be opened, and says so before it is.
            expect(map.cursor).toBe("pointer");

            map.clickMarker(note);
            expect(openInPopup).toHaveBeenCalledWith("openInPopup", { noteIdOrPath: note.noteId });
        });

        it("leaves the click alone where something else on the map has taken it over", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            await mount([ note ], map, new Component(), { opensNotes: false });

            // What the geo map itself passes: a marker is opened into the detail pane there, and
            // raising the quick editor as well would put it over the pane that had just opened.
            map.clickMarker(note);
            expect(openInPopup).not.toHaveBeenCalled();
        });

        it("leaves the click alone while the map is armed to place something", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            await mount([ note ], map, new Component(), { placing: true });

            // The click belongs to the placement, which is handled where that state lives: opening
            // the note as well would both put the marker down and open the note it landed on.
            map.clickMarker(note);
            expect(openInPopup).not.toHaveBeenCalled();
        });

        /**
         * Relocation is armed from the marker's own context menu, so the pointer is almost always
         * sitting on a marker at the moment the opening handlers are taken off — and the `mouseleave`
         * that would have cleared the cursor is no longer being listened for. The map would be left
         * offering to open a note while waiting to be told where to put one.
         */
        it("puts the cursor back when it is disarmed with the pointer on a marker", async () => {
            const note = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
            const map = fakeMap();
            const parent = new Component();
            await mount([ note ], map, parent);

            map.enterMarker();
            expect(map.cursor).toBe("pointer");

            await mount([ note ], map, parent, { placing: true });
            expect(map.cursor).toBe("");
        });
    });
});
