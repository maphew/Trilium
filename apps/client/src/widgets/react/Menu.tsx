import "./Menu.css";

import { autoUpdate, computePosition, flip, hide, offset, type Placement, type ReferenceElement, shift, size, type VirtualElement } from "@floating-ui/dom";
import clsx from "clsx";
import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import { getActionSync } from "../../services/keyboard_actions";
import { handleRightToLeftPlacement, isMobile } from "../../services/utils";
import { joinElements } from "./react_utils";
import { renderShortcutKbds } from "./shortcut_kbd";

/**
 * A menu of commands, drawn with the markup Bootstrap's dropdowns use (`.dropdown-menu`,
 * `.dropdown-item`, `.dropdown-divider`), so the stylesheets and themes that style those style
 * this too. Only the placement is its own.
 */
export interface MenuProps<T> {
    id?: string;
    className?: string;
    /** Where the menu opens, in viewport coordinates. */
    x: number;
    y: number;
    /** Opens the menu towards the left of {@link x} instead of towards the right. */
    orientation?: "left";
    /**
     * Shows the menu as a sheet along the bottom of a phone's screen instead of at {@link x} and
     * {@link y}. The `.mobile-bottom-menu` rules place and cap it.
     */
    bottomSheet?: boolean;
    items: MenuItem<T>[];
    /** Called when an item is pressed with the primary button. */
    onSelect(item: MenuCommandItem<T>, e: MouseEvent): void;
    /** Called on a click inside a custom item, which closes the menu like a pressed item does. */
    onClose(): void;
}

/** How many pixels the menu keeps from the edges of the viewport. */
const VIEWPORT_PADDING = 5;

/** A submenu standing open, and the row it opened from. */
interface OpenSubmenu<T> {
    item: MenuCommandItem<T>;
    anchor: HTMLElement;
    /** Remounts the layer when another submenu replaces it at the same level. */
    key: number;
}

/** What every level of the menu shares. */
interface MenuState<T> {
    onSelect: MenuProps<T>["onSelect"];
    onClose: MenuProps<T>["onClose"];
    /**
     * Opens `item`'s submenu at `level`, closing whatever stood open at that level and deeper, or
     * without an item only closes them.
     */
    openSubmenu(level: number, item?: MenuCommandItem<T>, anchor?: HTMLElement): void;
    /** The item whose submenu stands open at each level. */
    openItems: MenuCommandItem<T>[];
}

export default function Menu<T>({ id, className, x, y, orientation, bottomSheet, items, onSelect, onClose }: MenuProps<T>) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [ submenus, setSubmenus ] = useState<OpenSubmenu<T>[]>([]);
    const nextKey = useRef(0);

    const openSubmenu = useCallback((level: number, item?: MenuCommandItem<T>, anchor?: HTMLElement) => {
        setSubmenus((open) => {
            if (item ? open[level]?.item === item : open.length <= level) return open;
            const kept = open.slice(0, level);
            return item && anchor ? [ ...kept, { item, anchor, key: nextKey.current++ } ] : kept;
        });
    }, []);
    const state: MenuState<T> = { onSelect, onClose, openSubmenu, openItems: submenus.map((submenu) => submenu.item) };

    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;
        if (bottomSheet) {
            // An inline `max-height` would override the sheet's own, which is not `!important`.
            menu.style.visibility = "visible";
            return;
        }

        const anchor = pointAt(x, y);
        const placement = orientation === "left" ? "left-start" : "right-start";
        // Places the menu now, and again whenever the viewport or the menu itself changes size.
        return autoUpdate(anchor, menu, () => void placeMenu(menu, anchor, placement));
    }, [ x, y, orientation, bottomSheet ]);

    return (
        <div
            ref={menuRef} id={id} role="menu"
            className={clsx("dropdown-menu show tn-menu", bottomSheet && "mobile-bottom-menu", className)}
            // Neither the browser's menu nor another of the app's opens over this one. Every level
            // is inside this element, so one handler covers them all.
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
        >
            <MenuList level={0} items={items} state={state} />
            {/* Inside the menu, so the rules scoped to it apply, but none inside another: a fixed
                layer escapes a scrolling menu only while no ancestor carries a filter. */}
            {submenus.map((submenu, index) => (
                <SubmenuLayer key={submenu.key} level={index + 1} submenu={submenu} state={state} />
            ))}
        </div>
    );
}

/**
 * A submenu opened on the desktop, placed beside the row it opened from rather than nested in it,
 * so a scrolling menu neither clips it nor scrolls it away.
 */
