import "./Menu.css";

import { autoUpdate, computePosition, flip, hide, offset, type Placement, type ReferenceElement, shift, size, type VirtualElement } from "@floating-ui/dom";
import clsx from "clsx";
import type { ComponentChildren } from "preact";
import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import { handleRightToLeftPlacement, isMobile } from "../../services/utils";
import { FormDropdownDivider, FormDropdownSubmenu, FormListCustomItem, FormListHeader, FormListItem } from "./FormList";
import { type ActiveRow, MenuContext, type MenuContextValue, type OpenSubmenu, type RowEntry } from "./menu_context";

/**
 * A menu of commands, drawn with the markup Bootstrap's dropdowns use (`.dropdown-menu`,
 * `.dropdown-item`, `.dropdown-divider`), so the stylesheets and themes that style those style
 * this too. Only the placement is its own.
 *
 * The rows come as data in {@link items}, or as components in {@link children}: `FormListItem`,
 * `FormDropdownSubmenu`, `FormDropdownDivider`, `FormListHeader` and `FormListCustomItem`.
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
    /** Makes the first row the active one as the menu takes focus, for a menu a key opened. */
    startAtFirstRow?: boolean;
    items?: MenuItem<T>[];
    /** Called when one of {@link items} is pressed with the primary button, or run from the keyboard. */
    onSelect?(item: MenuCommandItem<T>, e: MouseEvent | KeyboardEvent): void;
    children?: ComponentChildren;
    /** Called when a row that closes the menu runs, on a click inside a custom row, and on Escape. */
    onClose(): void;
}

/** How many pixels the menu keeps from the edges of the viewport. */
const VIEWPORT_PADDING = 5;

/** The keys the menu keeps while focus is inside a custom row: those that leave it. */
const KEYS_LEAVING_CUSTOM_ROW = new Set([ "ArrowUp", "ArrowDown", "Escape", "Tab" ]);

/** How long typed letters keep adding to the text a row is looked up by. */
const TYPEAHEAD_TIMEOUT = 500;

