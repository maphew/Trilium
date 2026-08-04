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

import Component from "../../../components/component";
import type FNote from "../../../entities/fnote";
import type { EntityChange } from "../../../server_types";
import LoadResults from "../../../services/load_results";
import { buildNote } from "../../../test/easy-froca";
import { ParentComponent } from "../../react/react_utils";
import { ParentMap } from "./map";
import Markers, { MARKER_LAYER } from "./Markers";

vi.mock("../../../services/icon_glyphs", () => ({
    renderIconImage: vi.fn(async () => "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=")
}));

/** A map that records what the component does to it, standing in for MapLibre. */
function fakeMap() {
    const layers = new Set<string>();
    const sources = new Set<string>();
    const listeners = new Map<string, Set<() => void>>();
    const calls = { addLayer: 0, removeLayer: 0, addSource: 0, removeSource: 0, setData: 0 };
    let lastFeatures: unknown[] = [];
    let removed = false;

    /** What every style-reading call becomes once the map is gone: `this.style is undefined`. */
    function requireStyle() {
        if (removed) throw new TypeError("can't access property \"getLayer\", this.style is undefined");
    }

    return {
        calls,
        get lastFeatures() { return lastFeatures; },
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
        on(event: string, fn: () => void) {
            if (!listeners.has(event)) listeners.set(event, new Set());
            listeners.get(event)?.add(fn);
        },
        off(event: string, fn: () => void) {
            listeners.get(event)?.delete(fn);
        },
        isStyleLoaded: () => false,
        hasImage: () => false,
        addImage: () => {},
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
        addSource(id: string) { sources.add(id); calls.addSource++; },
        removeSource(id: string) { sources.delete(id); calls.removeSource++; },
        getLayer: (id: string) => {
            requireStyle();
            return layers.has(id) ? { id } : undefined;
        },
        addLayer({ id }: { id: string }) { layers.add(id); calls.addLayer++; },
        removeLayer(id: string) { layers.delete(id); calls.removeLayer++; }
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

    function mount(notes: FNote[], map: ReturnType<typeof fakeMap>, parent: Component) {
        return act(async () => {
            render(
                <ParentComponent.Provider value={parent}>
                    <ParentMap.Provider value={map as never}>
                        <Markers notes={notes} hideLabels={false} isDarkTheme={false} />
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
});
