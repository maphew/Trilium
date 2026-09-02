import { RefObject } from "preact";
import { useCallback, useEffect, useLayoutEffect, useRef } from "preact/hooks";

/** How long a slide or a growth takes. Matches the transitions the board's own rules carry. */
export const FLIP_DURATION_MS = 200;

/** How long until a slide or a growth has run its course and what it moved stands still. */
export const FLIP_SETTLE_MS = FLIP_DURATION_MS + 40;

/**
 * How far a child moves before it is taken to have moved at all.
 *
 * Offsets are whole numbers, so a fraction of a pixel anywhere above a list rounds a share of it
 * one pixel either way. Following that draws a wave across every child for a change nobody can see.
 */
const MIN_MOVE_PX = 4;

export interface FlipOptions {
    /** Which children to follow. */
    selector: string;
    /** Which way they move. Defaults to down the container. */
    axis?: "vertical" | "horizontal";
    /**
     * Whether a child that was not there before opens out of nothing rather than arriving whole.
     * A predicate answers for one child at a time, for arrivals that announce themselves some
     * other way and would only be made restless by opening out as well.
     */
    grow?: boolean | ((child: HTMLElement) => boolean);
    /** Whether to leave them where the browser puts them. */
    disabled?: boolean;
}

/**
 * Slides a container's children from where they stood to where they now stand, and opens out the
 * ones that were not there at all.
 *
 * The children are drawn in their new places as usual, then carried back to their old ones for a
 * frame and let go, which the transition they already wear turns into a slide. A new child is
 * measured, collapsed to nothing, and let go the same way, so the room it takes is made rather
 * than found and its neighbours are moved by the growth itself.
 *
 * Positions are read as an offset from the page, which neither a scroll nor a transform of a slide
 * still running moves, together with what that offset was measured from: it is taken from whatever
 * is positioned above the child, and a change of that is a different number for the very same
 * place.
 */
export function useFlip(
    ref: RefObject<HTMLElement>, { selector, axis = "vertical", grow, disabled }: FlipOptions
) {
    // Written after every commit, so what it holds is where the children stood before this one.
    const seen = useRef(new Map<Element, Place>());
    /** Whether the container has been drawn at all: its first children arrive with it, not into it. */
    const drawn = useRef(false);
    /** Whether a growth is under way, during which the children below it are already in motion. */
    const settling = useRef(false);
    const settled = useRef<number>();

    const read = useCallback(() => {
        const places = new Map<Element, Place>();

        for (const child of ref.current?.querySelectorAll<HTMLElement>(selector) ?? []) {
            // A child out of the flow is remembered as having no place rather than forgotten, so
            // that coming back is a return and not an arrival.
            const from = child.offsetParent;
            places.set(child, from
                ? { at: axis === "vertical" ? child.offsetTop : child.offsetLeft, from }
                : { at: null, from: null });
        }

        return places;
    }, [ ref, selector, axis ]);

    useLayoutEffect(() => {
        const container = ref.current;
        if (!container) {
            seen.current.clear();
            drawn.current = false;
            return;
        }

        const before = seen.current;
        const now = read();
        const moved: { child: HTMLElement, by: number }[] = [];
        const arrived: { child: HTMLElement, size: number }[] = [];

        // Read first and write after: a style written between two reads costs a fresh layout for
        // every child that follows it.
        for (const [ element, place ] of now) {
            const child = element as HTMLElement;
            const previous = before.get(child);

            if (disabled || place.at === null) {
                continue;
            }

            if (!previous) {
                const opens = typeof grow === "function" ? grow(child) : grow;
                if (opens && drawn.current) {
                    arrived.push({
                        child,
                        size: axis === "vertical" ? child.offsetHeight : child.offsetWidth
                    });
                }
            } else if (
                // Not while a growth is running: it moves the children below it over the frames
                // that follow, and each of those reads them somewhere between where they were and
                // where they are going, which is a move only in the sense that it is under way.
                !settling.current && previous.at !== null && previous.from === place.from
                    && Math.abs(previous.at - place.at) >= MIN_MOVE_PX
            ) {
                moved.push({ child, by: previous.at - place.at });
            }
        }

        // The places as they will settle, so the next commit reads a slide still running as the
        // place it is sliding into rather than as a move of its own.
        seen.current = now;
        drawn.current = true;

        for (const { child, by } of moved) {
            slide(child, by, axis);
        }

        if (!arrived.length) {
            return;
        }

        settling.current = true;
        for (const { child, size } of arrived) {
            open(child, size, axis);
        }

        // Read again once the growth is over, so what follows is measured against where its
        // neighbours came to rest rather than against wherever it caught them.
        window.clearTimeout(settled.current);
        settled.current = window.setTimeout(() => {
            settling.current = false;
            seen.current = read();
        }, FLIP_SETTLE_MS);
    });

    useEffect(() => () => window.clearTimeout(settled.current), []);
}

/** Where a child stood, `null` while it was out of the flow, and what that was measured from. */
interface Place {
    at: number | null;
    from: Element | null;
}

/** Puts a child back where it was, and lets go of it on the next frame. */
function slide(element: HTMLElement, offset: number, axis: Axis) {
    if (isStill()) {
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

/**
 * Takes a child down to nothing and lets it out to the size it was measured at.
 *
 * The margins go with it: a child of no height still holds the space below it open, which is the
 * part of the jump that would be left.
 */
function open(element: HTMLElement, size: number, axis: Axis) {
    if (isStill()) {
        return;
    }

    const property = axis === "vertical" ? "height" : "width";
    const margin = axis === "vertical" ? "marginBlock" : "marginInline";

    element.style.transition = "none";
    element.style.overflow = "hidden";
    element.style[property] = "0px";
    element.style[margin] = "0px";

    requestAnimationFrame(() => {
        if (!element.isConnected) {
            return;
        }

        element.style.transition = `${property} ${FLIP_DURATION_MS}ms ease, `
            + `margin ${FLIP_DURATION_MS}ms ease`;
        element.style[property] = `${size}px`;
        // Cleared rather than named: what the margins go back to is the stylesheet's to say, and a
        // change of computed value is what the transition follows either way.
        element.style[margin] = "";

        window.setTimeout(() => {
            if (element.isConnected) {
                element.style.transition = "";
                element.style.overflow = "";
                element.style[property] = "";
            }
        }, FLIP_SETTLE_MS);
    });
}

type Axis = "vertical" | "horizontal";

function isStill() {
    return !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}