export default function Menu<T>({ id, className, x, y, orientation, bottomSheet, startAtFirstRow, items, onSelect, children, onClose }: MenuProps<T>) {
    const menuRef = useRef<HTMLDivElement | null>(null);
    // The submenus' layers render into the menu element, which rows reach through the context.
    const [ layerHost, setLayerHost ] = useState<HTMLElement | null>(null);
    const setMenuElement = useCallback((element: HTMLDivElement | null) => {
        menuRef.current = element;
        setLayerHost(element);
    }, []);
    const [ open, setOpen ] = useState<OpenSubmenu[]>([]);

    const openSubmenu = useCallback((level: number, rowId?: string, anchor?: HTMLElement, chosen = false) => {
        setOpen((current) => {
            if (rowId ? current[level]?.id === rowId : current.length <= level) return current;
            const kept = current.slice(0, level);
            const immediate = chosen || !!current[level];
            return rowId && anchor ? [ ...kept, { id: rowId, anchor, immediate } ] : kept;
        });
    }, []);
    const [ active, setActiveRow ] = useState<ActiveRow>();
    const rows = useRef(new Map<string, RowEntry>()).current;
    /** The level whose first row becomes active once it has rendered, for a submenu a key opened. */
    const pendingFirstRow = useRef<number>();
    const typeahead = useRef({ text: "", timeout: 0 });
    /** Whether the keys moved the menu since the pointer last did. See `Menu.css`. */
    const [ keyboardDriven, setKeyboardDriven ] = useState(false);

    const setActive = useCallback((level: number, rowId: string) => {
        setActiveRow({ level, id: rowId });
        rows.get(rowId)?.element.scrollIntoView?.({ block: "nearest" });
    }, [ rows ]);
    const registerRow = useCallback((rowId: string, row: RowEntry | undefined) => {
        if (!row) {
            rows.delete(rowId);
            return;
        }
        rows.set(rowId, row);
        // A portaled submenu can commit after this component's effects, so the level a key opened
        // looks for its first row once the rows that register with it have all done so.
        if (pendingFirstRow.current !== row.level) return;
        queueMicrotask(() => {
            if (pendingFirstRow.current !== row.level) return;
            pendingFirstRow.current = undefined;
            activateFirstRowRef.current(row.level);
        });
    }, [ rows ]);
    const context: MenuContextValue = {
        open, openSubmenu, active, setActive, rows, registerRow, keyboardDriven, close: onClose, layerHost
    };

    /** The ids of the rows the keys can stand on at `level`, in the order they stand in. */
    function navigableRows(level: number) {
        const found: [ string, RowEntry ][] = [];
        for (const [ rowId, row ] of rows) {
            if (row.level !== level) continue;
            if (row.custom ? focusTarget(row.element) : !row.disabled) found.push([ rowId, row ]);
        }
        found.sort(([ , a ], [ , b ]) => (a.element.compareDocumentPosition(b.element) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
        return found.map(([ rowId ]) => rowId);
    }

    /** Makes the first row at `level` that runs something the active one, if the level has rendered. */
    function activateFirstRow(level: number) {
        const first = navigableRows(level).find((rowId) => !rows.get(rowId)?.custom);
        if (first) setActive(level, first);
        return !!first;
    }

    const activateFirstRowRef = useRef(activateFirstRow);
    activateFirstRowRef.current = activateFirstRow;

    // After the commit: a submenu's rows register their elements only as they mount.
    useLayoutEffect(() => {
        const row = active && rows.get(active.id);
        const rowId = row && !row.custom ? row.element.id : undefined;
        if (rowId) menuRef.current?.setAttribute("aria-activedescendant", rowId);
        else menuRef.current?.removeAttribute("aria-activedescendant");
    }, [ active, open, rows ]);

    // A custom row takes focus in itself, for its own keys; any other row hands it back to the menu.
    useLayoutEffect(() => {
        const menu = menuRef.current;
        const row = active && rows.get(active.id);
        if (!menu || !row) return;
        if (row.custom) {
            focusTarget(row.element)?.focus({ preventScroll: true });
        } else if (document.activeElement !== menu && menu.contains(document.activeElement)) {
            menu.focus({ preventScroll: true });
        }
    }, [ active, rows ]);

    const keyHandler = useRef(onKeyDown);
    keyHandler.current = onKeyDown;
    useLayoutEffect(() => {
        // Captured at the window: Bootstrap captures keys at the document for anything inside a
        // `.dropdown-menu`, and takes them for a dropdown of its own. Inside a custom row, only the
        // keys that leave it, so the control there keeps its own.
        const listener = (e: KeyboardEvent) => {
            const menu = menuRef.current;
            if (e.target === menu
                    || (menu?.contains(e.target as Node) && KEYS_LEAVING_CUSTOM_ROW.has(e.key))) {
                keyHandler.current(e);
            }
        };
        window.addEventListener("keydown", listener, true);
        return () => window.removeEventListener("keydown", listener, true);
    }, []);

    function onKeyDown(e: KeyboardEvent) {
        const level = active?.level ?? 0;
        const levelRows = navigableRows(level);
        const index = active ? levelRows.indexOf(active.id) : -1;
        const count = levelRows.length;
        const activeRow = active && rows.get(active.id);
        // A submenu goes with its row's highlight, as in a native menu, until Right opens it again.
        const moveTo = (rowId: string) => {
            if (open[level]?.id !== rowId) openSubmenu(level);
            setActive(level, rowId);
        };
        const goTo = (position: number) => {
            const rowId = levelRows[((position % count) + count) % count];
            if (rowId) moveTo(rowId);
        };
        const openActive = () => {
            if (!active || !activeRow?.hasSubmenu || activeRow.custom) return;
            openSubmenu(level, active.id, activeRow.element, true);
            // A submenu already open has its rows; one opening now has them once it renders.
            if (!activateFirstRow(level + 1)) pendingFirstRow.current = level + 1;
        };
        const closeLevel = (closing: number) => {
            const parent = open[closing - 1];
            if (!parent) return;
            openSubmenu(closing - 1);
            setActive(closing - 1, parent.id);
        };
        const rtl = handleRightToLeftPlacement("right") !== "right";
        /** Moves to the row beside the active one in a menu laid out in columns, if there is one. */
        const moveAcross = (towards: "left" | "right") => {
            const boxes = levelRows.map((rowId) => rows.get(rowId)?.element.getBoundingClientRect());
            const target = rowInNextColumn(boxes, index, towards);
            const rowId = target !== undefined ? levelRows[target] : undefined;
            if (rowId) moveTo(rowId);
            return !!rowId;
        };

        switch (e.key) {
            case "ArrowDown": goTo(index + 1); break;
            case "ArrowUp": goTo(index < 0 ? -1 : index - 1); break;
            case "Home": goTo(0); break;
            case "End": goTo(-1); break;
            // Into the active row's submenu, or else across to the next column.
            case rtl ? "ArrowLeft" : "ArrowRight":
                if (activeRow && !activeRow.custom && activeRow.hasSubmenu) openActive();
                else moveAcross(e.key === "ArrowRight" ? "right" : "left");
                break;
            // Back across a column, or else out of the submenu.
            case rtl ? "ArrowRight" : "ArrowLeft":
                if (!moveAcross(e.key === "ArrowRight" ? "right" : "left") && level > 0) closeLevel(level);
                break;
            case "Enter":
            case " ":
                if (!activeRow || activeRow.custom) break;
                openActive();
                activeRow.select(e);
                break;
            case "Escape":
                // One level at a time, then the menu itself.
                if (open.length) closeLevel(open.length);
                else onClose();
                break;
            // Focus stays in the menu until it closes.
            case "Tab": break;
            default: {
                if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
                const typed = typeahead.current;
                window.clearTimeout(typed.timeout);
                typed.timeout = window.setTimeout(() => typed.text = "", TYPEAHEAD_TIMEOUT);
                typed.text += e.key.toLowerCase();
                // A first letter looks past the active row, so pressing it again moves on.
                const skip = typed.text.length === 1 ? 1 : 0;
                for (let step = skip; step < count + skip; step++) {
                    const rowId = levelRows[(index + step + count) % count];
                    if (rowId && rows.get(rowId)?.element.textContent?.trim().toLowerCase().startsWith(typed.text)) {
                        moveTo(rowId);
                        break;
                    }
                }
            }
        }
        setKeyboardDriven(true);
        e.preventDefault();
        e.stopPropagation();
    }

    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu) return;
        // The keys go to the menu while it is up; `contextMenu` gives focus back once it is hidden.
        // A browser does not focus an element under `visibility: hidden`, so the menu takes focus
        // only once it is shown.
        const takeFocus = () => {
            menu.focus({ preventScroll: true });
            if (!startAtFirstRow) return;
            const first = navigableRows(0)[0];
            if (first) setActive(0, first);
            setKeyboardDriven(true);
        };
        if (bottomSheet) {
            // An inline `max-height` would override the sheet's own, which is not `!important`.
            menu.style.visibility = "visible";
            takeFocus();
            return;
        }

        const anchor = pointAt(x, y);
        const placement = orientation === "left" ? "left-start" : "right-start";
        let placed = false;
        // Places the menu now, and again whenever the viewport or the menu itself changes size.
        return autoUpdate(anchor, menu, () => void placeMenu(menu, anchor, placement).then(() => {
            if (placed) return;
            placed = true;
            takeFocus();
        }));
    }, [ x, y, orientation, bottomSheet ]);

    return (
        <MenuContext.Provider value={context}>
            <div
                ref={setMenuElement} id={id} role="menu" tabIndex={-1}
                className={clsx("dropdown-menu show tn-menu", bottomSheet && "mobile-bottom-menu",
                    keyboardDriven && "tn-menu-keyboard", className)}
                onPointerMove={(e) => {
                    if (pointerMoved(e)) setKeyboardDriven(false);
                }}
                // Neither the browser's menu nor another of the app's opens over this one. Every level
                // is inside this element, so one handler covers them all.
                onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                }}
            >
                {/* The rows scroll in here rather than the menu itself, so the theme's blur on the
                    menu's `::before` stays behind them. A `<menu>`, as rows are its list items, out of
                    the accessibility tree so they read as the menu's own. */}
                <menu className="tn-menu-scroll" role="none">
                    {items ? <MenuItems items={items} onSelect={onSelect} /> : children}
                </menu>
                {/* The submenus' layers follow the scroller in here, portaled by their rows. */}
            </div>
        </MenuContext.Provider>
    );
}

