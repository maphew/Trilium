import { BulkAction, promotedAttributeDefinitionParser } from "@triliumnext/commons";

import appContext from "../../../components/app_context";
import FNote from "../../../entities/fnote";
import attributes from "../../../services/attributes";
import branches from "../../../services/branches";
import { executeBulkActions } from "../../../services/bulk_action";
import froca from "../../../services/froca";
import { t } from "../../../services/i18n";
import note_create from "../../../services/note_create";
import server from "../../../services/server";
import toast from "../../../services/toast";
import { BoardColumnData, BoardViewData } from ".";
import { type BoardStatusDefinition, canStoreColumnsInDefinition } from "./columns";
import { ColumnMap } from "./data";

export default class BoardApi {

    private isRelationMode: boolean;
    statusAttribute: string;

    constructor(
        private byColumn: ColumnMap | undefined,
        public columns: string[],
        private parentNote: FNote,
        statusAttribute: string,
        private viewConfig: BoardViewData,
        private saveConfig: (newConfig: BoardViewData) => void,
        private setBranchIdToEdit: (branchId: string | undefined) => void,
        private statusDefinition?: BoardStatusDefinition
    ) {
        this.isRelationMode = statusAttribute.startsWith("~");

        if (statusAttribute.startsWith("~") || statusAttribute.startsWith("#")) {
            statusAttribute = statusAttribute.substring(1);
        }
        this.statusAttribute = statusAttribute;
    };

    async createNewItem(column: string, title: string) {
        try {
            // Create a new note as a child of the parent note
            const { note: newNote, branch: newBranch } = await note_create.createNote(this.parentNote.noteId, {
                activate: false,
                title,
                isProtected: this.parentNote.isProtected
            });

            if (newNote && newBranch) {
                await this.changeColumn(newNote.noteId, column);
            }
        } catch (error) {
            console.error("Failed to create new item:", error);
        }
    }

    async changeColumn(noteId: string, newColumn: string) {
        if (this.isRelationMode) {
            await attributes.setRelation(noteId, this.statusAttribute, newColumn);
        } else {
            await attributes.setLabel(noteId, this.statusAttribute, newColumn);
        }
    }

    async addNewColumn(columnName: string) {
        if (!columnName.trim()) {
            return;
        }

        const columns = this.viewConfig?.columns ?? [];

        // Add the new column to persisted data if it doesn't exist
        if (columns.some(col => col.value === columnName)) return false;
        this.storeColumns([ ...columns, { value: columnName } ]);
        return true;
    }

    async removeColumn(column: string) {
        // Remove the value from the notes.
        const noteIds = this.byColumn?.get(column)?.map(item => item.note.noteId) || [];

        const action: BulkAction = this.isRelationMode
            ? { name: "deleteRelation", relationName: this.statusAttribute }
            : { name: "deleteLabel", labelName: this.statusAttribute };
        await executeBulkActions(noteIds, [ action ]);
        this.storeColumns((this.viewConfig?.columns ?? []).filter(col => col.value !== column));
    }

    async renameColumn(oldValue: string, newValue: string) {
        const noteIds = this.byColumn?.get(oldValue)?.map(item => item.note.noteId) || [];

        // Change the value in the notes.
        const action: BulkAction = this.isRelationMode
            ? { name: "updateRelationTarget", relationName: this.statusAttribute, targetNoteId: newValue }
            : { name: "updateLabelValue", labelName: this.statusAttribute, labelValue: newValue };
        await executeBulkActions(noteIds, [ action ]);

        // Rename the column in the persisted data.
        this.storeColumns((this.viewConfig?.columns ?? [])
            .map(col => col.value === oldValue ? { ...col, value: newValue } : col));
    }

    reorderColumn(fromIndex: number, toIndex: number) {
        if (!this.columns || fromIndex === toIndex) return;

        const newColumns = [...this.columns];
        const [movedColumn] = newColumns.splice(fromIndex, 1);

        // Adjust toIndex after removing the element
        // When moving forward (right), the removal shifts indices left
        let adjustedToIndex = toIndex;
        if (fromIndex < toIndex) {
            adjustedToIndex = toIndex - 1;
        }

        newColumns.splice(adjustedToIndex, 0, movedColumn);

        // `columns` is derived render state and can lag behind the persisted config (it is rebuilt
        // only once the view re-renders), so anything it hasn't caught up with yet is kept at the
        // end instead of being dropped from the config.
        const missingColumns = (this.viewConfig?.columns ?? []).filter(col => !newColumns.includes(col.value));
        this.storeColumns([ ...newColumns.map(value => ({ value })), ...missingColumns ]);

        return newColumns;
    }

