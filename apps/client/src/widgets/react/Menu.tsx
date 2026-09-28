import "./Menu.css";

import { autoUpdate, computePosition, flip, hide, offset, type Placement, type ReferenceElement, shift, size, type VirtualElement } from "@floating-ui/dom";
import clsx from "clsx";
import { useCallback, useId, useLayoutEffect, useRef, useState } from "preact/hooks";

import type { CustomMenuItem, MenuCommandItem, MenuItem } from "../../menus/context_menu";
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
    /** Makes the first row the active one as the menu takes focus, for a menu a key opened. */
    startAtFirstRow?: boolean;
    items: MenuItem<T>[];
    /** Called when an item is pressed with the primary button, or run from the keyboard. */
    onSelect(item: MenuCommandItem<T>, e: MouseEvent | KeyboardEvent): void;
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
    /**
     * Shows the layer without the stylesheet's opening delay and fade: it replaces a submenu that
     * was open, or a key or a press chose it, so it is not a pointer passing over its row.
     */
    immediate: boolean;
}

/** A row the keyboard can stand on: a command, or a custom row with something to focus in it. */
type NavigableItem<T> = MenuCommandItem<T> | CustomMenuItem;

/** The row the keyboard acts on, and the level it stands at. */
interface ActiveRow<T> {
    level: number;
    item: NavigableItem<T>;
}

/** The keys the menu keeps while focus is inside a custom row: those that leave it. */
const KEYS_LEAVING_CUSTOM_ROW = new Set([ "ArrowUp", "ArrowDown", "Escape", "Tab" ]);

/** How long typed letters keep adding to the text a row is looked up by. */
const TYPEAHEAD_TIMEOUT = 500;

/** What every level of the menu shares. */
interface MenuState<T> {
    onSelect: MenuProps<T>["onSelect"];
    onClose: MenuProps<T>["onClose"];
    /**
     * Opens `item`'s submenu at `level`, closing whatever stood open at that level and deeper, or
     * without an item only closes them.
     */
    openSubmenu(level: number, item?: MenuCommandItem<T>, anchor?: HTMLElement, chosen?: boolean): void;
    /** The item whose submenu stands open at each level. */
    openItems: MenuCommandItem<T>[];
    active?: ActiveRow<T>;
    setActive(level: number, item: NavigableItem<T>): void;
    /** Each row's element, for `aria-activedescendant` and for anchoring a submenu the keyboard opens. */
    rows: Map<NavigableItem<T>, HTMLElement>;
}

