// Reference copy of `MenuCommand`, the row `Menu` drew before its data adapter switched to
// `FormListItem` and `FormDropdownSubmenu`. Nothing imports it. Delete a piece once those rows
// cover it, and the file once they reach parity.

import { autoUpdate } from "@floating-ui/dom";
import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useId, useLayoutEffect, useRef } from "preact/hooks";

import type { MenuCommandItem } from "../../menus/context_menu";
import { getActionSync } from "../../services/keyboard_actions";
import { handleRightToLeftPlacement, isMobile } from "../../services/utils";
import { placeMenu } from "./Menu";
import { MenuLevelContext, type OpenSubmenu, useMenu } from "./menu_context";
import { joinElements } from "./react_utils";
import { renderShortcutKbds } from "./shortcut_kbd";

export interface MenuCommandProps extends Pick<MenuCommandItem<unknown>, "title" | "uiIcon" | "iconColorClass" | "checked"
        | "enabled" | "shortcut" | "keyboardShortcut" | "badges" | "trailingIcon" | "className" | "columns"> {
    /** Called when the row is pressed with the primary button, or run from the keyboard. */
    onSelect?(e: MouseEvent | KeyboardEvent): void;
    /** Whether running the row closes the menu. A row does, and one that opens a submenu does not. */
    closeOnSelect?: boolean;
    /** The rows of the submenu this row opens. */
    children?: ComponentChildren;
}

/**
 * A row that runs a command, or with children, opens them as its submenu. As with
 * {@link MenuCommandItem}, a row given `uiIcon` or `checked`, even as nothing, keeps a slot for
 * the icon, and one given `checked` can be checked.
 */
export function MenuCommand(props: MenuCommandProps) {
    const { title, enabled, badges, trailingIcon, className, columns, onSelect, closeOnSelect, children } = props;
    const menu = useMenu();
    const level = useContext(MenuLevelContext);
    const id = useId();
    const disabled = enabled === false;
    const hasSubmenu = children !== undefined && children !== null && children !== false;
    const openSubmenu = menu.open[level];
    const open = openSubmenu?.id === id;
    const active = menu.active?.id === id;
    const checkable = "checked" in props;

    function select(e: MouseEvent | KeyboardEvent) {
        if (closeOnSelect ?? !hasSubmenu) menu.close();
        onSelect?.(e);
    }

    function onPointed(e: { currentTarget: HTMLLIElement }) {
        if (isMobile()) return;
        // The keyboard goes on from the row the pointer last pointed at.
        if (!disabled) menu.setActive(level, id);
        menu.openSubmenu(level, hasSubmenu && !disabled ? id : undefined, e.currentTarget);
    }

    return (
        <li
            id={id}
            ref={(element) => {
                menu.registerRow(id, element ? { level, element, custom: false, disabled, hasSubmenu, select } : undefined);
            }}
            className={clsx("dropdown-item", hasSubmenu && "dropdown-submenu", open && "submenu-open",
                active && "tn-menu-active", disabled && "disabled", className)}
            role={checkable ? "menuitemcheckbox" : "menuitem"}
            aria-checked={checkable ? !!props.checked : undefined}
            aria-disabled={disabled || undefined}
            aria-haspopup={hasSubmenu ? "menu" : undefined}
            aria-expanded={hasSubmenu ? open : undefined}
            // While the keys drive the menu, a row entered by a pointer at rest, as when the menu
            // appears under it, keeps the keys' row. See `pointerMoved`.
            onPointerEnter={(e) => {
                if (!menu.keyboardDriven) onPointed(e);
            }}
            // The keys can move the active row from under a pointer at rest, whose `:hover` would
            // then mark a second row. The next move of the pointer makes its row the active one.
            onPointerMove={(e) => {
                if (!active && pointerMoved(e)) onPointed(e);
            }}
            // `mousedown` rather than `click`, and its default prevented, so the press does not move
            // focus out of the menu: `contextMenu` hands it back to a text editor before the command
            // runs, with the selection that commands such as a spelling fix act on.
            onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                // An unfolded row holds its submenu's rows, whose presses would reach it too.
                e.stopPropagation();
                if (disabled) return;

                // Pressed again, an unfolded row folds its submenu back.
                if (hasSubmenu && isMobile()) {
                    menu.openSubmenu(level, open ? undefined : id, e.currentTarget, true);
                    return;
                }
                if (hasSubmenu) menu.openSubmenu(level, id, e.currentTarget, true);
                select(e);
            }}
        >
            <span className={hasSubmenu ? "dropdown-toggle" : undefined}>
                <MenuIconSlot {...props} />
                <span className="tn-menu-gap" />
                {/* Callers pass HTML: titles escaped with `escapeHtml()` or boxed by `menuName()`. */}
                <span id={titleId(id)} dangerouslySetInnerHTML={{ __html: title }} />
                {badges?.map((badge, index) => (
                    <span key={index} className={clsx("badge", badge.className)}>{badge.title}</span>
                ))}
                <MenuShortcut {...props} />
                {trailingIcon && <span className={clsx(trailingIcon, "tn-icon", "menu-trailing-icon")} />}
            </span>
            {hasSubmenu && (isMobile()
                // A phone has no room beside the menu, so an open submenu unfolds under its row.
                ? (
                    <ul className={clsx("dropdown-menu", open && "show")} role="menu" aria-labelledby={titleId(id)}>
                        <MenuLevelContext.Provider value={level + 1}>{open && children}</MenuLevelContext.Provider>
                    </ul>
                )
                : open && openSubmenu && menu.layerHost && createPortal((
                    <SubmenuLayer level={level + 1} submenu={openSubmenu} columns={columns}>{children}</SubmenuLayer>
                ), menu.layerHost))}
        </li>
    );
}

