import clsx from "clsx";
import { type ComponentChildren, createContext, type HTMLAttributes } from "preact";
import { useContext, useMemo, useRef } from "preact/hooks";

import type { ActionButtonProps } from "./ActionButton";
import { useStaticTooltip } from "./hooks";

interface OverlayControlGroupProps {
    /** Where the group stands and what else is peculiar to it, styled by whoever puts it there. */
    className?: string;
    /** Which way the buttons' tooltips open — away from the edge the group is pinned to. */
    titlePosition?: ActionButtonProps["titlePosition"];
    children: ComponentChildren;
}

/**
 * A run of buttons standing over content, joined edge to edge into one segmented chip: the image
 * viewer's zoom steps, and the like.
 *
 * The surface, the seams and the rounding of the two ends come from the theme (see the overlay
 * buttons in theme-next/forms.css); where the group stands is left to the caller, which is the one
 * thing that differs between them.
 *
 * Not to be confused with {@link OverlayToolbar}, the other thing that floats over content: that one
 * is a bar of separate buttons on a pane of glass, and it brings its own surface with it. This is a
 * single chip with no gaps, and it is what the app's zoom and navigation controls are built from.
 */
export default function OverlayControlGroup({ className, titlePosition, children }: OverlayControlGroupProps) {
    return (
        <div className={clsx("tn-overlay-control-group", className)}>
            <TooltipDirection.Provider value={titlePosition ?? "top"}>
                {children}
            </TooltipDirection.Provider>
        </div>
    );
}

interface OverlayControlButtonProps extends Pick<HTMLAttributes<HTMLButtonElement>, "onClick"> {
    /**
     * What the button does: shown as its tooltip, and read out as its accessible name. A readout that
     * says what it is through its own children — an index, a percentage — needs none, and is left to
     * be named by what it shows.
     */
    title?: string;
    /**
     * The boxicons name of the mark it wears (`bx-plus-circle`), for a button that speaks in a glyph.
     * Given one, the button is drawn at an icon's width; without one it is drawn at a word's, and
     * says what it has to say through its children.
     */
    icon?: string;
    /** Extra class for whatever is peculiar to this one button. */
    className?: string;
    /** Shown held down, for a button standing for a choice in force. */
    active?: boolean;
    disabled?: boolean;
    /** Overrides the direction the group hands down, for a button placed unlike its neighbours. */
    titlePosition?: ActionButtonProps["titlePosition"];
    children?: ComponentChildren;
}

/**
 * A button on such a group. It carries its own tooltip, which says the same thing its accessible name
 * does — one `title` rather than the two that would otherwise have to be kept in step — and opens the
 * way the group it stands on says, so that a group at the foot of the content does not open its
 * tooltips off the bottom edge.
 */
export function OverlayControlButton({ title, icon, className, active, disabled, titlePosition, children, ...restProps }: OverlayControlButtonProps) {
    const buttonRef = useRef<HTMLButtonElement>(null);
    const groupDirection = useContext(TooltipDirection);
    const placement = titlePosition ?? groupDirection;

    // Memoized so the tooltip is only rebuilt when what it says (or where it opens) actually changes,
    // rather than on every render of the group.
    const tooltipConfig = useMemo(() => ({ title, placement }), [ title, placement ]);
    useStaticTooltip(buttonRef, tooltipConfig);

    return (
        <button
            ref={buttonRef}
            // Driven by its onClick, so it must never act as a form's implicit submit button
            // (a <button> defaults to type="submit").
            type="button"
            className={clsx(icon ? "tn-overlay-icon-button bx" : "tn-overlay-text-button", icon, active && "active", className)}
            aria-label={title}
            disabled={disabled}
            {...restProps}
        >
            {children}
        </button>
    );
}

/** Which way the tooltips on a group open, handed down by the group rather than repeated on each button. */
const TooltipDirection = createContext<ActionButtonProps["titlePosition"]>("top");
