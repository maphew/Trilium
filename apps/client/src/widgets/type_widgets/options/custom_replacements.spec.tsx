import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

/** The option as the store holds it, every value written to it, and who is watching it. */
const state = vi.hoisted(() => ({
    stored: "[]",
    writes: [] as string[],
    watchers: new Set<(newValue: string) => void>()
}));

// Only `useTriliumOption` is replaced — the rest of the module stays real, so the buttons and text
// boxes this renders keep the hooks they use.
//
// The stand-in holds the value in state and re-reads it when the store changes, as the real hook
// does through `entitiesReloaded`. That is the whole point here: the bug is about the option moving
// underneath a mounted page, and a stand-in that only returned the current value would never
// reproduce it.
vi.mock("../../react/hooks", async (importOriginal) => {
    const { useEffect: onMount, useState: useLocal } = await import("preact/hooks");
    return {
        ...(await importOriginal<typeof import("../../react/hooks")>()),
        useTriliumOption: () => {
            const [ value, setValue ] = useLocal(state.stored);
            onMount(() => {
                state.watchers.add(setValue);
                return () => void state.watchers.delete(setValue);
            }, []);
            return [
                value,
                (newValue: string) => {
                    state.writes.push(newValue);
                    writeStore(newValue);
                    return Promise.resolve();
                }
            ];
        }
    };
});

/** Puts a value in the store and tells everyone reading it, the way an entity reload would. */
function writeStore(newValue: string) {
    state.stored = newValue;
    for (const watcher of state.watchers) watcher(newValue);
}

vi.mock("../../../services/i18n", () => ({ t: (key: string) => key }));

import { parseCustomReplacements } from "../text/replacements";
import { CustomReplacements } from "./text_notes";

/** Renders the editor and returns the container, so its inputs can be driven. */
function renderEditor() {
    const container = document.createElement("div");
    document.body.append(container);
    act(() => render(<CustomReplacements />, container));
    return container;
}

const inputs = (container: HTMLElement) => [ ...container.querySelectorAll("input") ];

/**
 * Leaving a field, which is what commits the rows. Dispatched as `focusout`: preact/compat is loaded
 * across the module graph and, like React, implements `onBlur` over the bubbling event rather than
 * the native `blur`, which does not bubble.
 */
function blur(input: HTMLInputElement) {
    act(() => {
        input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
}

afterEach(() => {
    state.stored = "[]";
    state.writes = [];
    state.watchers.clear();
    document.body.innerHTML = "";
});

describe("CustomReplacements", () => {
    it("shows the stored pairs", () => {
        state.stored = `[{"from":"TN","to":"Trilium Notes"}]`;

        expect(inputs(renderEditor()).map((input) => input.value)).toEqual([ "TN", "Trilium Notes" ]);
    });

    it("writes the rows when a field is left, not on every keystroke", () => {
        state.stored = `[{"from":"TN","to":"Trilium Notes"}]`;
        const container = renderEditor();
        const [ from ] = inputs(container);

        act(() => {
            from.value = "TNX";
            from.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(state.writes, "typing alone must not reach the server").toEqual([]);

        blur(from);
        expect(parseCustomReplacements(state.writes.at(-1))).toEqual([ { from: "TNX", to: "Trilium Notes" } ]);
    });

    it("takes up a list that arrived from elsewhere instead of writing over it", () => {
        // The reported case: the option changes underneath the open page — synced from another
        // device, or saved by a second settings tab. Rows read once at mount would stay as they
        // were, and the next blur would put the stale list back over the newer one.
        state.stored = `[{"from":"TN","to":"Trilium Notes"}]`;
        const container = renderEditor();

        act(() => writeStore(`[{"from":"CT","to":"CherryTree"}]`));

        expect(inputs(container).map((input) => input.value)).toEqual([ "CT", "CherryTree" ]);

        // ...and leaving a field now writes what arrived, rather than resurrecting what it replaced.
        blur(inputs(container)[0]);
        expect(parseCustomReplacements(state.writes.at(-1))).toEqual([ { from: "CT", to: "CherryTree" } ]);
    });

    it("does not delete a half-written row when a list arrives mid-edit", () => {
        // Adopting the arriving list outright would take the caret's row with it. What is on screen
        // is the later intent of the two, and the blur that ends the edit is what writes it.
        state.stored = `[{"from":"TN","to":"Trilium Notes"}]`;
        const container = renderEditor();
        const [ from ] = inputs(container);

        from.focus();
        act(() => {
            from.value = "TNX";
            from.dispatchEvent(new Event("input", { bubbles: true }));
        });

        act(() => writeStore(`[{"from":"CT","to":"CherryTree"}]`));

        expect(inputs(container).map((input) => input.value)).toEqual([ "TNX", "Trilium Notes" ]);

        blur(from);
        expect(parseCustomReplacements(state.writes.at(-1))).toEqual([ { from: "TNX", to: "Trilium Notes" } ]);
    });

    it("still takes the list when a field only holds the focus", () => {
        // Focus alone is not an edit — there is nothing under the caret to lose, so waiting for a
        // blur that may never come would leave the page showing a list that no longer exists.
        state.stored = `[{"from":"TN","to":"Trilium Notes"}]`;
        const container = renderEditor();

        inputs(container)[0].focus();
        act(() => writeStore(`[{"from":"CT","to":"CherryTree"}]`));

        expect(inputs(container).map((input) => input.value)).toEqual([ "CT", "CherryTree" ]);
    });

    it("keeps what is being typed when the option settles to what we just wrote", () => {
        // Our own save comes back through the same subscription; re-reading it then would throw away
        // whatever had been typed since, and move the caret.
        state.stored = `[{"from":"TN","to":"Trilium Notes"}]`;
        const container = renderEditor();
        const [ from ] = inputs(container);

        act(() => {
            from.value = "TNX";
            from.dispatchEvent(new Event("input", { bubbles: true }));
        });
        blur(from);

        expect(inputs(container).map((input) => input.value)).toEqual([ "TNX", "Trilium Notes" ]);
    });
});