/**
 * `items` drawn as the rows that stand for them, with a run of separators reduced to one. In
 * `columns`, the rows a column must not break between are wrapped in `.dropdown-no-break`.
 */
function MenuItems<T>({ items, onSelect, columns }: {
    items: MenuItem<T>[],
    onSelect: MenuProps<T>["onSelect"],
    columns?: boolean
}) {
    const rows = menuRows(items);
    if (!columns) return <>{rows.map((row, index) => <MenuItemRow key={index} row={row} onSelect={onSelect} />)}</>;

    return <>
        {unbreakableGroups(rows).map((group, groupIndex) => (group.length > 1
            ? (
                <li key={groupIndex} className="dropdown-no-break" role="none">
                    <menu role="none">
                        {group.map((row, index) => <MenuItemRow key={index} row={row} onSelect={onSelect} />)}
                    </menu>
                </li>
            )
            : <MenuItemRow key={groupIndex} row={group[0]} onSelect={onSelect} />
        ))}
    </>;
}

function MenuItemRow<T>({ row, onSelect }: { row: MenuItem<T>, onSelect: MenuProps<T>["onSelect"] }) {
    if ("kind" in row) {
        if (row.kind === "separator") return <FormDropdownDivider />;
        // Its title is text, as it can be a name the user wrote.
        if (row.kind === "header") return <FormListHeader text={row.title} />;
        return <FormListCustomItem><row.componentFn /></FormListCustomItem>;
    }

    const { title, uiIcon, iconColorClass, checked, enabled, badges, className, items } = row;
    // Callers pass HTML: titles escaped with `escapeHtml()` or boxed by `menuName()`.
    const label = <span dangerouslySetInnerHTML={{ __html: title }} />;
    // `onSelect` decides whether the menu closes, as `contextMenu` does.
    const select = (e: MouseEvent) => onSelect?.(row, e);

    if (items) {
        return (
            <FormDropdownSubmenu icon={uiIcon ?? "bx bx-empty"} title={label} onDropdownToggleClicked={select}>
                {/* A phone unfolds a submenu in a single column. */}
                <MenuItems items={items} onSelect={onSelect} columns={(row.columns ?? 1) > 1 && !isMobile()} />
            </FormDropdownSubmenu>
        );
    }

    return (
        <FormListItem
            icon={uiIcon} iconClassName={iconColorClass} checked={checked} disabled={enabled === false}
            className={className} badges={badges?.map((badge) => ({ className: badge.className, text: badge.title }))}
            onClick={select}
        >
            {label}
        </FormListItem>
    );
}