/**
 * A submenu opened on the desktop, placed beside the row it opened from rather than nested in it,
 * so a scrolling menu neither clips it nor scrolls it away.
 */
function SubmenuLayer({ level, submenu, columns, children }: {
    level: number,
    submenu: OpenSubmenu,
    columns?: number,
    children: ComponentChildren
}) {
    const layerRef = useRef<HTMLDivElement>(null);
    const columnCount = (columns ?? 1) > 1 ? columns : undefined;

    useLayoutEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;

        const placement = handleRightToLeftPlacement("right") === "right" ? "right-start" : "left-start";
        return autoUpdate(submenu.anchor, layer, () => void placeMenu(layer, submenu.anchor, placement, true));
    }, [ submenu.anchor ]);

    // In a `.dropdown-submenu`, so the theme's submenu rules apply.
    return (
        <MenuLevelContext.Provider value={level}>
            <div className="dropdown-submenu">
                <div
                    ref={layerRef} role="menu" aria-labelledby={titleId(submenu.anchor.id)}
                    className={clsx("dropdown-menu show tn-menu", submenu.immediate && "tn-menu-immediate")}
                >
                    {/* Like the top level, so the blur on the layer's `::before` stays behind its rows. */}
                    {columnCount
                        // The columns go on an inner list of their full height, so a capped menu
                        // scrolls them rather than growing more columns to the side.
                        ? (
                            <div className="tn-menu-scroll">
                                <menu className="tn-menu-columns" role="none" style={{ columnCount }}>
                                    {children}
                                </menu>
                            </div>
                        )
                        : <menu className="tn-menu-scroll" role="none">{children}</menu>}
                </div>
            </div>
        </MenuLevelContext.Provider>
    );
}

/** The id of a row's title, which names the submenu it opens. */
function titleId(rowId: string) {
    return `${rowId}-title`;
}

/**
 * The shortcuts of the row's `keyboardShortcut` action as the user configured them, or else its
 * literal `shortcut`. Read synchronously, so the menu is placed at its final width.
 */
function MenuShortcut({ keyboardShortcut, shortcut }: Pick<MenuCommandProps, "keyboardShortcut" | "shortcut">) {
    if (keyboardShortcut) {
        const shortcuts = getActionSync(keyboardShortcut)?.effectiveShortcuts;
        if (!shortcuts?.length) return null;
        return (
            <span className="keyboard-shortcut">
                {joinElements(shortcuts.map(shortcut => renderShortcutKbds(shortcut)), ",")}
            </span>
        );
    }

    return shortcut ? <kbd>{shortcut}</kbd> : null;
}

/**
 * The icon, or a check mark in its place. A row that sets `uiIcon` to nothing gets a blank slot,
 * and one without `uiIcon` or `checked` an empty one.
 */
function MenuIconSlot(props: Pick<MenuCommandProps, "uiIcon" | "checked" | "iconColorClass">) {
    if (!("uiIcon" in props || "checked" in props)) return <span />;

    const icon = props.checked ? "bx bx-check" : props.uiIcon;
    return icon
        ? <span className={clsx(icon, "tn-icon", props.iconColorClass)} />
        : <span>{" "}</span>;
}

/**
 * Whether the pointer really moved. A menu appearing under a pointer at rest has the browser enter
 * the row there, and Chromium follow with a `pointermove` that goes nowhere; neither is the user
 * turning to the pointer.
 */
function pointerMoved(e: PointerEvent) {
    return e.movementX !== 0 || e.movementY !== 0;
}
