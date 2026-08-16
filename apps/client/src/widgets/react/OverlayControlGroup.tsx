import clsx from "clsx";
import { type ComponentChildren, createContext, type HTMLAttributes } from "preact";
import { useContext, useMemo, useRef } from "preact/hooks";

import { t } from "../../services/i18n";
import type { ActionButtonProps } from "./ActionButton";
import { useStaticTooltip } from "./hooks";

interface OverlayControlGroupProps {
    /** Where the group stands and what else is peculiar to it, styled by whoever puts it there. */
    className?: string;
    /** Which way the buttons' tooltips open — away from the edge the group is pinned to. */
    titlePosition?: ActionButtonProps["titlePosition"];
    /**
     * Keeps a press on the group from reaching what it stands on, for a group over a canvas that is
     * dragged: a map would otherwise take a press on a button for the start of a drag.
     */
    overCanvas?: boolean;
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
export default function OverlayControlGroup({ className, titlePosition, overCanvas, children }: OverlayControlGroupProps) {
    return (
        <div
            className={clsx("tn-overlay-control-group", className)}
            onMouseDown={overCanvas ? (e) => e.stopPropagation() : undefined}
        >
            <TooltipDirection.Provider value={titlePosition ?? "top"}>
                {children}
            </TooltipDirection.Provider>
        </div>
    );
}

interface OverlayControlButtonProps extends Pick<HTMLAttributes<HTMLButtonElement>, "onClick" | "aria-label"> {
    /** What the button does, said on hover. Where the button wears nothing to read, it is its name too. */
    title?: string;
    /** The boxicons name of the mark it wears (`bx-plus-circle`). */
    icon?: string;
    /** What stands inside the button: the words it wears, or the value it shows. */
    text?: ComponentChildren;
    /** Extra class for whatever is peculiar to this one button. */
    className?: string;
    /** Shown held down, for a button standing for a choice in force. */
    active?: boolean;
    disabled?: boolean;
    /** Overrides the direction the group hands down, for a button placed unlike its neighbours. */
    titlePosition?: ActionButtonProps["titlePosition"];
}

/**
 * A button on such a group, in one of two shapes: a mark, drawn at an icon's width, or something to
 * read, drawn at a word's. Given both, the mark stands beside the words — as a child rather than as a
 * class on the button, the boxicons class setting the icon font on whatever wears it and the words
 * beside it being meant to stay words.
 *
 * What it is called follows from that: a button wearing words is named by them, and one wearing only a
 * mark by its title, so that a title saying more at length never speaks over the words on the face of
 * the button. Where what it wears is neither — a keycap, a glyph standing for itself — say so with a
 * plain `aria-label`.
 *
 * Its tooltip opens the way the group it stands on says, so that a group at the foot of the content
 * does not open its tooltips off the bottom edge.
 */
export function OverlayControlButton(props: OverlayControlButtonProps) {
    const { title, icon, text, className, active, disabled, titlePosition, ...restProps } = props;
    const buttonRef = useRef<HTMLButtonElement>(null);
    const groupDirection = useContext(TooltipDirection);
    const placement = titlePosition ?? groupDirection;
    const hasText = "text" in props;

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
            className={clsx(hasText ? "tn-overlay-text-button" : [ "tn-overlay-icon-button bx", icon ], active && "active", className)}
            // A caller passing one of its own wins, for a face that is neither words nor a mark.
            aria-label={hasText ? undefined : title}
            disabled={disabled}
            {...restProps}
        >
            {hasText && icon && <span className={clsx("bx", icon)} aria-hidden="true" />}
            {text}
        </button>
    );
}

interface OverlayFullscreenButtonProps {
    /** Whether what the button stands over has the screen to itself. */
    isFullscreen: boolean;
    /** Gives it the screen, or takes it back. */
    onToggle: () => void;
}

/**
 * The button that gives what the group stands over the whole screen, and takes it back again — its
 * mark and what it is called both naming the way out once it is in. Every such button in the app says
 * the same two things, so it says them here rather than once per map.
 *
 * The state is handed to it rather than read: {@link useFullscreen} is what follows the browser, and
 * a caller may have to wrap it — the mind map takes the middle of its view before the change so as to
 * put it back after (see `useMapFullscreen`), which no button could do on its behalf.
 */
export function OverlayFullscreenButton({ isFullscreen, onToggle }: OverlayFullscreenButtonProps) {
    return (
        <OverlayControlButton
            title={isFullscreen ? t("common.exit_fullscreen") : t("common.fullscreen")}
            icon={isFullscreen ? "bx-exit-fullscreen" : "bx-fullscreen"}
            onClick={() => onToggle()}
        />
    );
}

/** Which way the tooltips on a group open, handed down by the group rather than repeated on each button. */
const TooltipDirection = createContext<ActionButtonProps["titlePosition"]>("top");
