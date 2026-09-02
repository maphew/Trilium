import { RefObject } from "preact";
import { useLayoutEffect, useRef } from "preact/hooks";

export interface FlipOptions {
    /** Which children to follow. */
    selector: string;
    /** Which way they move. Defaults to down the container. */
    axis?: "vertical" | "horizontal";
    /** Whether to leave them where the browser puts them. */
    disabled?: boolean;
}

/**
 * Slides a container's children from where they stood to where they now stand.
 *
 * The children are drawn in their new places as usual, then carried back to their old ones for a
 * frame and let go, which the transition they already wear turns into a slide. Nothing about the
 * layout changes: a child inserted between two others still moves them, and this only says so.
 *
 * Positions are read as an offset from the page, which neither a scroll nor a transform of a slide
 * still running moves, so neither is taken for a change of place.
 */
export function useFlip(
    ref: RefObject<HTMLElement>, { selector, axis = "vertical", disabled }: FlipOptions
) {
    // Written after every commit, so what it holds is where the children stood before this one.
    const seen = useRef(new Map<Element, number>());

    useLayoutEffect(() => {
        const container = ref.current;
        if (!container) {
            seen.current.clear();
            return;
        }

        const before = seen.current;
        const now = new Map<Element, number>();
        const moved: { child: HTMLElement, by: number }[] = [];

        // Read first and write after: a transform written between two reads costs a fresh layout
        // for every child that follows it.
        for (const child of container.querySelectorAll<HTMLElement>(selector)) {
            // A child out of the flow has no place to be moved from, and is left with none, so
            // that coming back is an arrival rather than a slide from wherever it last stood.
            if (!child.offsetParent) {
                continue;
            }

            const at = axis === "vertical" ? child.offsetTop : child.offsetLeft;
            now.set(child, at);

            const previous = before.get(child);
            if (!disabled && previous !== undefined && Math.abs(previous - at) >= 1) {
                moved.push({ child, by: previous - at });
            }
        }

        seen.current = now;

        for (const { child, by } of moved) {
            slide(child, by, axis);
        }
    });
}

/** Puts a child back where it was, and lets go of it on the next frame. */
function slide(element: HTMLElement, offset: number, axis: "vertical" | "horizontal") {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
        return;
    }

    element.style.transition = "none";
    element.style.transform = axis === "vertical"
        ? `translateY(${offset}px)`
        : `translateX(${offset}px)`;

    requestAnimationFrame(() => {
        if (element.isConnected) {
            element.style.transition = "";
            element.style.transform = "";
        }
    });
}
