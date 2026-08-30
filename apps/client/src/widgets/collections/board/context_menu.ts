import { useState } from "preact/hooks";

import FNote from "../../../entities/fnote";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker";
import type { CommandNames } from "../../../components/app_context";
import contextMenu, { ContextMenuEvent, MenuItem } from "../../../menus/context_menu";
import link_context_menu from "../../../menus/link_context_menu";
import branches from "../../../services/branches";
import dialog from "../../../services/dialog";
import { getArchiveMenuItem } from "../../../menus/context_menu_utils";
import { t } from "../../../services/i18n";
import { escapeHtml } from "../../../services/utils";
import ColorPicker from "../../react/ColorPicker";
import Api from "./api";

/** What the column menu is opened for: the column itself, and what it can be asked to do. */
interface ColumnMenuTarget {
    value: string;
    /** The columns as drawn, in the order they stand. */
    columns: string[];
    /** Where this column stands among them. */
    index: number;
    color?: string;
    archived?: boolean;
    /** Puts the title into its inline editor, the menu being the only way there besides F2. */
    onEditTitle: () => void;
    /** Opens the column's own new-item editor, the same one its button opens. */
    onNewItem: () => void;
    /** Puts a new column on one side of this one and opens its title editor. */
    onAddColumn: (direction: "before" | "after") => void;
    /** Moves this column to sit before the given position among the columns as drawn. */
    onMoveColumn: (toIndex: number) => void;
}

export function openColumnContextMenu(api: Api, event: ContextMenuEvent, column: ColumnMenuTarget) {

    event.preventDefault();
    event.stopPropagation();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            {
                title: t("board_view.rename-column"),
                uiIcon: "bx bx-edit-alt",
                shortcut: "F2",
                handler: column.onEditTitle
            },
            { kind: "separator" },
            {
                title: t("board_view.add-new-item"),
                uiIcon: "bx bx-plus",
                handler: column.onNewItem
            },
            {
                title: t("board_view.add-existing-item"),
                uiIcon: "bx bx-link",
                async handler() {
                    const noteId = await dialog.chooseNote({
                        title: t("board_view.add-existing-item-title"),
                        okLabel: t("board_view.add-existing-item-ok")
                    });
                    if (noteId) {
                        await api.addExistingItem(column.value, noteId);
                    }
                }
            },
            {
                title: t("board_view.add-new-column"),
                uiIcon: "bx bx-columns",
                items: [
                    {
                        title: t("board_view.add-column-before"),
                        shortcut: "Ctrl+Shift+Enter",
                        handler: () => column.onAddColumn("before")
                    },
                    {
                        title: t("board_view.add-column-after"),
                        shortcut: "Ctrl+Enter",
                        handler: () => column.onAddColumn("after")
                    }
                ]
            },
            { kind: "separator" },
            {
                title: t("board_view.move-column"),
                uiIcon: "bx bx-horizontal-left",
                items: buildMoveColumnItems(api, column)
            },
            { kind: "separator" },
            column.archived
                ? {
                    title: t("board_view.unarchive-column"),
                    uiIcon: "bx bx-archive-out",
                    handler: () => api.setColumnArchived(column.value, false)
                }
                : {
                    title: t("board_view.archive-column"),
                    uiIcon: "bx bx-archive",
                    handler: () => api.setColumnArchived(column.value, true)
                },
            {
                title: t("board_view.delete-column"),
                uiIcon: "bx bx-trash",
                shortcut: "Delete",
                handler: () => api.confirmAndRemoveColumn(column.value)
            },
            { kind: "separator" },
            {
                kind: "custom",
                componentFn: () => ColumnColorPicker({ api, ...column })
            }
        ],
        selectMenuItemHandler() {}
    });
}

/**
 * Where a column can be sent, each place named by what the column would come to stand after.
 *
 * A place is left out where sending it there would leave the board as it stands: the column itself,
 * the one it already follows, and the head of the board for a column already at the head.
 */
function buildMoveColumnItems(api: Api, column: ColumnMenuTarget): MenuItem<string>[] {
    const head: MenuItem<string>[] = column.index > 0
        ? [ {
            title: t("board_view.move-column-first"),
            uiIcon: "bx bx-chevrons-left",
            handler: () => column.onMoveColumn(0)
        } ]
        : [];

    const after = column.columns.flatMap<MenuItem<string>>((name, index) => {
        if (index === column.index || index === column.index - 1) {
            return [];
        }

        return [ {
            // Boxed the way the status list boxes its names, so a long one is cut rather than
            // widening the menu. What `t()` interpolates it has already escaped.
            title: `<span class="board-column-name">`
                + `${t("board_view.move-column-after", { column: name })}</span>`,
            className: "board-column-item",
            uiIcon: api.getColumnIcon(name),
            iconColorClass: api.getColumnColorClass(name),
            badges: api.isColumnArchived(name)
                ? [ { title: t("board_view.archived-badge") } ]
                : undefined,
            // A column is placed before a position, so standing after `name` means the one past it.
            handler: () => column.onMoveColumn(index + 1)
        } ];
    });

    return [ ...head, ...after ];
}

