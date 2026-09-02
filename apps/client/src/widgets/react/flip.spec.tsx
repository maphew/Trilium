/**
 * happy-dom lays nothing out, so every child's place is declared and moved by hand: what these
 * check is that a change of place becomes a slide, and that nothing else does.
 */
import { render } from "preact";
import { act } from "preact/test-utils";
import { useRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useFlip } from "./flip";

describe("useFlip", () => {
    let container: HTMLElement | undefined;
    let frames: (() => void)[] = [];

    beforeEach(() => {
        frames = [];
        vi.stubGlobal("requestAnimationFrame", (callback: () => void) => {
            frames.push(callback);
            return frames.length;
        });
        vi.stubGlobal("matchMedia", () => ({ matches: false }));
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        if (container) {
            render(null, container);
            container.remove();
            container = undefined;
        }
    });

    it("carries a child back to where it was, and lets go on the next frame", async () => {
        const { items } = await draw([ "a", "b" ]);
        place(items(), [ 0, 40 ]);
        await redraw();

        // The second one is pushed down by something appearing above it.
        place(items(), [ 0, 90 ]);
        await redraw();

        const [ first, second ] = items();
        expect(first.style.transform).toBe("");
        expect(second.style.transform).toBe("translateY(-50px)");
        expect(second.style.transition).toBe("none");

        act(() => { for (const frame of frames.splice(0)) frame(); });

        expect(second.style.transform).toBe("");
        expect(second.style.transition).toBe("");
    });

    it("leaves alone a child that has not moved, and one with no place at all", async () => {
        const { items } = await draw([ "a", "b" ]);
        place(items(), [ 0, 40 ]);
        await redraw();

        // The first keeps its place; the second is taken out of the flow and put back elsewhere.
        place(items(), [ 0, 40 ]);
        Object.defineProperty(items()[1], "offsetParent", { value: null, configurable: true });
        await redraw();
        expect(items().every(item => item.style.transform === "")).toBe(true);

        place(items(), [ 0, 200 ]);
        await redraw();
        expect(items()[1].style.transform).toBe("");
    });

    it("says nothing while it is switched off", async () => {
        const { items } = await draw([ "a", "b" ], true);
        place(items(), [ 0, 40 ]);
        await redraw();
        place(items(), [ 0, 90 ]);
        await redraw();

        expect(items()[1].style.transform).toBe("");
    });

    let rerender: () => Promise<void>;

    async function draw(keys: string[], disabled = false) {
        const mountPoint = document.createElement("div");
        container = mountPoint;
        document.body.appendChild(mountPoint);

        function Harness() {
            const ref = useRef<HTMLDivElement>(null);
            useFlip(ref, { selector: ".item", disabled });
            return (
                <div ref={ref}>
                    {keys.map(key => <div key={key} className="item">{key}</div>)}
                </div>
            );
        }

        rerender = async () => {
            await act(async () => { render(<Harness />, mountPoint); });
        };
        await rerender();

        return { items: () => [ ...mountPoint.querySelectorAll<HTMLElement>(".item") ] };
    }

    async function redraw() {
        await rerender();
    }

    /** happy-dom reports no offsets of its own, so each child is told where it stands. */
    function place(items: HTMLElement[], tops: number[]) {
        for (const [ index, item ] of items.entries()) {
            Object.defineProperty(item, "offsetTop", {
                value: tops[index], configurable: true, writable: true
            });
            if (!Object.getOwnPropertyDescriptor(item, "offsetParent")) {
                Object.defineProperty(item, "offsetParent", {
                    value: item.parentElement, configurable: true, writable: true
                });
            }
        }
    }
});
