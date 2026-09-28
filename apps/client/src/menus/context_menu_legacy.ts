// Reference copy of the jQuery context menu from before the `Menu` rewrite. Nothing imports it.
// Delete a piece once `Menu` covers it, and the file once `Menu` reaches parity.

import { KeyboardActionNames } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { JSX } from "preact";

import note_tooltip from "../services/note_tooltip.js";
import utils from "../services/utils.js";

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
export type MenuHandler<T> = (item: MenuCommandItem<T>, e: JQuery.MouseDownEvent<HTMLElement, undefined, HTMLElement, HTMLElement>) => void;
export type ContextMenuEvent = PointerEvent | MouseEvent | JQuery.ContextMenuEvent;

class ContextMenu {
    private $widget: JQuery<HTMLElement>;
    private $cover?: JQuery<HTMLElement>;
    private options?: ContextMenuOptions<any>;
    private isMobile: boolean;
    /** Where the menu stands while nothing has the screen to itself. See {@link hostInWhateverHasTheScreen}. */
    private home: HTMLElement | null;

    constructor() {
        this.$widget = $("#context-menu-container");
        this.home = this.$widget[0]?.parentElement ?? null;
        this.isMobile = utils.isMobile();

        if (this.isMobile) {
            this.$cover = $("#context-menu-cover");
            this.$cover.on("click", () => this.hide());
        } else {
            $(document).on("click", (e) => this.hide());
        }
    }

    async show<T>(options: ContextMenuOptions<T>) {
        this.options = options;

        note_tooltip.dismissAllTooltips();
        hideShownTooltips();

        if (this.$widget.hasClass("show")) {
            // The menu is already visible. Hide the menu then open it again
            // at the new location to re-trigger the opening animation.
            await this.hide();
        }

        this.hostInWhateverHasTheScreen();

        this.$widget.toggleClass("mobile-bottom-menu", !this.options.forcePositionOnMobile);
        this.$cover?.addClass("show");
        $("body").addClass("context-menu-shown");

        this.$widget.empty();

        this.addItems(this.$widget, options.items);
    }

    /**
     * Puts the menu inside the element that currently has the screen to itself, and back where it
     * belongs once nothing does.
     *
     * A browser showing an element fullscreen draws that element and nothing else: this menu lives at
     * the end of the page, so over a map or a diagram given the screen (see `useFullscreen`) it was
     * laid out, positioned and left unpainted — a right-click that appeared to do nothing at all.
     * Moved into whatever is being shown, it is drawn as usual; it is positioned against the viewport
     * either way, so nothing about where it lands changes.
     */
    private hostInWhateverHasTheScreen() {
        const menu = this.$widget[0];
        const host = document.fullscreenElement ?? this.home;
        if (menu && host && menu.parentElement !== host) {
            host.appendChild(menu);
        }
    }

    private repositionSubmenu(submenuEl: HTMLElement) {
        const CONTEXT_MENU_PADDING = 5;

        // Reset so the natural (downward, trailing) placement is measured on every hover.
        submenuEl.classList.remove("submenu-flip-up");
        submenuEl.classList.remove("submenu-flip-start");

        const rect = submenuEl.getBoundingClientRect();
        const clientHeight = document.documentElement.clientHeight;
        const clientWidth = document.documentElement.clientWidth;
        const overflowsBottom = rect.bottom > clientHeight - CONTEXT_MENU_PADDING;
        // Only flip up if there is actually more room above the parent than below, otherwise flipping
        // would just clip the other end.
        const fitsWhenFlippedUp = rect.top - rect.height >= CONTEXT_MENU_PADDING;

        if (overflowsBottom && fitsWhenFlippedUp) {
            submenuEl.classList.add("submenu-flip-up");
        }

        // The same for the side it opens on, which is the trailing one by default and the leading
        // one in a right-to-left page. Whichever edge it runs past, the flip puts it on the other
        // side of its parent, and only where the whole submenu fits there.
        const fitsWhenFlippedToStart = rect.left - rect.width >= CONTEXT_MENU_PADDING;
        const fitsWhenFlippedToEnd = rect.right + rect.width <= clientWidth - CONTEXT_MENU_PADDING;

        if ((rect.right > clientWidth - CONTEXT_MENU_PADDING && fitsWhenFlippedToStart)
                || (rect.left < CONTEXT_MENU_PADDING && fitsWhenFlippedToEnd)) {
            submenuEl.classList.add("submenu-flip-start");
        }
    }

