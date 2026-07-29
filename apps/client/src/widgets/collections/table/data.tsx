import type { ColumnDefinition } from "tabulator-tables";
import FNote from "../../../entities/fnote";
import { useNoteLabelBoolean, useNoteLabelInt, useTriliumEvent } from "../../react/hooks";
import { useEffect, useState } from "preact/hooks";
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
            onCreateSelectOption: (columnName, option) => addSelectOption(note, columnName, option)
        });
        setColumnDefs(columnDefs);
        setRowData(rowData);
        setHasChildren(hasChildren);
        resetNewAttributePosition();
    }

    useEffect(() => { refresh() }, [ note, noteIds, maxDepth, movableRows ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults}) => {
        if (glob.device === "print") return;

        // React to column changes.
        if (loadResults.getAttributeRows().find(attr =>
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
 * The write reloads the collection, which rebuilds the columns off the definition as it now reads —
 * so nothing has to be patched in place here, unlike in the promoted grid.
 */
async function addSelectOption(parentNote: FNote, columnName: string, option: string) {
    const definitionAttr = parentNote.getAttributeDefinitions()
        .find((attr) => attr.name === `label:${columnName}`);
    if (definitionAttr) {
        await attributes.addSelectOption(definitionAttr, option);
    }
}
