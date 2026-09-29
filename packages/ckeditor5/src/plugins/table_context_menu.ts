import {
    Command,
    MouseObserver,
    Plugin,
    Table,
    TableColumnResize,
    TableSelection,
    TableUtils
} from "ckeditor5";
import type { Editor, ModelElement, ViewDocumentMouseDownEvent } from "ckeditor5";

import { DistributeTableColumnsCommand } from "./table_distribute_columns.js";

/**
 * Editor-side support for the client's table context menu.
 *
 * Registers insert commands that honor the size of the current selection (the upstream
 * `insertTableRow*` / `insertTableColumn*` commands always insert one row or column) and
 * `triliumDistributeTableColumns`, keeps a multi-cell selection alive under a right-click, and
 * moves the selection to the cell a context menu is opened on. Merge, split and delete need no
 * counterparts here: the upstream `mergeTableCells`, `splitTableCell*` and `removeTableRow` /
 * `removeTableColumn` commands already act on the whole selection.
 */
export default class TableContextMenu extends Plugin {

    static get requires() {
        return [Table, TableColumnResize, TableSelection, TableUtils] as const;
    }

    static get pluginName() {
        return "TableContextMenu" as const;
    }

    init() {
        const editor = this.editor;

        editor.commands.add("triliumInsertTableRowsAbove",
            new TableMultiInsertCommand(editor, "above"));
        editor.commands.add("triliumInsertTableRowsBelow",
            new TableMultiInsertCommand(editor, "below"));
        editor.commands.add("triliumInsertTableColumnsLeft",
            new TableMultiInsertCommand(editor, "left"));
        editor.commands.add("triliumInsertTableColumnsRight",
            new TableMultiInsertCommand(editor, "right"));
        editor.commands.add("triliumDistributeTableColumns",
            new DistributeTableColumnsCommand(editor));

        const view = editor.editing.view;
        view.addObserver(MouseObserver);
        this.listenTo<ViewDocumentMouseDownEvent>(view.document, "mousedown", (evt, data) => {
            // Stops the caret move that would collapse a multi-cell selection before the
            // `contextmenu` event fires.
            const isRightButton = data.domEvent.button === RIGHT_MOUSE_BUTTON;
            if (isRightButton && this.isInsideCellSelection(data.domTarget)) {
                data.preventDefault();
            }
        }, { priority: "high" });
    }

    /**
     * Moves the model selection into the table cell containing `domTarget`, so commands run
     * against the cell the context menu is opened on. A target inside the current selection keeps
     * that selection. Returns `false` when the target is not in a table cell of this editor.
     */
    syncSelectionToDomTarget(domTarget: Node): boolean {
        const editor = this.editor;
        const modelCell = resolveModelCell(editor, domTarget);
        if (!modelCell) {
            return false;
        }

        const tableUtils = editor.plugins.get(TableUtils);
        const selection = editor.model.document.selection;
        if (!tableUtils.getSelectionAffectedTableCells(selection).includes(modelCell)) {
            editor.model.change((writer) => {
                writer.setSelection(writer.createPositionAt(modelCell, 0));
            });
        }

        return true;
    }

    /** Whether `domTarget` sits in one of the cells the selection covers from the outside. */
    private isInsideCellSelection(domTarget: Node): boolean {
        const editor = this.editor;
        const modelCell = resolveModelCell(editor, domTarget);
        if (!modelCell) {
            return false;
        }

        const tableUtils = editor.plugins.get(TableUtils);
        return tableUtils.getSelectedTableCells(editor.model.document.selection).includes(modelCell);
    }

}

const RIGHT_MOUSE_BUTTON = 2;

/** Where {@link TableMultiInsertCommand} inserts, relative to the rows or columns it spans. */
export type TableMultiInsertDirection = "above" | "below" | "left" | "right";

/**
 * Inserts as many rows or columns as the selection spans, next to the spanned block.
 */
export class TableMultiInsertCommand extends Command {

    private readonly direction: TableMultiInsertDirection;

    constructor(editor: Editor, direction: TableMultiInsertDirection) {
        super(editor);
        this.direction = direction;
    }

    refresh() {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const selection = this.editor.model.document.selection;
        this.isEnabled = tableUtils.getSelectionAffectedTableCells(selection).length > 0;
    }

    execute() {
        const tableUtils = this.editor.plugins.get(TableUtils);
        const selection = this.editor.model.document.selection;
        const cells = tableUtils.getSelectionAffectedTableCells(selection);
        const table = cells[0]?.findAncestor("table");
        /* v8 ignore next 3 -- defensive: disabled whenever the selection is outside a table */
        if (!table) {
            return;
        }

        if (this.direction === "above" || this.direction === "below") {
            const { first, last } = tableUtils.getRowIndexes(cells);
            const insertAbove = this.direction === "above";
            tableUtils.insertRows(table, {
                at: insertAbove ? first : last + 1,
                rows: last - first + 1,
                copyStructureFromAbove: !insertAbove
            });
        } else {
            const { first, last } = tableUtils.getColumnIndexes(cells);
            tableUtils.insertColumns(table, {
                at: this.direction === "left" ? first : last + 1,
                columns: last - first + 1
            });
        }
    }

}

/** The model `tableCell` whose rendered cell contains `domTarget`, or `null` when there is none. */
function resolveModelCell(editor: Editor, domTarget: Node): ModelElement | null {
    const domElement = domTarget instanceof Element ? domTarget : domTarget.parentElement;
    const domCell = domElement?.closest<HTMLTableCellElement>("td, th");
    if (!domCell) {
        return null;
    }

    const viewCell = editor.editing.view.domConverter.mapDomToView(domCell);
    if (!viewCell?.is("element")) {
        return null;
    }

    const modelCell = editor.editing.mapper.toModelElement(viewCell);
    return modelCell?.is("element", "tableCell") ? modelCell : null;
}

declare module "ckeditor5" {
    interface PluginsMap {
        [TableContextMenu.pluginName]: TableContextMenu;
    }

    interface CommandsMap {
        triliumInsertTableRowsAbove: TableMultiInsertCommand;
        triliumInsertTableRowsBelow: TableMultiInsertCommand;
        triliumInsertTableColumnsLeft: TableMultiInsertCommand;
        triliumInsertTableColumnsRight: TableMultiInsertCommand;
        triliumDistributeTableColumns: DistributeTableColumnsCommand;
    }
}