    addItems($parent: JQuery<HTMLElement>, items: MenuItem<any>[], multicolumn = false) {
        let $group = $parent; // The current group or parent element to which items are being appended
        let shouldStartNewGroup = false; // If true, the next item will start a new group
        let shouldResetGroup = false; // If true, the next item will be the last one from the group
        let prevItemKind: string = "";

        for (let index = 0; index < items.length; index++) {
            const item = items[index];
            const itemKind = ("kind" in item) ? item.kind : "";

            if (!item) {
                continue;
            }

            // If the current item is a header, start a new group. This group will contain the
            // header and the next item that follows the header.
            if (itemKind === "header") {
                if (multicolumn && !shouldResetGroup) {
                    shouldStartNewGroup = true;
                }
            }

            // If the next item is a separator, start a new group. This group will contain the
            // current item, the separator, and the next item after the separator.
            const nextItem = (index < items.length - 1) ? items[index + 1] : null;
            if (multicolumn && nextItem && "kind" in nextItem && nextItem.kind === "separator") {
                if (!shouldResetGroup) {
                    shouldStartNewGroup = true;
                } else {
                    shouldResetGroup = true; // Continue the current group
                }
            }

            // Create a new group to avoid column breaks before and after the seaparator / header.
            // This is a workaround for Firefox not supporting break-before / break-after: avoid
            // for columns.
            if (shouldStartNewGroup) {
                $group = $("<div class='dropdown-no-break'>");
                $parent.append($group);
                shouldStartNewGroup = false;
            }

            if (itemKind === "separator") {
                $group.append($("<div>").addClass("dropdown-divider"));
                shouldResetGroup = true; // End the group after the next item
            } else if (itemKind === "header") {
                shouldResetGroup = true;
            } else {
                $group.append(this.createMenuItem(item as MenuCommandItem<any>));

                // After adding a menu item, if the previous item was a separator or header,
                // reset the group so that the next item will be appended directly to the parent.
                if (shouldResetGroup) {
                    $group = $parent;
                    shouldResetGroup = false;
                };
            }

            prevItemKind = itemKind;

        }
    }

    private createMenuItem(item: MenuCommandItem<any>) {
        const $link = $("<span>");

        if ("badges" in item && item.badges) {
            for (const badge of item.badges) {
                const badgeElement = $(`<span class="badge">`).text(badge.title);

                if (badge.className) {
                    badgeElement.addClass(badge.className);
                }

                $link.append(badgeElement);
            }
        }

        if ("trailingIcon" in item && item.trailingIcon) {
            $link.append($("<span>")
                .addClass([ item.trailingIcon, "tn-icon", "menu-trailing-icon" ]));
        }

        const $item = $("<li>")
            .addClass("dropdown-item")
            .append($link)
            .on("contextmenu", (e) => false)
            .on("mousedown", (e) => {
                if (this.isMobile && "items" in item && item.items) {
                    const $item = $(e.target).closest(".dropdown-item");

                    $item.toggleClass("submenu-open");
                    $item.find("ul.dropdown-menu").toggleClass("show");
                    return false;
                }

                // A submenu's parent stays open so that it can still be expanded. One carrying a
                // command or handler of its own is dismissed like any other item once it has run.
                const opensSubmenu = "items" in item && !!item.items;
                const acts = ("handler" in item && !!item.handler)
                    || ("command" in item && !!item.command);
                if (!opensSubmenu || acts) {
                    this.hide();
                }

                // it's important to stop the propagation especially for sub-menus, otherwise the event
                // might be handled again by top-level menu
                return false;
            });

        if ("items" in item && item.items) {
            $item.addClass("dropdown-submenu");
            $link.addClass("dropdown-toggle");

            const $subMenu = $("<ul>").addClass("dropdown-menu");
            const hasColumns = !!item.columns && item.columns > 1;
            if (!this.isMobile && hasColumns) {
                $subMenu.css("column-count", item.columns!);
            }

            this.addItems($subMenu, item.items, hasColumns);

            $item.append($subMenu);

            // Submenus open downward by default (CSS `:hover`); flip them up when the parent item sits
            // near the bottom of the viewport, otherwise the submenu would be clipped off-screen.
            if (!this.isMobile) {
                $item.on("mouseenter", () => this.repositionSubmenu($subMenu[0]));
            }
        }
        return $item;
    }

    /**
     * Whether a menu is up. For a host that answers a press itself and so keeps it from the
     * document, whose click is what would otherwise put the menu away (see the listener bound in
     * the constructor): such a host has to know a standing menu is what its press is really for.
     */
    isShown() {
        return this.$widget.hasClass("show");
    }

    async hide() {
        this.options?.onHide?.();
        this.$widget.removeClass("show");
        this.$cover?.removeClass("show");
        $("body").removeClass("context-menu-shown");
        this.$widget.hide();
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