    /**
     * Persists a new column list, into the definition the board groups by as well as into the view
     * config — every column change funnels through here, so the two cannot drift apart.
     *
     * The config is always replaced with a fresh object instead of being edited in place: the board
     * re-renders off the identity of the config it was handed, so an in-place edit would be written
     * to disk but stay invisible until the view is re-entered.
     */
    private storeColumns(columns: BoardColumnData[]) {
        this.viewConfig = { ...this.viewConfig, columns };
        this.saveConfig(this.viewConfig);
        // Not awaited — every caller is the tail of a user gesture the board has already rendered —
        // so the failure is caught here rather than left to reject unhandled. The columns are still
        // in the view config, so the board is not wrong, only out of step with the definition.
        this.storeColumnsInDefinition(columns.map(({ value }) => value))
            .catch((e) => {
                console.error("Failed to store the board columns in the attribute definition:", e);
                toast.showError(t("board_view.column-definition-save-error"));
            });
    }

    /**
     * Writes the columns into the board's own definition, so that the same list is what the promoted
     * field offers, what the table view's dropdown offers, and what the board shows.
     *
     * Where the board has no definition of its own the write creates one — a copy of the template's,
     * which every board shares and which therefore cannot hold one board's columns. The copy keeps
     * what the original said, so a board whose Status field was promoted keeps a promoted field and
     * one that never had a field does not gain one.
     */
    private async storeColumnsInDefinition(options: string[]) {
        if (this.isRelationMode || !canStoreColumnsInDefinition(this.statusDefinition)) {
            return;
        }

        const definition = {
            ...this.statusDefinition?.definition,
            labelType: "select" as const,
            selectOptions: options
        };

        await server.put(`notes/${this.parentNote.noteId}/attribute`, {
            // Only an attribute the board owns can be updated; a definition reached through the
            // template is copied instead, which the route does when given no id.
            attributeId: this.statusDefinition?.isOwned
                ? this.statusDefinition.attribute.attributeId
                : undefined,
            type: "label",
            name: `label:${this.statusAttribute}`,
            value: promotedAttributeDefinitionParser.serialize(definition, "label"),
            // A definition that is not inheritable would not reach the notes on the board at all.
            isInheritable: this.statusDefinition?.attribute.isInheritable ?? true
        });
    }

    async insertRowAtPosition(
        column: string,
        relativeToBranchId: string,
        direction: "before" | "after") {
        const { note, branch } = await note_create.createNote(this.parentNote.noteId, {
            activate: false,
            targetBranchId: relativeToBranchId,
            target: direction,
            title: t("board_view.new-item")
        });

        if (!note || !branch) {
            throw new Error("Failed to create note");
        }

        const { noteId } = note;
        await this.changeColumn(noteId, column);
        this.startEditing(branch.branchId);

        return note;
    }

    openNote(noteId: string) {
        appContext.triggerCommand("openInPopup", { noteIdOrPath: noteId });
    }

    startEditing(branchId: string) {
        this.setBranchIdToEdit(branchId);
    }

    dismissEditingTitle() {
        this.setBranchIdToEdit(undefined);
    }

    renameCard(noteId: string, newTitle: string) {
        return server.put(`notes/${noteId}/title`, { title: newTitle.trim() });
    }

    removeFromBoard(noteId: string) {
        const note = froca.getNoteFromCache(noteId);
        if (!note) return;
        if (this.isRelationMode) {
            return attributes.removeOwnedRelationByName(note, this.statusAttribute);
        }
        return attributes.removeOwnedLabelByName(note, this.statusAttribute);
    }

    async moveWithinBoard(noteId: string, sourceBranchId: string, sourceIndex: number, targetIndex: number, sourceColumn: string, targetColumn: string) {
        const targetItems = this.byColumn?.get(targetColumn) ?? [];

        const note = froca.getNoteFromCache(noteId);
        if (!note) return;

        if (sourceColumn !== targetColumn) {
            // Moving to a different column
            await this.changeColumn(noteId, targetColumn);

            // If there are items in the target column, reorder
            if (targetItems.length > 0 && targetIndex < targetItems.length) {
                const targetBranch = targetItems[targetIndex].branch;
                await branches.moveBeforeBranch([ sourceBranchId ], targetBranch.branchId);
            }
        } else if (sourceIndex !== targetIndex) {
            // Reordering within the same column
            let targetBranchId: string | null = null;

            if (targetIndex < targetItems.length) {
                // Moving before an existing item
                const adjustedIndex = sourceIndex < targetIndex ? targetIndex : targetIndex;
                if (adjustedIndex < targetItems.length) {
                    targetBranchId = targetItems[adjustedIndex].branch.branchId;
                    if (targetBranchId) {
                        await branches.moveBeforeBranch([ sourceBranchId ], targetBranchId);
                    }
                }
            } else if (targetIndex > 0) {
                // Moving to the end - place after the last item
                const lastItem = targetItems[targetItems.length - 1];
                await branches.moveAfterBranch([ sourceBranchId ], lastItem.branch.branchId);
            }
        }
    }

}

