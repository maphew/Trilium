import { createContext } from "preact";
import { useContext } from "preact/hooks";

/*
 * What a `Menu` shares with its rows, apart from the menu itself so the rows `FormList` draws can
 * join one without `FormList` and `Menu` importing each other.
 */

/** A submenu standing open, and the row it opened from. */
export interface OpenSubmenu {
    /** The id of the row it opened from. */
    id: string;
    anchor: HTMLElement;
    /**
     * Shows the layer without the stylesheet's opening delay and fade: it replaces a submenu that
     * was open, or a key or a press chose it, so it is not a pointer passing over its row.
     */
    immediate: boolean;
}

/** A row as it registers with its menu, for the keys to find and act on. */
export interface RowEntry {
    level: number;
    element: HTMLElement;
    /** A custom row takes focus in itself instead of running anything. */
    custom: boolean;
    disabled: boolean;
    hasSubmenu: boolean;
    /** Runs the row, as a press or Enter does, once its submenu, if it has one, is open. */
    select(e: MouseEvent | KeyboardEvent): void;
}

/** The row the keyboard acts on, and the level it stands at. */
export interface ActiveRow {
    level: number;
    id: string;
}

/** What every row of a menu shares, at every level. */
export interface MenuContextValue {
    /** The submenu standing open at each level, the top level's first. */
    open: OpenSubmenu[];
    /**
     * Opens the submenu of the row `id` at `level`, closing whatever stood open at that level and
     * deeper, or without a row only closes them.
     */
    openSubmenu(level: number, id?: string, anchor?: HTMLElement, chosen?: boolean): void;
    active?: ActiveRow;
    setActive(level: number, id: string): void;
    /** The rows by id, as they registered. */
    rows: Map<string, RowEntry>;
    /** Registers a row as it mounts, and with `undefined` takes it back as it unmounts. */
    registerRow(id: string, row: RowEntry | undefined): void;
    /** Whether the keys moved the menu since the pointer last did. */
    keyboardDriven: boolean;
    close(): void;
    /**
     * Where a row renders its submenu's layer: the top level's element, so the rules scoped to the
     * menu apply, but outside its scroller and any other layer, as a fixed layer escapes a
     * scrolling menu only while no ancestor carries a filter.
     */
    layerHost: HTMLElement | null;
}

export const MenuContext = createContext<MenuContextValue | null>(null);
/** How deep the rows rendered here stand: 0 at the top level, 1 in its submenus, and so on. */
export const MenuLevelContext = createContext(0);

/** The menu a row stands in, for a row that works only inside one. */
export function useMenu() {
    const menu = useContext(MenuContext);
    if (!menu) throw new Error("A menu row must be rendered inside a Menu.");
    return menu;
}
