// Reference copy of the jQuery context menu from before the `Menu` rewrite. Nothing imports it.
// Delete a piece once `Menu` covers it, and the file once `Menu` reaches parity.

import { KeyboardActionNames } from "@triliumnext/commons";
import { Tooltip } from "bootstrap";
import { JSX } from "preact";

import note_tooltip from "../services/note_tooltip.js";

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
    private options?: ContextMenuOptions<any>;

    constructor() {
        this.$widget = $("#context-menu-container");
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

        $("body").addClass("context-menu-shown");

        this.$widget.empty();

        this.addItems(this.$widget, options.items);
    }

    addItems($parent: JQuery<HTMLElement>, items: MenuItem<any>[]) {
        for (const item of items) {
            if (!("kind" in item)) $parent.append(this.createMenuItem(item));
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
