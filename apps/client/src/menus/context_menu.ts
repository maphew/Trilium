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
    private readonly cover: HTMLElement | null;
    /** What `Menu` renders into while a menu is up. */
    private host?: HTMLElement;
    private options?: ContextMenuOptions<any>;
    /** See {@link dismissedByLastPress}. */
    private pressDismissed = false;

    constructor() {
        this.cover = utils.isMobile() ? document.getElementById("context-menu-cover") : null;

        // Capture phase, so that a host stopping its own presses, as the note tree does, cannot
        // keep them from here. `pointerdown` covers every button, including a Ctrl+right-click
        // that fires no `click`, and a tap on the mobile cover.
        document.addEventListener("pointerdown", (e) => {
            const outside = this.isShown && !this.host?.contains(e.target as Node);
            this.pressDismissed = outside;
            if (outside) void this.hide();
        }, true);
        // The click a dismissing press makes is handled by then, see `dismissedByLastPress`.
        document.addEventListener("click", () => {
            setTimeout(() => this.pressDismissed = false);
        }, true);
        document.addEventListener("keydown", (e) => {
            if (e.key !== "Escape" || !this.isShown) return;
            // A dialog under the menu stays open.
            e.stopPropagation();
            void this.hide();
        }, true);
    }

    async show<T>(options: ContextMenuOptions<T>) {
        note_tooltip.dismissAllTooltips();
        hideShownTooltips();

        if (this.isShown) {
            // Unmount first so the menu opens fresh at the new location.
            await this.hide();
        }

        this.options = options;
        // A browser showing an element fullscreen paints only that element, so the menu goes
        // inside it.
        this.host = document.createElement("div");
        (document.fullscreenElement ?? document.body).append(this.host);
        this.cover?.classList.add("show");
        document.body.classList.add("context-menu-shown");

        render(h(Menu<T>, {
            // The id and classes the stylesheets, themes and `floating_layers` know this menu by.
            id: "context-menu-container",
            className: "dropdown-menu-sm dropend",
            x: options.x,
            y: options.y,
            orientation: options.orientation,
            bottomSheet: utils.isMobile() && !options.forcePositionOnMobile,
            items: options.items,
            onSelect: (item, e) => {
                // A submenu's row stays up to be opened, unless it runs something of its own.
                if (!item.items || item.handler || item.command) void this.hide();
                item.handler?.(item, e);
                options.selectMenuItemHandler(item, e);
            },
            onClose: () => void this.hide()
        }), this.host);
    }

    get isShown() {
        return !!this.options;
    }

    /**
     * Whether the press behind the click being handled put a menu away. A host whose click would
     * otherwise act, such as the calendar opening an event, does nothing for it: one press, one
     * thing.
     */
    get dismissedByLastPress() {
        return this.pressDismissed;
    }

    async hide() {
        const options = this.options;
        this.options = undefined;
        this.cover?.classList.remove("show");
        document.body.classList.remove("context-menu-shown");

        if (this.host) {
            render(null, this.host);
            this.host.remove();
            this.host = undefined;
        }
        options?.onHide?.();
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
