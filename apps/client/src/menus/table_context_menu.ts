import type { CKTextEditor } from "@triliumnext/ckeditor5";

import type { CommandNames } from "../components/app_context.js";
import { t } from "../services/i18n.js";
import type { MenuItem } from "./context_menu.js";
import { getTextEditorContaining } from "./text_editor_context_menu.js";

/**
 * The table section of the text editor's right-click menu: row and column insertion sized by the
 * selection, deletion of every spanned row or column, equal widths for the spanned columns, and
 * merging or splitting of the selected cells.
 *
 * Returns `null` when the click is not on a table cell of the active text editor.
 */
export async function buildTableContextMenuItems(
    element: Element | null | undefined
): Promise<MenuItem<CommandNames>[] | null> {
    if (!element?.closest("td, th")) {
        return null;
    }

    const editor = await getTextEditorContaining(element);
    return editor && buildTableMenuItems(editor, element);
}

/**
 * Builds the section against a resolved editor. The selection is first moved into the clicked
 * cell (and kept when the cell is already part of it), so the enablement snapshots and the
 * executed commands agree with the cell the menu is opened on.
 */
export function buildTableMenuItems(
    editor: CKTextEditor,
    element: Element
): MenuItem<CommandNames>[] | null {
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

    return [
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
        commandItem(t("table_context_menu.delete_rows"), "bx bx-trash", "removeTableRow"),
        commandItem(t("table_context_menu.delete_columns"), "bx bx-trash", "removeTableColumn"),
        { kind: "separator" },
        commandItem(t("table_context_menu.distribute_columns"), "bx bx-move-horizontal",
            "triliumDistributeTableColumns"),
        { kind: "separator" },
        commandItem(t("table_context_menu.merge_cells"), "bx bx-border-outer", "mergeTableCells"),
        {
            title: t("table_context_menu.split_cells"),
            uiIcon: "bx bx-border-inner",
            enabled: editor.commands.get("splitTableCellVertically")?.isEnabled === true
                || editor.commands.get("splitTableCellHorizontally")?.isEnabled === true,
            items: [
                commandItem(t("table_context_menu.split_vertically"), "bx bx-empty",
                    "splitTableCellVertically"),
                commandItem(t("table_context_menu.split_horizontally"), "bx bx-empty",
                    "splitTableCellHorizontally")
            ]
        }
    ];
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
