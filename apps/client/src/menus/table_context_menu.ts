import type { CKTextEditor } from "@triliumnext/ckeditor5";

import type { CommandNames } from "../components/app_context.js";
import { t } from "../services/i18n.js";
import type { MenuItem } from "./context_menu.js";
import { getTextEditorContaining } from "./text_editor_context_menu.js";

/**
 * The table sections of the text editor's right-click menu.
 *
 * Returns `null` when the click is not on a table cell of the active text editor.
 */
export async function buildTableContextMenuSections(
    element: Element | null | undefined
): Promise<TableMenuSections | null> {
    if (!element?.closest("td, th")) {
        return null;
    }

    const editor = await getTextEditorContaining(element);
    return editor && buildTableMenuSections(editor, element);
}

/**
 * Builds the sections against a resolved editor. The selection is first moved into the clicked
 * cell (and kept when the cell is already part of it), so the enablement snapshots and the
 * executed commands agree with the cell the menu is opened on.
 */
export function buildTableMenuSections(
    editor: CKTextEditor,
    element: Element
): TableMenuSections | null {
    if (!editor.plugins.has("TableContextMenu")
            || !editor.plugins.get("TableContextMenu").syncSelectionToDomTarget(element)) {
        return null;
    }

    const commandItem = (title: string, uiIcon: string, commandName: string) => ({
        title,
        uiIcon,
        enabled: editor.commands.get(commandName)?.isEnabled === true,
        handler: () => {
            editor.execute(commandName);
            editor.editing.view.focus();
        }
    });
    const toggleItem = (title: string, uiIcon: string, commandName: string) => ({
        ...commandItem(title, uiIcon, commandName),
        trailingIcon: editor.commands.get(commandName)?.value === true ? "bx bx-check" : undefined
    });

    // The header items are one toggle under two labels, so only the one enabled for the
    // selection is shown.
    const headerItem = [
        toggleItem(t("table_context_menu.set_header_row"), "bx bx-dock-top",
            "triliumSetTableHeaderRow"),
        toggleItem(t("table_context_menu.set_header_up_to_row"), "bx bx-arrow-to-top",
            "triliumSetTableHeaderUpToRow")
    ].find((item) => item.enabled);
    const headerGroup: MenuItem<CommandNames>[] = headerItem
        ? [headerItem, { kind: "separator" }]
        : [];
    const splitItems = [
        commandItem(t("table_context_menu.split_vertically"), "bx bx-reflect-vertical",
            "splitTableCellVertically"),
        commandItem(t("table_context_menu.split_horizontally"), "bx bx-reflect-horizontal",
            "splitTableCellHorizontally")
    ];
    const unmergeItem = commandItem(t("table_context_menu.split_reset"), "bx bx-reset",
        "triliumResetTableCellSpans");
    const sortItems = [
        commandItem(t("table_context_menu.sort_ascending"), "bx bx-sort-up",
            "triliumSortTableRowsAscending"),
        commandItem(t("table_context_menu.sort_descending"), "bx bx-sort-down",
            "triliumSortTableRowsDescending")
    ];
    const selectItems = [
        commandItem(t("table_context_menu.select_row"), "bx bx-grid-horizontal", "selectTableRow"),
        commandItem(t("table_context_menu.select_column"), "bx bx-grid-vertical",
            "selectTableColumn"),
        commandItem(t("table_context_menu.select_table"), "bx bx-table", "triliumSelectTable")
    ];

    return {
        main: [
            commandItem(t("table_context_menu.insert_rows_above"),
                "bx bx-horizontal-left bx-rotate-90", "triliumInsertTableRowsAbove"),
            commandItem(t("table_context_menu.insert_rows_below"),
                "bx bx-horizontal-left bx-rotate-270", "triliumInsertTableRowsBelow"),
            { kind: "separator" },
            commandItem(t("table_context_menu.insert_columns_left"),
                "bx bx-horizontal-left", "triliumInsertTableColumnsLeft"),
            commandItem(t("table_context_menu.insert_columns_right"),
                "bx bx-horizontal-right", "triliumInsertTableColumnsRight"),
            { kind: "separator" },
            ...headerGroup,
            commandItem(t("table_context_menu.merge_cells"), "bx bx-border-outer",
                "mergeTableCells"),
            {
                title: t("table_context_menu.split_cells"),
                uiIcon: "bx bx-border-inner",
                enabled: [...splitItems, unmergeItem].some((item) => item.enabled),
                items: [...splitItems, { kind: "separator" }, unmergeItem]
            },
            commandItem(t("table_context_menu.distribute_columns"), "bx bx-move-horizontal",
                "triliumDistributeTableColumns")
        ],
        sort: {
            title: t("table_context_menu.sort"),
            uiIcon: "bx bx-sort-alt-2",
            enabled: sortItems.some((item) => item.enabled),
            items: sortItems
        },
        delete: [
            commandItem(t("table_context_menu.delete_rows"), "bx bx-trash", "removeTableRow"),
            commandItem(t("table_context_menu.delete_columns"), "bx bx-trash",
                "removeTableColumn"),
            commandItem(t("table_context_menu.delete_table"), "bx bx-trash", "triliumDeleteTable")
        ],
        select: {
            title: t("table_context_menu.select"),
            uiIcon: "bx bx-select-multiple",
            enabled: selectItems.some((item) => item.enabled),
            items: selectItems
        }
    };
}

/** The table rows of the text editor's right-click menu, in four sections. */
export interface TableMenuSections {
    /**
     * Row and column insertion sized by the selection, the header rows, merging or splitting of
     * the selected cells, and equal widths for the spanned columns. Shown above the clipboard.
     */
    main: MenuItem<CommandNames>[];
    /** Sorting of the rows by the column of the selection. Shown above the deletion rows. */
    sort: MenuItem<CommandNames>;
    /** Deletion of the spanned rows or columns, or of the table. Shown below the clipboard. */
    delete: MenuItem<CommandNames>[];
    /** Selection of the spanned rows or columns, or of the whole table. Shown below deletion. */
    select: MenuItem<CommandNames>;
}

/**
 * Whether the active text editor containing `element` holds a multi-cell table selection.
 * A caret or a plain text range inside one cell is not one.
 */
export async function hasTableCellSelection(element: Element | null | undefined): Promise<boolean> {
    if (!element) {
        return false;
    }

    const editor = await getTextEditorContaining(element);
    if (!editor?.plugins.has("TableSelection")) {
        return false;
    }

    return editor.plugins.get("TableSelection").getSelectedTableCells() !== null;
}