export default function Menu<T>({ id, className, x, y, orientation, bottomSheet, startAtFirstRow, items, onSelect, onClose }: MenuProps<T>) {
    const menuRef = useRef<HTMLDivElement>(null);
    const [ submenus, setSubmenus ] = useState<OpenSubmenu<T>[]>([]);
    const nextKey = useRef(0);

    const openSubmenu = useCallback((level: number, item?: MenuCommandItem<T>, anchor?: HTMLElement, chosen = false) => {
        setSubmenus((open) => {
            if (item ? open[level]?.item === item : open.length <= level) return open;
            const kept = open.slice(0, level);
            const immediate = chosen || !!open[level];
            return item && anchor ? [ ...kept, { item, anchor, key: nextKey.current++, immediate } ] : kept;
        });
    }, []);
    const [ active, setActiveRow ] = useState<ActiveRow<T>>();
    const rows = useRef(new Map<NavigableItem<T>, HTMLElement>()).current;
    const typeahead = useRef({ text: "", timeout: 0 });
    /** Whether the keys moved the menu since the pointer last did. See `Menu.css`. */
    const [ keyboardDriven, setKeyboardDriven ] = useState(false);

    const setActive = useCallback((level: number, item: NavigableItem<T>) => {
        setActiveRow({ level, item });
        rows.get(item)?.scrollIntoView?.({ block: "nearest" });
    }, [ rows ]);
    const state: MenuState<T> = {
        onSelect, onClose, openSubmenu, openItems: submenus.map((submenu) => submenu.item), active, setActive, rows
    };

    // After the commit: a submenu's rows register their elements only as they mount.
    useLayoutEffect(() => {
        const id = active && !isCustom(active.item) ? rows.get(active.item)?.id : undefined;
        if (id) menuRef.current?.setAttribute("aria-activedescendant", id);
        else menuRef.current?.removeAttribute("aria-activedescendant");
    }, [ active, submenus, rows ]);

    // A custom row takes focus in itself, for its own keys; any other row hands it back to the menu.
    useLayoutEffect(() => {
        const menu = menuRef.current;
        if (!menu || !active) return;
        if (isCustom(active.item)) {
            focusTarget(rows.get(active.item))?.focus({ preventScroll: true });
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

    /** The rows the keys can stand on at `level`: those that run something, and custom rows with something to focus. */
    function navigableRows(level: number) {
        return menuRows(level === 0 ? items : submenus[level - 1]?.item.items ?? [])
            .filter((row): row is NavigableItem<T> => isCustom(row)
                ? !!focusTarget(rows.get(row))
                : isRunnable(row));
    }

    function onKeyDown(e: KeyboardEvent) {
        const level = active?.level ?? 0;
        const levelRows = navigableRows(level);
        const index = active ? levelRows.indexOf(active.item) : -1;
        const count = levelRows.length;
        // A submenu goes with its row's highlight, as in a native menu, until Right opens it again.
        const moveTo = (item: NavigableItem<T>) => {
            if (submenus[level]?.item !== item) openSubmenu(level);
            setActive(level, item);
        };
        const goTo = (position: number) => {
            const item = levelRows[((position % count) + count) % count];
            if (item) moveTo(item);
        };
        const openActive = () => {
            const item = active && !isCustom(active.item) ? active.item : undefined;
            const anchor = item && rows.get(item);
            if (!item?.items || !anchor || isMobile()) return;
            openSubmenu(level, item, anchor, true);
            const first = runnableRows(item.items)[0];
            if (first) setActive(level + 1, first);
        };
        const closeLevel = (closing: number) => {
            const parent = submenus[closing - 1];
            if (!parent) return;
            openSubmenu(closing - 1);
            setActive(closing - 1, parent.item);
        };
        const rtl = handleRightToLeftPlacement("right") !== "right";
        /** Moves to the row beside the active one in a menu laid out in columns, if there is one. */
        const moveAcross = (towards: "left" | "right") => {
            const boxes = levelRows.map((item) => rows.get(item)?.getBoundingClientRect());
            const target = rowInNextColumn(boxes, index, towards);
            const item = target !== undefined ? levelRows[target] : undefined;
            if (item) moveTo(item);
            return !!item;
        };

        switch (e.key) {
            case "ArrowDown": goTo(index + 1); break;
            case "ArrowUp": goTo(index < 0 ? -1 : index - 1); break;
            case "Home": goTo(0); break;
            case "End": goTo(-1); break;
            // Into the active row's submenu, or else across to the next column.
            case rtl ? "ArrowLeft" : "ArrowRight":
                if (active && !isCustom(active.item) && active.item.items) openActive();
                else moveAcross(e.key === "ArrowRight" ? "right" : "left");
                break;
            // Back across a column, or else out of the submenu.
            case rtl ? "ArrowRight" : "ArrowLeft":
                if (!moveAcross(e.key === "ArrowRight" ? "right" : "left") && level > 0) closeLevel(level);
                break;
            case "Enter":
            case " ":
                if (!active || isCustom(active.item)) break;
                openActive();
                onSelect(active.item, e);
                break;
            case "Escape":
                // One level at a time, then the menu itself.
                if (submenus.length) closeLevel(submenus.length);
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
                    const item = levelRows[(index + step + count) % count];
                    if (item && rows.get(item)?.textContent?.trim().toLowerCase().startsWith(typed.text)) {
                        moveTo(item);
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
        <div
            ref={menuRef} id={id} role="menu" tabIndex={-1}
            className={clsx("dropdown-menu show tn-menu", bottomSheet && "mobile-bottom-menu",
                keyboardDriven && "tn-menu-keyboard", className)}
            onPointerMove={() => setKeyboardDriven(false)}
            // Neither the browser's menu nor another of the app's opens over this one. Every level
            // is inside this element, so one handler covers them all.
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
        >
            {/* The rows scroll in here rather than the menu itself, so the theme's blur on the
                menu's `::before` stays behind them. */}
            <div className="tn-menu-scroll">
                <MenuList level={0} items={items} state={state} />
            </div>
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
            <ul ref={layerRef} className={clsx("dropdown-menu show tn-menu", submenu.immediate && "tn-menu-immediate")} role="menu">
                {/* Like the top level, so the blur on the layer's `::before` stays behind its rows. */}
                <div className="tn-menu-scroll">
                    {columns
                        // The columns go on an inner element of their full height, so a capped menu
                        // scrolls them rather than growing more columns to the side.
                        ? (
                            <div className="tn-menu-columns" style={{ columnCount: columns }}>
                                <MenuList level={level} items={items} state={state} columns />
                            </div>
                        )
                        : <MenuList level={level} items={items} state={state} />}
                </div>
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
        <li
            className="dropdown-custom-item"
            ref={(element) => {
                if (element) state.rows.set(row, element);
                else state.rows.delete(row);
            }}
            // Only a click on what the row acts with closes the menu: one in the space around it,
            // such as between the color picker's cells, picks nothing.
            onClick={(e) => {
                if (actsOnClick(e.target, e.currentTarget)) state.onClose();
            }}
        >
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
    const active = state.active?.level === level && state.active.item === item;
    const id = useId();

    function onPointed(e: { currentTarget: HTMLLIElement }) {
        if (isMobile()) return;
        // The keyboard goes on from the row the pointer last pointed at.
        if (!disabled) state.setActive(level, item);
        state.openSubmenu(level, hasSubmenu && !disabled ? item : undefined, e.currentTarget);
    }

    return (
        <li
            id={id}
            ref={(element) => {
                if (element) state.rows.set(item, element);
                else state.rows.delete(item);
            }}
            className={clsx("dropdown-item", hasSubmenu && "dropdown-submenu", open && "submenu-open",
                active && "tn-menu-active", disabled && "disabled", item.className)}
            role="menuitem"
            aria-disabled={disabled || undefined}
            aria-haspopup={hasSubmenu ? "menu" : undefined}
            aria-expanded={hasSubmenu ? open : undefined}
            onPointerEnter={onPointed}
            // The keys can move the active row from under a pointer at rest, whose `:hover` would
            // then mark a second row. The next move of the pointer makes its row the active one.
            onPointerMove={(e) => {
                if (!active) onPointed(e);
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

                if (hasSubmenu && isMobile()) {
                    setUnfolded(!unfolded);
                    return;
                }
                if (hasSubmenu) state.openSubmenu(level, item, e.currentTarget, true);
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

/** The rows the keyboard can reach: those that run something, and are enabled. */
function runnableRows<T>(items: MenuItem<T>[]) {
    return menuRows(items).filter(isRunnable);
}

function isRunnable<T>(row: MenuItem<T>): row is MenuCommandItem<T> {
    return !("kind" in row) && row.enabled !== false;
}

function isCustom<T>(row: MenuItem<T>): row is CustomMenuItem {
    return "kind" in row && row.kind === "custom";
}

/** What a custom row's content acts with: the elements a click on does something. */
const ACTING_ELEMENTS = "button, a[href], input, select, textarea, [tabindex], "
    + "[role='button'], [role='option'], [role='menuitem'], [role='checkbox'], [role='radio'], [role='switch']";

/** Whether a click on `target` inside `row` landed on an enabled element that acts. */
function actsOnClick(target: EventTarget | null, row: HTMLElement) {
    const acting = target instanceof Element ? target.closest(ACTING_ELEMENTS) : null;
    return !!acting && row.contains(acting) && acting !== row
        && acting.getAttribute("aria-disabled") !== "true" && !acting.matches(":disabled");
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
