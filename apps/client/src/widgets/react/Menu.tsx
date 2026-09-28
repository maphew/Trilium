import "./Menu.css";

import { computePosition, flip, type Placement, shift, size, type VirtualElement } from "@floating-ui/dom";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";

import { useResizeObserver } from "./hooks";

export interface MenuProps {
    /** Where the menu opens, in viewport coordinates. */
    x: number;
    y: number;
    /** Opens the menu towards the left of {@link x} instead of towards the right. */
    orientation?: "left";
}

/** How many pixels the menu keeps from the edges of the viewport. */
const VIEWPORT_PADDING = 5;

export default function Menu({ x, y, orientation }: MenuProps) {
    const menuRef = useRef<HTMLDivElement>(null);
    const place = useCallback(() => {
        if (!menuRef.current) return;
        void placeMenu(menuRef.current, pointAt(x, y), orientation === "left" ? "left-start" : "right-start");
    }, [ x, y, orientation ]);

    useLayoutEffect(place, [ place ]);
    // The menu's size can change after it opens, e.g. once asynchronously loaded items arrive.
    useResizeObserver(menuRef, place);

    return (
        <div ref={menuRef} className="tn-menu" role="menu">
            Hello world
        </div>
    );
}

/**
 * Positions `menu` beside `anchor`, preferring `placement` and then the placements that mirror it,
 * the way a native menu opens above or to the left of a pointer that is near the viewport's edge.
 * The menu stays hidden until it is placed, so it never paints at a stale position.
 */
async function placeMenu(menu: HTMLElement, anchor: VirtualElement, placement: Placement) {
    const [ side ] = placement.split("-");
    const otherSide = side === "left" ? "right" : "left";
    const { x, y } = await computePosition(anchor, menu, {
        strategy: "fixed",
        placement,
        middleware: [
            flip({
                fallbackPlacements: [ `${otherSide}-start`, `${side}-end`, `${otherSide}-end` ] as Placement[],
                padding: VIEWPORT_PADDING
            }),
            // `crossAxis` also shifts a menu wider than the room on either side of its anchor.
            shift({ crossAxis: true, padding: VIEWPORT_PADDING }),
            size({
                padding: VIEWPORT_PADDING,
                apply({ availableHeight }) {
                    menu.style.maxHeight = `${availableHeight}px`;
                }
            })
        ]
    });

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = "visible";
}

/** A zero-size anchor at a point in the viewport, such as where a right-click landed. */
function pointAt(x: number, y: number): VirtualElement {
    return {
        getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 })
    };
}