function SubmenuLayer<T>({ level, submenu, state }: { level: number, submenu: OpenSubmenu<T>, state: MenuState<T> }) {
    const layerRef = useRef<HTMLUListElement>(null);
    const columns = (submenu.item.columns ?? 1) > 1 ? submenu.item.columns : undefined;
    const items = submenu.item.items ?? [];

    useLayoutEffect(() => {
        const layer = layerRef.current;
        if (!layer) return;

        const placement = handleRightToLeftPlacement("right") === "right" ? "right-start" : "left-start";
        return autoUpdate(submenu.anchor, layer, () => void placeMenu(layer, submenu.anchor, placement, true));
    }, [ submenu.anchor ]);

    // In a `.dropdown-submenu`, so the theme's submenu rules apply.
    return (
        <div className="dropdown-submenu">
            <ul ref={layerRef} className="dropdown-menu show tn-menu" role="menu">
                {columns
                    // The columns go on an inner element of their full height, so a capped menu
                    // scrolls them rather than growing more columns to the side.
                    ? (
                        <div className="tn-menu-columns" style={{ columnCount: columns }}>
                            <MenuList level={level} items={items} state={state} columns />
                        </div>
                    )
                    : <MenuList level={level} items={items} state={state} />}
            </ul>
        </div>
    );
}

function MenuList<T>({ level, items, state, columns }: {
    level: number,
    items: MenuItem<T>[],
    state: MenuState<T>,
    /** Wraps the rows a column must not break between in `.dropdown-no-break`. */
    columns?: boolean
}) {
    const rows = menuRows(items);
    if (!columns) return <>{rows.map((row, index) => <MenuListRow key={index} level={level} row={row} state={state} />)}</>;

    return <>
        {unbreakableGroups(rows).map((group, groupIndex) => (group.length > 1
            ? (
                <div key={groupIndex} className="dropdown-no-break">
                    {group.map((row, index) => <MenuListRow key={index} level={level} row={row} state={state} />)}
                </div>
            )
            : <MenuListRow key={groupIndex} level={level} row={group[0]} state={state} />
        ))}
    </>;
}

function MenuListRow<T>({ level, row, state }: { level: number, row: MenuItem<T>, state: MenuState<T> }) {
    if (!("kind" in row)) return <MenuRow level={level} item={row} state={state} />;
    if (row.kind === "separator") return <div className="dropdown-divider" role="separator" />;
    if (row.kind === "header") return <h6 className="dropdown-header">{row.title}</h6>;
    return (
        <li className="dropdown-custom-item" onClick={state.onClose}>
            <row.componentFn />
        </li>
    );
}

function MenuRow<T>({ level, item, state }: { level: number, item: MenuCommandItem<T>, state: MenuState<T> }) {
    const disabled = item.enabled === false;
    const hasSubmenu = !!item.items;
    // A phone has no room beside the menu, so a submenu unfolds under its row instead.
    const [ unfolded, setUnfolded ] = useState(false);
    const open = isMobile() ? unfolded : state.openItems[level] === item;

    return (
        <li
            className={clsx("dropdown-item", hasSubmenu && "dropdown-submenu", open && "submenu-open",
                disabled && "disabled", item.className)}
            role="menuitem"
            aria-disabled={disabled || undefined}
            aria-haspopup={hasSubmenu ? "menu" : undefined}
            aria-expanded={hasSubmenu ? open : undefined}
            onPointerEnter={(e) => {
                if (isMobile()) return;
                state.openSubmenu(level, hasSubmenu && !disabled ? item : undefined, e.currentTarget);
            }}
            // `mousedown` rather than `click`, and its default prevented, so the press does not move
            // focus: a text editor keeps the selection that commands such as a spelling fix act on.
            onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                // An unfolded row holds its submenu's rows, whose presses would reach it too.
                e.stopPropagation();
                if (disabled) return;

                if (hasSubmenu && isMobile()) {
                    setUnfolded(!unfolded);
                    return;
                }
                if (hasSubmenu) state.openSubmenu(level, item, e.currentTarget);
                state.onSelect(item, e);
            }}
        >
            <span className={hasSubmenu ? "dropdown-toggle" : undefined}>
                <MenuIconSlot item={item} />
                <span className="tn-menu-gap" />
                {/* Callers pass HTML: titles escaped with `escapeHtml()` or boxed by `menuName()`. */}
                <span dangerouslySetInnerHTML={{ __html: item.title }} />
                {item.badges?.map((badge, index) => (
                    <span key={index} className={clsx("badge", badge.className)}>{badge.title}</span>
                ))}
                <MenuShortcut item={item} />
                {item.trailingIcon && <span className={clsx(item.trailingIcon, "tn-icon", "menu-trailing-icon")} />}
            </span>
            {hasSubmenu && isMobile() && (
                <ul className={clsx("dropdown-menu", unfolded && "show")} role="menu">
                    {unfolded && <MenuList level={level + 1} items={item.items ?? []} state={state} />}
                </ul>
            )}
        </li>
    );
}

