import { KeyboardActionNames } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { h, JSX, render } from "preact";

import note_tooltip from "../services/note_tooltip.js";
import utils from "../services/utils.js";
import Menu from "../widgets/react/Menu";

export interface ContextMenuOptions<T> {
    x: number;
    y: number;
    orientation?: "left";
    selectMenuItemHandler: MenuHandler<T>;
    items: MenuItem<T>[];
    /** On mobile, if set to `true` then the context menu is shown near the element. If `false` (default), then the context menu is shown at the bottom of the screen. */
    forcePositionOnMobile?: boolean;
    onHide?: () => void;
}

export interface CustomMenuItem {
    kind: "custom",
    componentFn: () => JSX.Element | null;
}

export interface MenuSeparatorItem {
    kind: "separator";
}

export interface MenuHeader {
    title: string;
    kind: "header";
}

export interface MenuItemBadge {
    title: string;
    className?: string;
}

export interface MenuCommandItem<T> {
    title: string;
    command?: T;
    type?: string;
    mime?: string;
    /**
     * The icon to display in the menu item.
     *
     * If not set, no icon is displayed and the item will appear shifted slightly to the left if there are other items with icons. To avoid this, use `bx bx-empty`.
     */
    uiIcon?: string;
    /**
     * Classes tinting {@link uiIcon} with the colour of whatever the item stands for, as
     * `cssClassManager.createClassForColor()` and `FNote#getColorClass()` return them. Only the
     * icon is tinted, the label staying readable against the highlight.
     */
    iconColorClass?: string;
    badges?: MenuItemBadge[];
    templateNoteId?: string;
    enabled?: boolean;
    handler?: MenuHandler<T>;
    items?: MenuItem<T>[] | null;
    shortcut?: string;
    keyboardShortcut?: KeyboardActionNames;
    spellingSuggestion?: string;
    checked?: boolean;
    /** Classes put on the item itself, for a menu styling one of its entries differently. */
    className?: string;
    /**
     * An icon shown at the trailing edge of the item, where a shortcut would go.
     *
     * Unlike {@link checked}, which takes the place of {@link uiIcon}, this leaves the item's own
     * icon standing — for a list where that icon is what tells one entry from another.
     */
    trailingIcon?: string;
    columns?: number;
}

export type MenuItem<T> = MenuCommandItem<T> | CustomMenuItem | MenuSeparatorItem | MenuHeader;
export type MenuHandler<T> = (item: MenuCommandItem<T>, e: MouseEvent) => void;
export type ContextMenuEvent = PointerEvent | MouseEvent | JQuery.ContextMenuEvent;

class ContextMenu {
    private readonly container: HTMLElement | null;
    private readonly cover: HTMLElement | null;
    /** Where the menu stands while nothing has the screen to itself. See {@link hostInWhateverHasTheScreen}. */
    private readonly home: HTMLElement | null;
    private options?: ContextMenuOptions<any>;

    constructor() {
        this.container = document.getElementById("context-menu-container");
        this.home = this.container?.parentElement ?? null;
        this.cover = utils.isMobile() ? document.getElementById("context-menu-cover") : null;

        if (this.cover) {
            this.cover.addEventListener("click", () => this.hide());
        } else {
            document.addEventListener("click", () => this.hide());
        }
    }

    async show<T>(options: ContextMenuOptions<T>) {
        note_tooltip.dismissAllTooltips();
        hideShownTooltips();

        if (this.isShown()) {
            // Unmount first so the menu opens fresh at the new location.
            await this.hide();
        }

        if (!this.container) return;

        this.options = options;
        this.hostInWhateverHasTheScreen(this.container);
        this.cover?.classList.add("show");
        document.body.classList.add("context-menu-shown");

        render(h(Menu<T>, {
            x: options.x,
            y: options.y,
            orientation: options.orientation,
            items: options.items,
            onSelect: (item, e) => {
                void this.hide();
                item.handler?.(item, e);
                options.selectMenuItemHandler(item, e);
            }
        }), this.container);
    }

    /**
     * Puts the menu inside the element that currently has the screen to itself, and back where it
     * belongs once nothing does. A browser showing an element fullscreen paints only that element,
     * so a menu outside it would never appear.
     */
    private hostInWhateverHasTheScreen(container: HTMLElement) {
        const host = document.fullscreenElement ?? this.home;
        if (host && container.parentElement !== host) {
            host.appendChild(container);
        }
    }

    /**
     * Whether a menu is up. A host that stops a press from reaching the document, whose click
     * otherwise hides the menu, uses this to hide the menu itself.
     */
    isShown() {
        return !!this.options;
    }

    async hide() {
        const options = this.options;
        this.options = undefined;
        this.cover?.classList.remove("show");
        document.body.classList.remove("context-menu-shown");

        if (options && this.container) {
            render(null, this.container);
            options.onHide?.();
        }
    }
}

const contextMenu = new ContextMenu();

export default contextMenu;

// Bootstrap sets `aria-describedby` on a trigger while its tooltip is shown. `hide()` also clears
// the hover and focus triggers that keep the tooltip up.
function hideShownTooltips() {
    for (const trigger of document.querySelectorAll("[aria-describedby]")) {
        Tooltip.getInstance(trigger)?.hide();
    }
}
