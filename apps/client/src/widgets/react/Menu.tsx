import "./Menu.css";

import { autoUpdate, computePosition, flip, type Placement, shift, size, type VirtualElement } from "@floating-ui/dom";
import clsx from "clsx";
import { useLayoutEffect, useRef } from "preact/hooks";

import type { MenuCommandItem, MenuItem, MenuSeparatorItem } from "../../menus/context_menu";
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
}

/** How many pixels the menu keeps from the edges of the viewport. */
const VIEWPORT_PADDING = 5;

export default function Menu<T>({ id, className, x, y, orientation, items, onSelect }: MenuProps<T>) {
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
            {menuRows(items).map((row, index) => ("kind" in row && row.kind === "separator"
                ? <div key={index} className="dropdown-divider" role="separator" />
                : <MenuRow key={index} item={row as MenuCommandItem<T>} onSelect={onSelect} />
            ))}
        </div>
    );
}

function MenuRow<T>({ item, onSelect }: { item: MenuCommandItem<T>, onSelect: MenuProps<T>["onSelect"] }) {
    return (
        <li
            className={clsx("dropdown-item", item.className)}
            role="menuitem"
            // `mousedown` rather than `click`, and its default prevented, so the press does not move
            // focus: a text editor keeps the selection that commands such as a spelling fix act on.
            onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                onSelect(item, e);
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

/** The items `Menu` renders so far, with a run of separators reduced to one. */
function menuRows<T>(items: MenuItem<T>[]) {
    const rows: (MenuCommandItem<T> | MenuSeparatorItem)[] = [];
    for (const item of items) {
        const kind = "kind" in item ? item.kind : undefined;
        if (kind === "separator") {
            const previous = rows.at(-1);
            if (previous && "kind" in previous) continue;
            rows.push(item as MenuSeparatorItem);
        } else if (!kind) {
            rows.push(item as MenuCommandItem<T>);
        }
    }
    return rows;
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
