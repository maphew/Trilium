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

    constructor() {
        this.$widget = $("#context-menu-container");
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

        this.$widget.toggleClass("mobile-bottom-menu", !this.options.forcePositionOnMobile);
        this.$cover?.addClass("show");
        $("body").addClass("context-menu-shown");

        this.$widget.empty();

        this.addItems(this.$widget, options.items);
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

        const $item = $("<li>")
            .addClass("dropdown-item")
            .append($link)
            .on("contextmenu", (e) => false);

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