/**
 * The colour a column is tinted with, picked the way a note's is.
 *
 * It holds the pick rather than reading it back from the board, since the menu is rendered once and
 * the board redrawing underneath does not reach it. `note-color-picker` is what the menu styles the
 * row through, so the class is worn here too.
 */
function ColumnColorPicker({ api, value, color }: { api: Api, value: string, color?: string }) {
    const [ currentColor, setCurrentColor ] = useState(color ?? null);

    return ColorPicker({
        className: "note-color-picker",
        currentValue: currentColor,
        onChange: (picked) => {
            setCurrentColor(picked);
            api.setColumnColor(value, picked);
        }
    });
}

/**
 * The columns a card can be filed under, standing in the menu itself rather than behind a submenu:
 * moving a card is what a board is for, and a submenu puts every column a step further away.
 *
 * Archived columns are offered like any other, since filing a card under one is a fair thing to
 * want; the badge is there so it is not a surprise when the card goes out of sight.
 */
function buildColumnItems(
    api: Api, note: FNote, column: string, onFocusCard: (noteId: string) => void
): MenuItem<CommandNames>[] {
    return api.columns.map((name) => ({
        // The menu reads a title as markup, which is what puts the name in a box of its own: a
        // bare run of text inside the item's flex row is an anonymous box, and nothing can be said
        // about its width. What a crafted name would plant there is escaped into the text it is
        // meant to be; every other title the board builds from a name goes through `t()`, which
        // escapes what it interpolates.
        title: `<span class="board-column-name">${escapeHtml(name)}</span>`,
        uiIcon: api.getColumnIcon(name),
        iconColorClass: api.getColumnColorClass(name),
        // The one it is already under is shown rather than hidden, so the list reads as the whole
        // set of columns and says which of them this card belongs to.
        trailingIcon: name === column ? "bx bx-check" : undefined,
        className: name === column ? "board-column-item board-current-column" : "board-column-item",
        badges: api.isColumnArchived(name)
            ? [ { title: t("board_view.archived-badge") } ]
            : undefined,
        handler: () => {
            // Asked for before the write: the card is drawn afresh under the column
            // it lands in, so the element the menu was opened from will be gone.
            onFocusCard(note.noteId);
            api.changeColumn(note.noteId, name);
        }
    }));
}

export function openNoteContextMenu(
    api: Api, event: ContextMenuEvent, note: FNote, branchId: string, column: string,
    /** Puts focus back on the card once a change of column has drawn it under another one. */
    onFocusCard: (noteId: string) => void
) {
    event.preventDefault();
    event.stopPropagation();

    contextMenu.show({
        x: event.pageX,
        y: event.pageY,
        items: [
            ...link_context_menu.getItems(event),
            { kind: "separator" },
            {
                title: t("board_view.insert-above"),
                uiIcon: "bx bx-list-plus",
                shortcut: "Shift+Enter",
                handler: () => api.insertRowAtPosition(column, branchId, "before")
            },
            {
                title: t("board_view.insert-below"),
                uiIcon: "bx bx-empty",
                shortcut: "Enter",
                handler: () => api.insertRowAtPosition(column, branchId, "after")
            },
            { kind: "header", title: api.getStatusLabel() },
            ...buildColumnItems(api, note, column, onFocusCard),
            { kind: "separator" },
            {
                title: t("board_view.duplicate-item"),
                uiIcon: "bx bx-outline",
                handler: () => api.duplicateItem(note.noteId, branchId)
            },
            { kind: "separator" },
            getArchiveMenuItem(note),
            {
                title: t("board_view.remove-from-board"),
                uiIcon: "bx bx-task-x",
                shortcut: "Delete",
                handler: () => api.removeFromBoard(note.noteId)
            },
            {
                title: t("board_view.delete-note"),
                uiIcon: "bx bx-trash",
                shortcut: "Shift+Delete",
                handler: () => branches.deleteNotes([ branchId ], false, false)
            },
            { kind: "separator" },
            {
                kind: "custom",
                componentFn: () => NoteColorPicker({note})
            }
        ],
        selectMenuItemHandler: ({ command }) =>  link_context_menu.handleLinkContextMenuItem(command, event, note.noteId),
    });
}

