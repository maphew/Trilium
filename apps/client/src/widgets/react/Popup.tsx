import "./Popup.css";

import { autoUpdate, computePosition, flip, offset, type Placement, type ReferenceElement, shift, size } from "@floating-ui/dom";
import clsx from "clsx";
import type { ComponentChildren, HTMLAttributes } from "preact";
import { createPortal } from "preact/compat";
import { type MutableRef, useLayoutEffect, useRef } from "preact/hooks";

/**
 * A surface that stands beside something rather than in the page's flow: a dropdown's menu, and
 * anything else that pops up from a control or at a point. It knows nothing of what it holds; it
 * places itself, keeps inside the viewport, and says when it is dismissed.
 */
export interface PopupProps extends Pick<HTMLAttributes<HTMLDivElement>, "id" | "className" | "role" | "style" | "onClick" | "aria-labelledby"> {
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
     * Caps its height to the room on the side it takes, for content that scrolls in it. Without,
     * it grows past the viewport, as content that must not be clipped needs.
     */
    capHeight?: boolean;
    /**
     * Classes for an element it stands in, in the page's body, so the CSS scoped under the
     * classes of what opened it still applies there.
     */
    portalClassName?: string;
    /**
     * Leaves it where the stylesheet puts it rather than beside its anchor, as a sheet along the
     * bottom of a phone's screen is.
     */
    placedByStylesheet?: boolean;
    /** Classes for an element drawn just before it, which dims the page under it. */
    backdropClassName?: string;
    elementRef?: MutableRef<HTMLDivElement | null>;
    /** Called once it is first placed and shown: a browser focuses nothing inside it before. */
    onPlaced?(): void;
    /**
     * Called on a press outside it and its anchor, and on Escape. A press on the anchor is left to
     * the anchor, as a dropdown's toggle closes its own popup.
     */
    onDismiss(reason: "outside" | "escape"): void;
    children?: ComponentChildren;
}

/** How many pixels it keeps from the edges of the viewport. */
const VIEWPORT_PADDING = 5;

export default function Popup({ anchor, placement = "bottom-start", offset: gap = 0, capHeight = true, portalClassName, placedByStylesheet, backdropClassName, elementRef, onPlaced, onDismiss, className, children, ...elementProps }: PopupProps) {
    const popupRef = useRef<HTMLDivElement | null>(null);
    const placed = useRef(onPlaced);
    placed.current = onPlaced;
    const anchorX = "x" in anchor ? anchor.x : undefined;
    const anchorY = "y" in anchor ? anchor.y : undefined;

    useLayoutEffect(() => {
        const popup = popupRef.current;
        if (!popup) return;
        if (placedByStylesheet) {
            popup.style.visibility = "visible";
            placed.current?.();
            return;
        }
        const reference = anchor instanceof HTMLElement ? anchor : pointAt(anchor.x, anchor.y);
        let shown = false;
        // Places it now, and again whenever its anchor moves or the viewport or it changes size.
        return autoUpdate(reference, popup, () => void placePopup(popup, reference, placement, gap, capHeight).then(() => {
            if (shown) return;
            shown = true;
            placed.current?.();
        }));
    }, [ anchor instanceof HTMLElement ? anchor : undefined, anchorX, anchorY, placement, gap, capHeight, placedByStylesheet ]);

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
    const popup = (
        <div
            {...elementProps}
            ref={(element) => {
                popupRef.current = element;
                if (elementRef) elementRef.current = element;
            }}
            className={clsx("tn-popup", className)}
        >
            {children}
        </div>
    );
    const drawn = <>
        {backdropClassName && <div className={backdropClassName} />}
        {popup}
    </>;
    return createPortal(portalClassName ? <div className={portalClassName}>{drawn}</div> : drawn,
        document.fullscreenElement ?? document.body);
}

/**
 * Positions `popup` beside `anchor`, preferring `placement` and flipping to the other side where
 * that has no room, and with `capHeight` caps its height to the room on the side it takes. It
 * stays hidden until placed, so it never paints at a stale position.
 */
async function placePopup(popup: HTMLElement, anchor: ReferenceElement, placement: Placement, gap: number, capHeight: boolean) {
    const { x, y } = await computePosition(anchor, popup, {
        strategy: "fixed",
        placement,
        middleware: [
            offset(gap),
            flip({ padding: VIEWPORT_PADDING }),
            // Over a point it can also move across the side it stands on, as a popup wider than
            // the room on either side of the point must; an element it must not cover.
            shift({ crossAxis: !(anchor instanceof HTMLElement), padding: VIEWPORT_PADDING }),
            capHeight && size({
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
