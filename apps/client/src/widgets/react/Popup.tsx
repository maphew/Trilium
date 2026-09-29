import "./Popup.css";

import { autoUpdate, computePosition, flip, offset, type Placement, type ReferenceElement, shift, size } from "@floating-ui/dom";
import clsx from "clsx";
import type { ComponentChildren, HTMLAttributes } from "preact";
import { createPortal } from "preact/compat";
import { useLayoutEffect, useRef } from "preact/hooks";

/**
 * A surface that stands beside something rather than in the page's flow: a dropdown's menu, and
 * anything else that pops up from a control or at a point. It knows nothing of what it holds; it
 * places itself, keeps inside the viewport, and says when it is dismissed.
 */
export interface PopupProps {
    /** What it stands beside: an element, or a point in the viewport such as where a right-click landed. */
    anchor: HTMLElement | { x: number, y: number };
    /**
     * The side of the anchor it prefers, flipped to the other side where that one has no room.
     * Below the anchor, lined up with its start, by default.
     */
    placement?: Placement;
    /** The gap, in pixels, it keeps from its anchor. */
    offset?: number;
    /**
     * Called on a press outside it and its anchor, and on Escape. A press on the anchor is left to
     * the anchor, as a dropdown's toggle closes its own popup.
     */
    onDismiss(reason: "outside" | "escape"): void;
    id?: string;
    className?: string;
    role?: HTMLAttributes<HTMLDivElement>["role"];
    children?: ComponentChildren;
}

/** How many pixels it keeps from the edges of the viewport. */
const VIEWPORT_PADDING = 5;

export default function Popup({ anchor, placement = "bottom-start", offset: gap = 0, onDismiss, id, className, role, children }: PopupProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const anchorX = "x" in anchor ? anchor.x : undefined;
    const anchorY = "y" in anchor ? anchor.y : undefined;

    useLayoutEffect(() => {
        const popup = popupRef.current;
        if (!popup) return;
        const reference = anchor instanceof HTMLElement ? anchor : pointAt(anchor.x, anchor.y);
        // Places it now, and again whenever its anchor moves or the viewport or it changes size.
        return autoUpdate(reference, popup, () => void placePopup(popup, reference, placement, gap));
    }, [ anchor instanceof HTMLElement ? anchor : undefined, anchorX, anchorY, placement, gap ]);

    const dismiss = useRef(onDismiss);
    dismiss.current = onDismiss;
    useLayoutEffect(() => {
        // Captured at the window, so a host that stops its own presses, as the note tree does,
        // cannot keep them from here, and so Escape arrives before Bootstrap's handler for keys in
        // a `.dropdown-menu`, which looks for a toggle beside the popup and crashes without one.
        const onPointerDown = (e: PointerEvent) => {
            const target = e.target as Node;
            if (popupRef.current?.contains(target)) return;
            if (anchor instanceof HTMLElement && anchor.contains(target)) return;
            dismiss.current("outside");
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            // A dialog under it stays open.
            e.stopPropagation();
            dismiss.current("escape");
        };
        window.addEventListener("pointerdown", onPointerDown, true);
        window.addEventListener("keydown", onKeyDown, true);
        return () => {
            window.removeEventListener("pointerdown", onPointerDown, true);
            window.removeEventListener("keydown", onKeyDown, true);
        };
    }, [ anchor ]);

    // Out of any ancestor that would clip it or, with a transform or a filter, place its fixed
    // position against itself. A browser showing an element fullscreen paints only that element.
    return createPortal((
        <div ref={popupRef} id={id} role={role} className={clsx("tn-popup", className)}>
            {children}
        </div>
    ), document.fullscreenElement ?? document.body);
}

/**
 * Positions `popup` beside `anchor`, preferring `placement` and flipping to the other side where
 * that has no room, and caps its height to the room on the side it takes. It stays hidden until
 * placed, so it never paints at a stale position.
 */
async function placePopup(popup: HTMLElement, anchor: ReferenceElement, placement: Placement, gap: number) {
    const { x, y } = await computePosition(anchor, popup, {
        strategy: "fixed",
        placement,
        middleware: [
            offset(gap),
            flip({ padding: VIEWPORT_PADDING }),
            // Over a point it can also move across the side it stands on, as a popup wider than
            // the room on either side of the point must; an element it must not cover.
            shift({ crossAxis: !(anchor instanceof HTMLElement), padding: VIEWPORT_PADDING }),
            size({
                padding: VIEWPORT_PADDING,
                apply({ availableHeight }) {
                    popup.style.maxHeight = `${availableHeight}px`;
                }
            })
        ]
    });

    popup.style.left = `${x}px`;
    popup.style.top = `${y}px`;
    popup.style.visibility = "visible";
}

/** A zero-size anchor at a point in the viewport. */
function pointAt(x: number, y: number): ReferenceElement {
    return {
        getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 })
    };
}
