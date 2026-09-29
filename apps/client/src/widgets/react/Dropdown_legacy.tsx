// Reference copy of the Bootstrap-driven Dropdown from before the `Popup` rewrite. Nothing imports it.
// Delete a piece once `Dropdown` covers it, and the file once the two reach parity.

import type { Dropdown as BootstrapDropdown, Tooltip } from "bootstrap";
import { ComponentChildren, HTMLAttributes } from "preact";
import { createPortal, CSSProperties, HTMLProps } from "preact/compat";
import { MutableRef, useCallback, useEffect, useState } from "preact/hooks";

import { isMobile } from "../../services/utils";

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
    dropdownRef?: MutableRef<BootstrapDropdown | null>;
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

export default function Dropdown({ className, children, onShown: externalOnShown, onHidden: externalOnHidden, mobileBackdrop: mobileBackdropProp, portalToBody: portalToBodyProp, mobileBottomSheet, backdrop }: DropdownProps) {
    // Not yet in `Dropdown`: `dropdownOptions.display: "static"` (1 caller).

    // The sheet is three things at once — placed by the app's own rule, dimming what is behind it,
    // and lifted out of whatever opened it — so it is asked for as one thing and unpacked here.
    const bottomSheet = !!mobileBottomSheet && isMobile();
    const mobileBackdrop = mobileBackdropProp || bottomSheet;
    const portalToBody = portalToBodyProp || bottomSheet;

    const [ shown ] = useState(false);

    const onShown = useCallback(() => {
        externalOnShown?.();
        if (mobileBackdrop && isMobile()) {
            document.getElementById("context-menu-cover")?.classList.add("show", "global-menu-cover");
        }
    }, [ mobileBackdrop ]);

    const onHidden = useCallback(() => {
        externalOnHidden?.();
        if (mobileBackdrop && isMobile()) {
            document.getElementById("context-menu-cover")?.classList.remove("show", "global-menu-cover");
        }
    }, [ mobileBackdrop ]);

    useEffect(() => {
        if (shown) onShown();
        else onHidden();
    }, [ shown ]);

    const menu = (
        <ul class={`dropdown-menu ${bottomSheet ? "mobile-bottom-menu" : ""}`}>
            {shown && children}
        </ul>
    );

    return portalToBody
        ? createPortal((
            <div class={`tn-dropdown-portal ${className ?? ""}`}>
                {backdrop && shown && <div class="tn-dropdown-backdrop" />}
                {menu}
            </div>
        ), document.body)
        : menu;
}
