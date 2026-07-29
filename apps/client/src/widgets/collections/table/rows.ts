import { extractAttributeDefinitionTypeAndName, LabelType } from "@triliumnext/commons";

import FNote from "../../../entities/fnote.js";
import type { AttributeDefinitionInformation } from "./columns.js";

export type TableData = {
    iconClass: string;
    noteId: string;
    title: string;
    labels: Record<string, boolean | string | string[] | null>;
    relations: Record<string, boolean | string | null>;
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

    return {
        definitions,
        hasSubtree,
        rowNumber
    };
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
 * The types a column can hold several values of, shown and edited as chips.
 *
 * The two left out are the ones a set says nothing for: a flag means what it means by being there at
 * all, so several of them are the same one flag; and a colour is a single quality of the thing it
 * describes. A column of either shows the first value it finds, as it did before it was declared to
 * hold many — better a value than a column that quietly goes missing.
 */
const MULTI_VALUE_TYPES = new Set<LabelType | "relation">([
    "text", "textarea", "number", "select", "date", "datetime", "time", "url", "email", "phone"
]);
