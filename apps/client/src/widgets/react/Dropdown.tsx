import type { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import clsx from "clsx";
import { ComponentChildren, HTMLAttributes } from "preact";
import { CSSProperties, HTMLProps } from "preact/compat";
import { MutableRef, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { useTooltip, useUniqueName } from "./hooks";
import Popup from "./Popup";

type DataAttributes = {
    [key: `data-${string}`]: string | number | boolean | undefined;
};

export interface DropdownProps extends Pick<HTMLProps<HTMLDivElement>, "id" | "className"> {
    buttonClassName?: string;
    buttonProps?: Partial<HTMLAttributes<HTMLButtonElement> & DataAttributes>;
    isStatic?: boolean;
    children: ComponentChildren;
    title?: string;
    dropdownContainerStyle?: CSSProperties;
    dropdownContainerClassName?: string;
    dropdownContainerRef?: MutableRef<HTMLDivElement | null>;
    hideToggleArrow?: boolean;
    /** If set to true, then the dropdown button will be considered an icon action (without normal border and sized for icons only). */
    iconAction?: boolean;
    noSelectButtonStyle?: boolean;
    /**
     * Drop the `tn-dropdown-list` class the menu otherwise carries by default.
     *
     * That class exists for **scrollable** menus: it moves the theme's backdrop blur off the menu's
     * `::before` layer — which a scrollable menu would scroll away with its content — and onto the
     * menu element itself. The element-level filter is the fragile one, though: opened over note
     * content it blurs nothing at all, leaving the menu merely translucent and reading as
     * see-through over anything dark.
     *
     * So set this on any menu that doesn't scroll (i.e. nearly every action menu) to keep it on the
     * working pseudo-element layer.
     */
    noDropdownListStyle?: boolean;
    /**
     * The only supported way to disable the toggle. Bootstrap cannot close a menu whose toggle is
     * disabled through `buttonProps` or a `disabled` class.
     */
    disabled?: boolean;
    text?: ComponentChildren;
    forceShown?: boolean;
    onShown?: () => void;
    onHidden?: () => void;
    dropdownOptions?: Partial<BootstrapDropdown.Options>;
    dropdownRef?: MutableRef<DropdownHandle | null>;
    titlePosition?: "top" | "right" | "bottom" | "left";
    titleOptions?: Partial<Tooltip.Options>;
    mobileBackdrop?: boolean;
    /**
     * Render the dropdown menu into `document.body` instead of nesting it next to the toggle.
     *
     * Use this when an ancestor establishes a containment/backdrop root (e.g. `container-type`,
     * `transform`, `filter`) which would otherwise flatten the menu's `backdrop-filter` blur into a
     * flat tint. The menu is wrapped in a `<div class="tn-dropdown-portal {className}">` so any CSS
     * scoped under that class keeps applying even though the menu no longer lives inside the
     * toggle's wrapper, and so the menu outranks whatever stacking context it was lifted out of.
     */
    portalToBody?: boolean;
    /**
     * On a phone, show the menu as a sheet rising from the bottom of the screen over a dimmed page,
     * the way the app's other mobile menus appear. No effect on a desktop layout.
     *
     * Prefer this to setting the pieces by hand. A menu left to place itself on mobile lands as a
     * narrow box adrift in the middle of the page — Popper computes an offset that the app's own
     * `body.mobile .dropdown-menu { position: fixed }` then measures from somewhere else — and one
     * opened inside a dialog needs {@link portalToBody} besides, since a transformed `.modal-dialog`
     * is both the box a fixed menu is placed against and a stacking context the backdrop, painting
     * above the whole modal, would otherwise dim the menu through.
     */
    mobileBottomSheet?: boolean;
    /**
     * Dim the page behind the menu on any screen, for a menu that is a task of its own rather than
     * a list of actions: the icon picker, which holds a search field and a grid of a thousand
     * icons.
     *
     * Drawn inside the same portal as the menu, immediately before it, so what covers what is a
     * matter of document order and one z-index rather than of two scales meeting. Needs
     * {@link portalToBody} for that, and does nothing without it.
     */
    backdrop?: boolean;
}

/** Opens and closes a dropdown from outside it, for a caller that decides when. */
export interface DropdownHandle {
    show(): void;
    hide(): void;
    toggle(): void;
}

/** The gap, in pixels, between the toggle and its popup, as Bootstrap's dropdowns kept. */
const TOGGLE_GAP = 2;

export default function Dropdown({ id, className, buttonClassName, title, text, dropdownContainerStyle, dropdownContainerClassName, dropdownContainerRef: externalContainerRef, hideToggleArrow, iconAction, disabled, noSelectButtonStyle, forceShown, onShown, onHidden, buttonProps, dropdownRef, titlePosition, titleOptions }: DropdownProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const [ shown, setShown ] = useState(!!forceShown && !disabled);

    // Memoized so useTooltip's effect (keyed on config identity) doesn't dispose and recreate the
    // Bootstrap tooltip on every re-render — only when the title (or positioning) actually changes.
    const tooltipConfig = useMemo<Partial<Tooltip.Options>>(() => ({
        ...titleOptions,
        // Bootstrap reads the `title` attribute once, so a dynamic title is driven from config.
        // Bootstrap rejects `undefined`; "" shows no tooltip.
        title: title ?? titleOptions?.title ?? "",
        placement: titlePosition ?? "bottom",
        fallbackPlacements: [ titlePosition ?? "bottom" ]
    }), [ title, titleOptions, titlePosition ]);
    // On the wrapper, and silenced while the popup is up, so the title does not hang over it.
    const { hideTooltip } = useTooltip(containerRef, tooltipConfig, !shown);

    useLayoutEffect(() => {
        if (externalContainerRef) externalContainerRef.current = containerRef.current;
    }, [ externalContainerRef ]);

    useLayoutEffect(() => {
        if (!dropdownRef) return;
        dropdownRef.current = {
            show: () => setShown(true),
            hide: () => setShown(false),
            toggle: () => setShown((current) => !current)
        };
    }, [ dropdownRef ]);

    // A disabled toggle cannot be pressed to close its popup, so disabling it closes the popup.
    useLayoutEffect(() => {
        if (disabled) setShown(false);
    }, [ disabled ]);

    const everShown = useRef(false);
    useEffect(() => {
        if (shown) {
            everShown.current = true;
            hideTooltip();
            onShown?.();
        } else if (everShown.current) {
            onHidden?.();
        }
    }, [ shown ]);

    const ariaId = useUniqueName("button");

    return (
        // `title` stands in only for the moment before the tooltip is wired: Bootstrap moves the
        // attribute into the tooltip and drops it, so the browser's own doesn't double up with ours.
        <div ref={containerRef} class={`dropdown ${className ?? ""}`} style={{ display: "flex" }} title={title}>
            <button
                {...buttonProps}
                className={clsx(
                    iconAction ? "icon-action" : "btn",
                    !noSelectButtonStyle && "select-button",
                    buttonClassName,
                    !hideToggleArrow && "dropdown-toggle",
                    shown && "show"
                )}
                ref={triggerRef}
                type="button"
                aria-haspopup="true"
                aria-expanded={shown}
                id={id ?? ariaId}
                disabled={disabled}
                onClick={(e) => {
                    buttonProps?.onClick?.(e);
                    setShown((current) => !current);
                }}
            >
                {text}
                <span className="caret" />
            </button>

            {shown && triggerRef.current && (
                <Popup
                    anchor={triggerRef.current}
                    offset={TOGGLE_GAP}
                    className={clsx("dropdown-menu show tn-dropdown-menu", dropdownContainerClassName)}
                    onDismiss={(reason) => {
                        setShown(false);
                        if (reason === "escape") triggerRef.current?.focus();
                    }}
                >
                    {/* The popup holds nothing yet; the menu comes next. */}
                    <div aria-labelledby={ariaId} style={dropdownContainerStyle} />
                </Popup>
            )}
        </div>
    );
}