/** How far apart, in pixels, two rows' left edges can be and still stand in one column. */
const COLUMN_TOLERANCE = 1;

/**
 * In a menu laid out in columns, the index of the row beside `boxes[index]` in the nearest column
 * towards `towards`: the one whose middle is nearest its middle. The browser decides where CSS
 * columns break, so the rows' boxes are all there is to go by. Rows without a box are passed over.
 */
export function rowInNextColumn(
    boxes: (Pick<DOMRect, "left" | "top" | "bottom"> | undefined)[],
    index: number,
    towards: "left" | "right"
): number | undefined {
    const from = boxes[index];
    if (!from) return undefined;

    const middle = (box: Pick<DOMRect, "top" | "bottom">) => (box.top + box.bottom) / 2;
    const beyond: { box: Pick<DOMRect, "left" | "top" | "bottom">, index: number }[] = [];
    for (const [ candidateIndex, box ] of boxes.entries()) {
        if (!box) continue;
        const offset = box.left - from.left;
        if (towards === "right" ? offset > COLUMN_TOLERANCE : offset < -COLUMN_TOLERANCE) {
            beyond.push({ box, index: candidateIndex });
        }
    }
    if (!beyond.length) return undefined;

    const lefts = beyond.map(({ box }) => box.left);
    const columnLeft = towards === "right" ? Math.min(...lefts) : Math.max(...lefts);
    let nearest: { box: Pick<DOMRect, "left" | "top" | "bottom">, index: number } | undefined;
    for (const candidate of beyond) {
        if (Math.abs(candidate.box.left - columnLeft) > COLUMN_TOLERANCE) continue;
        const distance = Math.abs(middle(candidate.box) - middle(from));
        if (!nearest || distance < Math.abs(middle(nearest.box) - middle(from))) nearest = candidate;
    }
    return nearest?.index;
}

/**
 * Whether the pointer really moved. A menu appearing under a pointer at rest has the browser enter
 * the row there, and Chromium follow with a `pointermove` that goes nowhere; neither is the user
 * turning to the pointer.
 */
function pointerMoved(e: PointerEvent) {
    return e.movementX !== 0 || e.movementY !== 0;
}

/** Where a custom row takes focus: the element its content marks as its way in with `tabindex="0"`. */
function focusTarget(row: HTMLElement | undefined) {
    return row?.querySelector<HTMLElement>("[tabindex='0']") ?? null;
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
export async function placeMenu(menu: HTMLElement, anchor: ReferenceElement, placement: Placement, isSubmenu = false) {
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
