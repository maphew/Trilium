import type { Placement } from "@floating-ui/dom";
import type { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import clsx from "clsx";
import { ComponentChildren, HTMLAttributes } from "preact";
import { CSSProperties, HTMLProps } from "preact/compat";
import { MutableRef, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";

import { useTooltip, useUniqueName } from "./hooks";
import { suspendModalFocusTraps } from "./modal_focustrap";
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

export default function Dropdown({ id, className, buttonClassName, isStatic, children, title, text, dropdownContainerStyle, dropdownContainerClassName, dropdownContainerRef: externalContainerRef, hideToggleArrow, iconAction, disabled, noSelectButtonStyle, noDropdownListStyle, forceShown, onShown, onHidden, dropdownOptions, buttonProps, dropdownRef, titlePosition, titleOptions }: DropdownProps) {
    const containerRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    const popupRef = useRef<HTMLDivElement | null>(null);
    const [ shown, setShown ] = useState(!!forceShown && !disabled);
    /** The item to focus once the popup shows, for a popup a key on the toggle opened. */
    const pendingFocus = useRef<"first" | "last">();
    // As Bootstrap's `autoClose`: `true` closes on a click inside and a press outside, "inside" and
    // "outside" on that one alone, `false` on neither. Escape closes it whatever this says.
    const autoClose = dropdownOptions?.autoClose ?? true;
    const popperConfig = dropdownOptions?.popperConfig;
    const placement = toFloatingPlacement(popperConfig && typeof popperConfig === "object" ? popperConfig.placement : undefined);

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

    // Every open and close goes through here, which says so at once, as Bootstrap's events did
    // within the press: a caller holding something open for the menu's sake, such as the board's
    // card editor, must know before the focus the press moves reaches it.
    const shownRef = useRef(shown);
    const callbacks = useRef({ onShown, onHidden, hideTooltip });
    callbacks.current = { onShown, onHidden, hideTooltip };
    const setOpen = useCallback((open: boolean) => {
        if (shownRef.current === open) return;
        shownRef.current = open;
        setShown(open);
        if (open) {
            callbacks.current.hideTooltip();
            callbacks.current.onShown?.();
        } else {
            callbacks.current.onHidden?.();
        }
    }, []);

    useLayoutEffect(() => {
        if (externalContainerRef) externalContainerRef.current = containerRef.current;
    }, [ externalContainerRef ]);

    useLayoutEffect(() => {
        if (!dropdownRef) return;
        dropdownRef.current = {
            show: () => setOpen(true),
            hide: () => setOpen(false),
            toggle: () => setOpen(!shownRef.current)
        };
    }, [ dropdownRef ]);

    // A disabled toggle cannot be pressed to close its popup, so disabling it closes the popup.
    useLayoutEffect(() => {
        if (disabled) setOpen(false);
    }, [ disabled ]);

    // One shown from the start says so once it is mounted. `shown` is the first render's here.
    useEffect(() => {
        if (shown) callbacks.current.onShown?.();
    }, []);

    // A dialog's focus trap would pull focus out of a popup that stands outside the dialog.
    useEffect(() => {
        if (!shown) return;
        return suspendModalFocusTraps();
    }, [ shown ]);

    // Up and Down move between the items, as Bootstrap's did. Captured at the window, so its
    // handler for keys in a `.dropdown-menu`, which finds no toggle beside a popup, never sees them.
    useEffect(() => {
        if (!shown) return;
        const onKeyDown = (e: KeyboardEvent) => {
            const popup = popupRef.current;
            const target = e.target as Element;
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            if (!popup?.contains(target) || /input|textarea/i.test(target.tagName)) return;
            e.preventDefault();
            e.stopPropagation();
            focusItem(popup, e.key === "ArrowDown" ? "next" : "previous", target);
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [ shown ]);

    const ariaId = useUniqueName("button");
    const toggleId = id ?? ariaId;

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
                id={toggleId}
                disabled={disabled}
                onClick={(e) => {
                    buttonProps?.onClick?.(e);
                    setOpen(!shownRef.current);
                }}
                // Up or Down on the toggle opens the popup at its first or last item.
                onKeyDown={(e) => {
                    buttonProps?.onKeyDown?.(e);
                    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
                    e.preventDefault();
                    const edge = e.key === "ArrowDown" ? "first" : "last";
                    if (shown && popupRef.current) {
                        focusItem(popupRef.current, edge);
                    } else {
                        pendingFocus.current = edge;
                        setOpen(true);
                    }
                }}
            >
                {text}
                <span className="caret" />
            </button>

            {shown && triggerRef.current && (
                <Popup
                    anchor={triggerRef.current}
                    placement={placement}
                    offset={TOGGLE_GAP}
                    // Bootstrap's dropdowns grew past the viewport, and a `FormDropdownSubmenu`
                    // nested in the menu would be clipped by a menu that scrolls.
                    capHeight={false}
                    // In a wrapper with the dropdown's classes, so CSS scoped under them still
                    // applies to the menu in the page's body. style.css stacks a portaled menu by
                    // `tn-dropdown-portal`.
                    portalClassName={clsx("tn-dropdown-portal", className)}
                    elementRef={popupRef}
                    className={clsx("dropdown-menu show tn-dropdown-menu", isStatic && "static", dropdownContainerClassName,
                        !noDropdownListStyle && "tn-dropdown-list")}
                    style={dropdownContainerStyle}
                    aria-labelledby={toggleId}
                    onPlaced={() => {
                        const edge = pendingFocus.current;
                        pendingFocus.current = undefined;
                        if (edge && popupRef.current) focusItem(popupRef.current, edge);
                    }}
                    onClick={(e) => {
                        if (autoClose === "outside" || autoClose === false) return;
                        const target = e.target as Element;
                        // Neither the menu's own padding nor a field in it closes it, as in Bootstrap's.
                        if (target === e.currentTarget || /input|select|option|textarea|form/i.test(target.tagName)) return;
                        setOpen(false);
                    }}
                    onDismiss={(reason) => {
                        if (reason === "outside" && (autoClose === "inside" || autoClose === false)) return;
                        setOpen(false);
                        if (reason === "escape") triggerRef.current?.focus();
                    }}
                >
                    {children}
                </Popup>
            )}
        </div>
    );
}

/**
 * Focuses an enabled item of `popup`'s own, not one in a submenu nested in it: the first or the
 * last, or the one after or before `from`, going round at either end, as Bootstrap's did.
 */
function focusItem(popup: HTMLElement, where: "first" | "last" | "next" | "previous", from?: Element) {
    const items = [ ...popup.querySelectorAll<HTMLElement>(".dropdown-item:not(.disabled):not(:disabled)") ]
        .filter((item) => item.parentElement?.closest(".dropdown-menu") === popup);
    if (!items.length) return;

    const current = from?.closest<HTMLElement>(".dropdown-item");
    const index = current ? items.indexOf(current) : -1;
    let target: HTMLElement | undefined;
    if (where === "first" || (where === "next" && index < 0)) target = items[0];
    else if (where === "last" || (where === "previous" && index < 0)) target = items.at(-1);
    else target = items[(index + (where === "next" ? 1 : -1) + items.length) % items.length];
    target?.focus();
}

/** A placement as Popper names it, as Floating UI does; Popper's `auto` ones fall back to the default. */
function toFloatingPlacement(placement: string | undefined): Placement | undefined {
    return placement && !placement.startsWith("auto") ? placement as Placement : undefined;
}
