/**
 * The geo map search bar: which results a query produces, and what picking one does to the map.
 * Results come from the dummy provider, so these cover the bar rather than any one geocoder.
 */
import type { Map as MapLibreGLMap } from "maplibre-gl";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../../test/render";
import { ParentMap } from "./map";
import SearchBox from "./SearchBox";

/** A map that can be flown somewhere, which is all the bar uses. */
function fakeMap() {
    return { flyTo: vi.fn() };
}

function renderSearchBox(map: ReturnType<typeof fakeMap> | null) {
    let container: HTMLElement | undefined;
    act(() => {
        container = renderInto(
            <ParentMap.Provider value={map as unknown as MapLibreGLMap}>
                <SearchBox />
            </ParentMap.Provider>
        );
    });
    if (!container) throw new Error("the search bar was not rendered");
    return container;
}

function field(container: HTMLElement) {
    const input = container.querySelector<HTMLInputElement>("input.geo-search-input");
    if (!input) throw new Error("the search bar has no field");
    return input;
}

/** Types into the field and runs out the debounced lookup. */
async function type(container: HTMLElement, text: string) {
    const input = field(container);
    // Two acts: the field has to re-render as open before the effect that schedules the lookup runs,
    // so advancing the timers in the same act would find nothing scheduled.
    await act(async () => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
}

/** The dropdown is portalled to the body, so look for it there rather than in the container. */
function entries() {
    return [ ...document.querySelectorAll<HTMLElement>(".form-autocomplete-dropdown .form-autocomplete-item") ];
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("geo map SearchBox", () => {
    it("lists the places a query matches, and nothing for a query below the minimum length", async () => {
        const container = renderSearchBox(fakeMap());

        await type(container, "l");
        expect(entries()).toHaveLength(0);

        await type(container, "london");
        // Two places of the same name, distinguished by the rest of the label.
        expect(entries().map((entry) => entry.textContent)).toEqual([
            "London, England, United Kingdom",
            "London, Ontario, Canada"
        ]);

        await type(container, "nowhere at all");
        expect(entries()).toHaveLength(0);
    });

    it("flies the map to the place picked and puts its name in the field", async () => {
        const map = fakeMap();
        const container = renderSearchBox(map);

        await type(container, "tokyo");
        await act(async () => { entries()[0].click(); });

        expect(map.flyTo).toHaveBeenCalledWith({ center: [ 139.6503, 35.6762 ], zoom: expect.any(Number) });
        expect(field(container).value).toBe("Tokyo, Japan");
        expect(entries()).toHaveLength(0);
    });

    it("renders nothing when the map failed to initialize", () => {
        expect(renderSearchBox(null).querySelector(".geo-search-toolbar")).toBeNull();
    });
});
