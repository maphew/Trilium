import type { ColumnDefinition } from "tabulator-tables";
import FNote from "../../../entities/fnote";
import { useNoteLabelBoolean, useNoteLabelInt, useTriliumEvent } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import { useContext, useEffect, useState } from "preact/hooks";
import getAttributeDefinitionInformation, { buildRowDefinitions, TableData } from "./rows";
import froca from "../../../services/froca";
import { buildColumnDefinitions } from "./columns";
import attributes from "../../../services/attributes";
import { RefObject } from "preact";

export interface TableConfig {
    tableData: {
        columns?: ColumnDefinition[];
    };
}

export default function useData(note: FNote, noteIds: string[], viewConfig: TableConfig | undefined, newAttributePosition: RefObject<number | undefined> | undefined, resetNewAttributePosition: () => void) {
    const [ maxDepth ] = useNoteLabelInt(note, "maxNestingDepth");
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    // Whose writes these are, so that the table can tell a definition it changed itself from one
    // changed elsewhere — rebuilding for its own would pull the open editor out from under the user.
    const componentId = useContext(ParentComponent)?.componentId;

    const [ columnDefs, setColumnDefs ] = useState<ColumnDefinition[]>();
    const [ rowData, setRowData ] = useState<TableData[]>();
    const [ hasChildren, setHasChildren ] = useState<boolean>();
    const [ isSorted ] = useNoteLabelBoolean(note, "sorted");
    const [ movableRows, setMovableRows ] = useState(false);

    async function refresh() {
        const info = getAttributeDefinitionInformation(note);

        // Ensure all note IDs are loaded.
        await froca.getNotes(noteIds);

        const { definitions: rowData, hasSubtree: hasChildren, rowNumber } = await buildRowDefinitions(note, info, includeArchived, maxDepth);
        const columnDefs = buildColumnDefinitions({
            info,
            movableRows,
            existingColumnData: viewConfig?.tableData?.columns,
            rowNumberHint: rowNumber,
            position: newAttributePosition?.current ?? undefined,
            // Read from the note as a cell is opened rather than taken from `info`, which was read
            // when the columns were last built: a definition can gain an option from the very editor
            // that is open, and the table does not rebuild for a change of its own.
            currentSelectOptions: (columnName) => getAttributeDefinitionInformation(note)
                .find((definition) => definition.name === columnName)?.options,
            onCreateSelectOption: (columnName, option) => addSelectOption(note, columnName, option, componentId)
        });
        setColumnDefs(columnDefs);
        setRowData(rowData);
        setHasChildren(hasChildren);
        resetNewAttributePosition();
    }

    useEffect(() => { refresh() }, [ note, noteIds, maxDepth, movableRows ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults}) => {
        if (glob.device === "print") return;

        // React to column changes, barring those this table made itself: rebuilding the columns
        // replaces them wholesale, which takes down the editor that asked for the change — losing,
        // in a multi-valued cell, the values gathered but not yet handed over.
        if (loadResults.getAttributeRows(componentId).find(attr =>
            attr.type === "label" &&
            (attr.name?.startsWith("label:") || attr.name?.startsWith("relation:")) &&
            attributes.isAffecting(attr, note))) {
            refresh();
            return;
        }

        // React to external row updates.
        if (loadResults.getBranchRows().some(branch => branch.parentNoteId === note.noteId || noteIds.includes(branch.parentNoteId ?? ""))
            || loadResults.getNoteIds().some(noteId => noteIds.includes(noteId))
            || loadResults.getAttributeRows().some(attr => noteIds.includes(attr.noteId!))
            || loadResults.getAttributeRows().some(attr => attr.name === "archived" && attr.noteId && noteIds.includes(attr.noteId))) {
            refresh();
            return;
        }
    });

    // Identify if movable rows.
    useEffect(() => {
        setMovableRows(!isSorted && note.type !== "search" && !hasChildren);
    }, [ isSorted, note, hasChildren ]);

    return { columnDefs, rowData, movableRows, hasChildren };
}

/**
 * Adds an option to the definition a select column reads from, for the entry its editor offers on a
 * value the column does not list yet. The definition is looked up as the columns themselves are, so
 * an inherited one is written where it lives and the option reaches every note the field covers.
 *
 * Stamped with the table's own component id, so that the reload it causes does not rebuild the
 * columns underneath the editor that asked for it. The option still reaches the cache, which is
 * where a cell being opened reads the choices it offers.
 */
async function addSelectOption(parentNote: FNote, columnName: string, option: string, componentId?: string) {
    const definitionAttr = parentNote.getAttributeDefinitions()
        .find((attr) => attr.name === `label:${columnName}`);
    if (definitionAttr) {
        await attributes.addSelectOption(definitionAttr, option, componentId);
    }
}
