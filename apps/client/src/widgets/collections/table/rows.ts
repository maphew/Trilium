import { extractAttributeDefinitionTypeAndName, LabelType } from "@triliumnext/commons";

import FNote from "../../../entities/fnote.js";
import froca from "../../../services/froca.js";
import type { AttributeDefinitionInformation } from "./columns.js";

export type TableData = {
    iconClass: string;
    noteId: string;
    title: string;
    labels: Record<string, boolean | string | string[] | null>;
    relations: Record<string, boolean | string | null>;
    /**
     * The relation targets' titles, keyed as `relations` is. A relation cell stores the target's
     * noteId but shows its title, and a sort compares synchronously — so the title a column sorts
     * by has to be in the row data before the table is handed it.
     */
    relationTitles: Record<string, string>;
    branchId: string;
    colorClass: string | undefined;
    isArchived: boolean;
    _children?: TableData[];
};

export async function buildRowDefinitions(parentNote: FNote, infos: AttributeDefinitionInformation[], includeArchived: boolean, maxDepth = -1, currentDepth = 0) {
    const definitions: TableData[] = [];
    const childBranches = parentNote.getChildBranches();
    let hasSubtree = false;
    let rowNumber = childBranches.length;

    if (parentNote.type === "search") {
        maxDepth = 0;
    }

    for (const branch of childBranches) {
        const note = await branch.getNote();
        if (!note || (!includeArchived && note.isArchived)) {
            continue;
        }

        const labels: typeof definitions[0]["labels"] = {};
        const relations: typeof definitions[0]["relations"] = {};
        for (const { name, type, isMulti } of infos) {
            if (type === "relation") {
                relations[name] = note.getRelationValue(name);
            } else if (isMulti) {
                // Every label of the name rather than the first, blanks dropped: the cell holds the
                // set, and an empty one is a value the field never offered.
                labels[name] = note.getLabels(name).map((label) => label.value).filter(Boolean);
            } else {
                labels[name] = note.getLabelValue(name);
            }
        }

        const def: TableData = {
            iconClass: note.getIcon(),
            noteId: note.noteId,
            title: note.title,
            labels,
            relations,
            relationTitles: {},
            isArchived: note.isArchived,
            branchId: branch.branchId,
            colorClass: note.getColorClass()
        };

        if (note.hasChildren() && (maxDepth < 0 || currentDepth < maxDepth)) {
            const { definitions, rowNumber: subRowNumber } = (await buildRowDefinitions(note, infos, includeArchived, maxDepth, currentDepth + 1));
            def._children = definitions;
            hasSubtree = true;
            rowNumber += subRowNumber;
        }

        definitions.push(def);
    }

    // Filled over the whole tree at once, from the outermost call, so the targets are fetched as
    // one batch rather than a request per row.
    if (currentDepth === 0) {
        await fillRelationTitles(definitions);
    }

    return {
        definitions,
        hasSubtree,
        rowNumber
    };
}

/**
 * Fills each row's `relationTitles` with the titles its relation cells show, loading the targets
 * as one batch. A relation can point at a note since deleted, or one the user may not see — such
 * a cell shows nothing, and sorts as nothing.
 */
async function fillRelationTitles(definitions: TableData[]) {
    const targetIds = new Set<string>();
    visitRows(definitions, ({ relations }) => {
        for (const value of Object.values(relations)) {
            if (typeof value === "string" && value) {
                targetIds.add(value);
            }
        }
    });
    if (targetIds.size === 0) {
        return;
    }

    await froca.getNotes([ ...targetIds ], true);
    visitRows(definitions, (def) => {
        for (const [ name, value ] of Object.entries(def.relations)) {
            const target = typeof value === "string" && value ? froca.getNoteFromCache(value) : undefined;
            def.relationTitles[name] = target?.title ?? "";
        }
    });
}

function visitRows(definitions: TableData[], visit: (def: TableData) => void) {
    for (const def of definitions) {
        visit(def);
        if (def._children) {
            visitRows(def._children, visit);
        }
    }
}

export default function getAttributeDefinitionInformation(parentNote: FNote) {
    const info: AttributeDefinitionInformation[] = [];
    // Nearest-wins, so a collection redefining an inherited field is described by its own definition
    // rather than by whichever of the two the scan happened to reach first.
    const attrDefs = parentNote.getAttributeDefinitions();
    for (const attrDef of attrDefs) {
        const def = attrDef.getDefinition();
        const [ attrType, name ] = extractAttributeDefinitionTypeAndName(attrDef.name);
        if (attrDef.type !== "label") {
            console.warn("Relations are not supported for now");
            continue;
        }

        let type: LabelType | "relation" = def.labelType || "text";
        if (attrType === "relation") {
            type = "relation";
        }

        const isMulti = def.multiplicity === "multi" && MULTI_VALUE_TYPES.has(type);

        info.push({
            name,
            title: def.promotedAlias,
            type,
            options: def.selectOptions,
            isMulti
        });
    }
    return info;
}

/**
 * The types a column can hold several values of, shown and edited as chips: every kind of label a
 * note can carry, since a note can carry any of them more than once and the table has no business
 * showing fewer than it holds.
 *
 * Only a relation is left out, its values being notes rather than text — a column of them is still
 * a column of one.
 */
const MULTI_VALUE_TYPES = new Set<LabelType | "relation">([
    "text", "textarea", "number", "boolean", "select", "date", "datetime", "time", "url", "email",
    "phone", "color"
]);
