/**
 * The menus a geo map opens on a right click, and in particular the one way a marker can be put
 * somewhere else.
 *
 * The notes are drawn into a single symbol layer rather than an element apiece, so there is no marker
 * to take hold of and dragging one is gone: relocation is asking for it here and clicking where it
 * should go. What is checked is that the offer is made only where the map may be edited, and that it
 * names the note whose marker was clicked rather than the map or the last note read.
 */
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import type { MenuCommandItem, MenuItem } from "../../../menus/context_menu";
import { buildNote } from "../../../test/easy-froca";
import { renderInto } from "../../../test/render";
import ContextMenus from "./ContextMenus";
import { ParentMap } from "./map";
import { MARKER_LAYER } from "./Markers";

// t() returns the key, so the assertions below are on which item is offered rather than on its
// English wording.
vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

const { show } = vi.hoisted(() => ({ show: vi.fn() }));
vi.mock("../../../menus/context_menu", () => ({ default: { show } }));

// The items a note's link brings with it are that menu's business, not this one's.
vi.mock("../../../menus/link_context_menu", () => ({
    default: { getItems: () => [], handleLinkContextMenuItem: vi.fn() }
}));

vi.mock("../../../menus/custom-items/NoteColorPicker", () => ({ default: () => null }));

/** A map that reports what is under a click and delegates its own, which is all this component asks. */
function fakeMap(markerUnderPointer?: FNote) {
    const listeners = new Set<(e: unknown) => void>();

    return {
        on(event: string, fn: (e: unknown) => void) { if (event === "contextmenu") listeners.add(fn); },
        off(event: string, fn: (e: unknown) => void) { if (event === "contextmenu") listeners.delete(fn); },
        queryRenderedFeatures: (_point: unknown, options: { layers: string[] }) =>
            markerUnderPointer && options.layers.includes(MARKER_LAYER)
                ? [ { properties: { id: markerUnderPointer.noteId } } ]
                : [],
        /** The map being right-clicked, as MapLibre reports it. */
        rightClick() {
            for (const fn of listeners) {
                fn({
                    lngLat: { lat: 1, lng: 2 },
                    point: { x: 10, y: 20 },
                    originalEvent: new MouseEvent("contextmenu"),
                    preventDefault: vi.fn()
                });
            }
        }
    };
}

/** Opens the menu over the given map and hands back the items it was shown with. */
async function openMenu(map: ReturnType<typeof fakeMap>, { isReadOnly = false, onRelocate = vi.fn() } = {}) {
    const note = buildNote({ title: "The map itself" });
    // Settled before the map is clicked: the listener the menu opens from is bound in an effect, and
    // effects do not run within the render itself.
    await act(async () => {
        renderInto(
            <ParentMap.Provider value={map as never}>
                <ContextMenus note={note} isReadOnly={isReadOnly} onRelocate={onRelocate} />
            </ParentMap.Provider>
        );
    });

    show.mockClear();
    act(() => { map.rightClick(); });

    const items: MenuItem<string>[] = show.mock.calls[0]?.[0]?.items ?? [];
    return { items, onRelocate };
}

/** The item offering to move a marker, where one was offered. */
function moveItem(items: MenuItem<string>[]) {
    return items.find((item): item is MenuCommandItem<string> =>
        "title" in item && item.title === "geo-map-context.move-marker");
}

describe("ContextMenus", () => {
    it("offers to move the marker that was clicked, and says which note it belongs to", async () => {
        const marker = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const { items, onRelocate } = await openMenu(fakeMap(marker));

        const move = moveItem(items);
        expect(move).toBeDefined();
        move?.handler?.(move, undefined as never);
        expect(onRelocate).toHaveBeenCalledWith(marker.noteId);
    });

    it("does not offer to move a marker on a map that may not be edited", async () => {
        const marker = buildNote({ title: "Somewhere", "#geolocation": "1,2" });
        const { items } = await openMenu(fakeMap(marker), { isReadOnly: true });

        expect(moveItem(items)).toBeUndefined();
        // Nor anything else that would change the map.
        expect(items).not.toContainEqual(expect.objectContaining({ title: "geo-map-context.remove-from-map" }));
    });

    it("offers nothing to move where the click landed on no marker at all", async () => {
        const { items } = await openMenu(fakeMap());

        expect(moveItem(items)).toBeUndefined();
        expect(items).toContainEqual(expect.objectContaining({ title: "geo-map-context.add-note" }));
    });
});