/**
 * The shortcuts of the item's `keyboardShortcut` action as the user configured them, or else its
 * literal `shortcut`. Read synchronously, so the menu is placed at its final width.
 */
function MenuShortcut<T>({ item }: { item: MenuCommandItem<T> }) {
    if (item.keyboardShortcut) {
        const shortcuts = getActionSync(item.keyboardShortcut)?.effectiveShortcuts;
        if (!shortcuts?.length) return null;
        return (
            <span className="keyboard-shortcut">
                {joinElements(shortcuts.map(shortcut => renderShortcutKbds(shortcut)), ",")}
            </span>
        );
    }

    return item.shortcut ? <kbd>{item.shortcut}</kbd> : null;
}

/**
 * The icon, or a check mark in its place. An item that sets `uiIcon` to nothing gets a blank slot,
 * and one without `uiIcon` or `checked` an empty one.
 */
function MenuIconSlot<T>({ item }: { item: MenuCommandItem<T> }) {
    if (!("uiIcon" in item || "checked" in item)) return <span />;

    const icon = item.checked ? "bx bx-check" : item.uiIcon;
    return icon
        ? <span className={clsx(icon, "tn-icon", item.iconColorClass)} />
        : <span>{"\u00a0"}</span>;
}

/** The items with a run of separators reduced to one. */
function menuRows<T>(items: MenuItem<T>[]) {
    const rows: MenuItem<T>[] = [];
    for (const item of items) {
        const previous = rows.at(-1);
        if (isSeparator(item) && previous && isSeparator(previous)) continue;
        rows.push(item);
    }
    return rows;
}

/**
 * The rows split where a column can break: a row stays with the one before it when that one is a
 * header or a separator, or when it is a separator itself. Firefox ignores `break-before` and
 * `break-after: avoid` in columns, so a group is kept whole with `break-inside: avoid` instead.
 */
function unbreakableGroups<T>(rows: MenuItem<T>[]) {
    const groups: MenuItem<T>[][] = [];
    for (const [ index, row ] of rows.entries()) {
        const previous = rows[index - 1];
        const lastGroup = groups.at(-1);
        if (previous && lastGroup && (isHeader(previous) || isSeparator(previous) || isSeparator(row))) {
            lastGroup.push(row);
        } else {
            groups.push([ row ]);
        }
    }
    return groups;
}

function isSeparator<T>(item: MenuItem<T>) {
    return "kind" in item && item.kind === "separator";
}

function isHeader<T>(item: MenuItem<T>) {
    return "kind" in item && item.kind === "header";
}

/**
 * Positions `menu` beside `anchor`, preferring `placement` and then the placements that mirror it,
 * the way a native menu opens above or to the left of a pointer that is near the viewport's edge.
 * The menu stays hidden until it is placed, so it never paints at a stale position.
 *
 * A submenu overlaps its row by 2px, so the pointer crosses no gap on its way over, and lines its
 * first row up with that row. It is hidden while its row is scrolled out of its menu's view.
 */
async function placeMenu(menu: HTMLElement, anchor: ReferenceElement, placement: Placement, isSubmenu = false) {
    const [ side ] = placement.split("-");
    const otherSide = side === "left" ? "right" : "left";
    const { x, y, middlewareData } = await computePosition(anchor, menu, {
        strategy: "fixed",
        placement,
        middleware: [
            isSubmenu && offset(({ elements }) => {
                const style = getComputedStyle(elements.floating);
                const inset = (parseFloat(style.paddingTop) || 0) + (parseFloat(style.borderTopWidth) || 0);
                return { mainAxis: -2, crossAxis: -inset };
            }),
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
            }),
            isSubmenu && hide({ strategy: "referenceHidden" })
        ]
    });

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = middlewareData.hide?.referenceHidden ? "hidden" : "visible";
}

/** A zero-size anchor at a point in the viewport, such as where a right-click landed. */
function pointAt(x: number, y: number): VirtualElement {
    return {
        getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 })
    };
}
