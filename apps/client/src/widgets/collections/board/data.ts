import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import { resolveBoardColumns } from "./columns";
import { BoardViewData } from "./index";

export type ColumnMap = Map<string, {
    branch: FBranch;
    note: FNote;
}[]>;

/**
 * @param definitionOptions the choices the board's group-by definition offers, empty when it has no
 *                          select definition of its own to lead the column order.
 * @param pendingRenames the columns the board is in the middle of renaming or deleting, cleared
 *                       here once no source lists them any more.
 */
export async function getBoardData(
    parentNote: FNote,
    groupByColumn: string,
    persistedData: BoardViewData,
    includeArchived: boolean,
    definitionOptions: string[] = [],
    pendingRenames: Map<string, string | undefined> = new Map()
) {
    const byColumn: ColumnMap = new Map();

    // First, scan all notes to find what columns actually exist
    await recursiveGroupBy(parentNote.getChildBranches(), byColumn, groupByColumn, includeArchived, new Set<string>());

    const persistedColumns = (persistedData.columns ?? []).map(c => c.value);
    const discoveredValues = [ ...byColumn.keys() ];
    const columns = resolveBoardColumns(
        definitionOptions, persistedColumns, discoveredValues, pendingRenames);

    // A value no source lists any more has finished being renamed, and holding it back further
    // would only block a column created under the same name.
    prunePendingRenames(pendingRenames, [ definitionOptions, persistedColumns, discoveredValues ]);

    // A card the bulk action has not reached yet is still filed under the old value, and belongs to
    // the column that replaced it rather than to one `columns` no longer lists.
    regroupRenamedCards(byColumn, pendingRenames);

    // A column the notes have nothing in is still a column, so every resolved one gets an entry.
    for (const column of columns) {
        if (!byColumn.has(column)) {
            byColumn.set(column, []);
        }
    }

    // The attachment mirrors the resolved list, so a board whose columns now come from its definition
    // stays readable by anything still reading the attachment. Written only when it actually differs,
    // or every refresh would save.
    const hasChanges = persistedColumns.length !== columns.length
        || persistedColumns.some((value, index) => columns[index] !== value);

    return {
        byColumn,
        columns,
        newPersistedData: hasChanges
            ? { ...persistedData, columns: columns.map(value => ({ value })) }
            : undefined,
        isInRelationMode: groupByColumn.startsWith("~")
    };
}

/** Drops every pending rename whose old value none of the given column sources lists any more. */
function prunePendingRenames(pendingRenames: Map<string, string | undefined>, sources: string[][]) {
    for (const oldValue of [ ...pendingRenames.keys() ]) {
        if (!sources.some(source => source.includes(oldValue))) {
            pendingRenames.delete(oldValue);
        }
    }
}

/** Moves the cards of a renamed column over to its new name, keeping the order they were in. */
function regroupRenamedCards(
    byColumn: ColumnMap,
    pendingRenames: ReadonlyMap<string, string | undefined>
) {
    for (const [ oldValue, newValue ] of pendingRenames) {
        const items = byColumn.get(oldValue);
        if (!items || !newValue) continue;

        byColumn.delete(oldValue);
        byColumn.set(newValue, [ ...(byColumn.get(newValue) ?? []), ...items ]);
    }
}

async function recursiveGroupBy(branches: FBranch[], byColumn: ColumnMap, groupByColumn: string, includeArchived: boolean, seenNoteIds: Set<string>) {
    for (const branch of branches) {
        const note = await branch.getNote();
        if (!note || (!includeArchived && note.isArchived)) continue;

        if (note.type !== "search" && note.hasChildren()) {
            await recursiveGroupBy(note.getChildBranches(), byColumn, groupByColumn, includeArchived, seenNoteIds);
        }

        const group = note.getLabelOrRelation(groupByColumn);
        if (!group || seenNoteIds.has(note.noteId)) {
            continue;
        }

        if (!byColumn.has(group)) {
            byColumn.set(group, []);
        }

        byColumn.get(group)!.push({
            branch,
            note
        });
        seenNoteIds.add(note.noteId);
    }
}
