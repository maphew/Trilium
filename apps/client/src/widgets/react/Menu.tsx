import "./Menu.css";

import { autoUpdate, computePosition, flip, type Placement, shift, size, type VirtualElement } from "@floating-ui/dom";
import clsx from "clsx";
import { useLayoutEffect, useRef } from "preact/hooks";

import type { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import { getActionSync } from "../../services/keyboard_actions";
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
    items: MenuItem<T>[];
    /** Called when an item is pressed with the primary button. */
    onSelect(item: MenuCommandItem<T>, e: MouseEvent): void;
    /** Called on a click inside a custom item, which closes the menu like a pressed item does. */
    onClose(): void;
}

/** How many pixels the menu keeps from the edges of the viewport. */
const VIEWPORT_PADDING = 5;

export default function Menu<T>({ id, className, x, y, orientation, items, onSelect, onClose }: MenuProps<T>) {
    const menuRef = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;

        const anchor = pointAt(x, y);
        const placement = orientation === "left" ? "left-start" : "right-start";
        // Places the menu now, and again whenever the viewport or the menu itself changes size.
        return autoUpdate(anchor, menu, () => void placeMenu(menu, anchor, placement));
    }, [ x, y, orientation ]);

    return (
        <div ref={menuRef} id={id} className={clsx("dropdown-menu show tn-menu", className)} role="menu">
            {menuRows(items).map((row, index) => {
                if (!("kind" in row)) return <MenuRow key={index} item={row} onSelect={onSelect} />;
                if (row.kind === "separator") return <div key={index} className="dropdown-divider" role="separator" />;
                if (row.kind === "header") return <h6 key={index} className="dropdown-header">{row.title}</h6>;
                return (
                    <li key={index} className="dropdown-custom-item" onClick={onClose}>
                        <row.componentFn />
                    </li>
                );
            })}
        </div>
    );
}

function MenuRow<T>({ item, onSelect }: { item: MenuCommandItem<T>, onSelect: MenuProps<T>["onSelect"] }) {
    const disabled = item.enabled === false;

    return (
        <li
            className={clsx("dropdown-item", disabled && "disabled", item.className)}
            role="menuitem"
            aria-disabled={disabled || undefined}
            // `mousedown` rather than `click`, and its default prevented, so the press does not move
            // focus: a text editor keeps the selection that commands such as a spelling fix act on.
            onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                if (!disabled) onSelect(item, e);
            }}
        >
            <span>
                <MenuIconSlot item={item} />
                <span className="tn-menu-gap" />
                {/* Callers pass HTML: titles escaped with `escapeHtml()` or boxed by `menuName()`. */}
                <span dangerouslySetInnerHTML={{ __html: item.title }} />
                <MenuShortcut item={item} />
            </span>
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

function isSeparator<T>(item: MenuItem<T>) {
    return "kind" in item && item.kind === "separator";
}

/**
 * Positions `menu` beside `anchor`, preferring `placement` and then the placements that mirror it,
 * the way a native menu opens above or to the left of a pointer that is near the viewport's edge.
 * The menu stays hidden until it is placed, so it never paints at a stale position.
 */
async function placeMenu(menu: HTMLElement, anchor: VirtualElement, placement: Placement) {
    const [ side ] = placement.split("-");
    const otherSide = side === "left" ? "right" : "left";
    const { x, y } = await computePosition(anchor, menu, {
        strategy: "fixed",
        placement,
        middleware: [
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
            })
        ]
    });

    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    menu.style.visibility = "visible";
}

/** A zero-size anchor at a point in the viewport, such as where a right-click landed. */
function pointAt(x: number, y: number): VirtualElement {
    return {
        getBoundingClientRect: () => DOMRect.fromRect({ x, y, width: 0, height: 0 })
    };
}
