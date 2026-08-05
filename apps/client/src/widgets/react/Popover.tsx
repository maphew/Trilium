import "./Popover.css";

import { createPopper, Placement, VirtualElement } from "@popperjs/core";
import clsx from "clsx";
import { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useEffect, useRef } from "preact/hooks";

export interface PopoverProps {
    /**
     * Where the popover points: a rectangle in viewport coordinates, asked for afresh on every
     * reposition. A function rather than a rect or an element, so an anchor that is redrawn by
     * whatever it stands on — a canvas re-rendering its selection, say — is followed rather than
     * remembered.
     */
    getAnchorRect(): DOMRect;
    /** Which side of the anchor to stand on, flipped away from the viewport's edges as needed. */
    placement?: Placement;
    className?: string;
    /** Called on a press outside the popover; the owner decides what being dismissed means. The
     *  press itself still lands where it fell — dismissal must not swallow it, or pressing the
     *  thing the popover stands beside would take two tries. */
    onDismiss?(): void;
    children: ComponentChildren;
}

/**
 * A small surface anchored beside something — a dragged-out calendar range, a clicked chip —
 * rather than docked at an edge or centred as a dialog. Portaled to the body, so no scroll
 * container clips it and no containment root flattens its frosting (see the Dropdown notes in
 * CLAUDE.md); positioned by Popper, which also keeps it in place while ancestors scroll.
 */
export default function Popover({ getAnchorRect, placement, className, onDismiss, children }: PopoverProps) {
    const elRef = useRef<HTMLDivElement>(null);

    // Held in a ref so the popper built once keeps asking the newest question — rebuilding it on
    // every render would reset the positioning mid-interaction.
    const getRectRef = useRef(getAnchorRect);
    getRectRef.current = getAnchorRect;

    useEffect(() => {
        const el = elRef.current;
        if (!el) return;

        const anchor: VirtualElement = { getBoundingClientRect: () => getRectRef.current() };
        const popper = createPopper(anchor, el, {
            placement: placement ?? "right-start",
            // Fixed, as the element stands in the body rather than beside its anchor.
            strategy: "fixed",
            modifiers: [
                { name: "offset", options: { offset: [ 0, 12 ] } },
                { name: "preventOverflow", options: { padding: 8 } }
            ]
        });

        return () => popper.destroy();
    }, [ placement ]);

    useEffect(() => {
        if (!onDismiss) return;

        const onPointerDown = (e: PointerEvent) => {
            const el = elRef.current;
            if (el && e.target instanceof Node && !el.contains(e.target)) {
                onDismiss();
            }
        };
        // Captured, so the popover hears of the press wherever it lands — including places that
        // stop propagation for reasons of their own.
        document.addEventListener("pointerdown", onPointerDown, true);
        return () => document.removeEventListener("pointerdown", onPointerDown, true);
    }, [ onDismiss ]);

    return createPortal(
        <div ref={elRef} className={clsx("tn-popover", className)}>
            {children}
        </div>,
        document.body
    );
}
