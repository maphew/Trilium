import "./Menu.css";

import { computePosition, flip, type Placement, shift, size, type VirtualElement } from "@floating-ui/dom";
import { useCallback, useLayoutEffect, useRef } from "preact/hooks";

import type { MenuCommandItem, MenuItem, MenuSeparatorItem } from "../../menus/context_menu";
import { useResizeObserver } from "./hooks";
import Icon from "./Icon";

export interface MenuProps<T> {
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

export default function Menu<T>({ x, y, orientation, items, onSelect }: MenuProps<T>) {
    const menuRef = useRef<HTMLDivElement>(null);
    const place = useCallback(() => {
        if (!menuRef.current) return;
        void placeMenu(menuRef.current, pointAt(x, y), orientation === "left" ? "left-start" : "right-start");
    }, [ x, y, orientation ]);

    useLayoutEffect(place, [ place ]);
    // The menu's size can change after it opens, e.g. once asynchronously loaded items arrive.
    useResizeObserver(menuRef, place);

    return (
        <div ref={menuRef} className="tn-menu" role="menu">
            {menuRows(items).map((row, index) => ("kind" in row && row.kind === "separator"
                ? <div key={index} className="tn-menu-separator" role="separator" />
                : <MenuRow key={index} item={row as MenuCommandItem<T>} onSelect={onSelect} />
            ))}
        </div>
    );
}

function MenuRow<T>({ item, onSelect }: { item: MenuCommandItem<T>, onSelect: MenuProps<T>["onSelect"] }) {
    return (
        <div
            className="tn-menu-item"
            role="menuitem"
            // `mousedown` rather than `click`, and its default prevented, so the press does not move
            // focus: a text editor keeps the selection that commands such as a spelling fix act on.
            onMouseDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                onSelect(item, e);
            }}
        >
            {("uiIcon" in item || "checked" in item) && (
                <Icon icon={item.checked ? "bx bx-check" : item.uiIcon} className={item.iconColorClass} />
            )}
            {/* Callers pass HTML: titles escaped with `escapeHtml()` or boxed by `menuName()`. */}
            <span dangerouslySetInnerHTML={{ __html: item.title }} />
        </div>
    );
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
