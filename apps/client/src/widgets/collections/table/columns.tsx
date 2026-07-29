import { LabelType } from "@triliumnext/commons";
import { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { CellComponent, ColumnDefinition, EmptyCallback, FormatterParams, RowComponent, ValueBooleanCallback, ValueVoidCallback } from "tabulator-tables";

import froca from "../../../services/froca.js";
import { formatDateNumeric } from "../../../utils/formatters.js";
import Icon from "../../react/Icon.jsx";
import NoteAutocomplete from "../../react/NoteAutocomplete.jsx";
import { renderReactWidget } from "../../react/react_utils.jsx";

type ColumnType = LabelType | "relation";

export interface AttributeDefinitionInformation {
    name: string;
    title?: string;
    type?: ColumnType;
}

const labelTypeMappings: Record<ColumnType, Partial<ColumnDefinition>> = {
    text: {
        editor: "input"
    },
    textarea: {
        editor: "textarea",
        formatter: "textarea",
        editorParams: {
            shiftEnterSubmit: true
        }
    },
    boolean: {
        formatter: "tickCross",
        editor: "tickCross",
        // Values arrive as strings ("true"/"false") from stored labels but as real booleans
        // once toggled via the editor; the boolean sorter normalizes both, whereas the default
        // string sorter treats boolean `false` as empty and orders it inconsistently.
        sorter: "boolean"
    },
    date: {
        editor: "date",
        // Values are stored as ISO ("YYYY-MM-DD"), which Tabulator would otherwise render as-is.
        formatter: (cell) => formatLabelDate(cell.getValue(), false)
    },
    datetime: {
        editor: "datetime",
        formatter: (cell) => formatLabelDate(cell.getValue(), true)
    },
    number: {
        editor: "number",
        sorter: "number"
    },
    time: {
        editor: "input"
    },
    url: {
        formatter: "link",
        editor: "input"
    },
    email: {
        // The stored value is the bare address; the link formatter's url callback gives it its
        // scheme without repeating one an older value (imported as a url) may already carry.
        formatter: "link",
        formatterParams: {
            url: (cell) => applyLinkScheme(cell.getValue(), "mailto:")
        },
        editor: "input"
    },
    phone: {
        formatter: "link",
        formatterParams: {
            url: (cell) => applyLinkScheme(cell.getValue(), "tel:")
        },
        editor: "input"
    },
    color: {
        editor: "input",
        formatter: "color",
        editorParams: {
            elementAttributes: {
                type: "color"
            }
        }
    },
    relation: {
        editor: wrapEditor(RelationEditor),
        formatter: wrapFormatter(NoteFormatter)
    }
};

/** Gives an email/phone value its clickable scheme unless it (an older value, stored as a url) already carries it. */
function applyLinkScheme(value: unknown, scheme: string): string {
    if (typeof value !== "string" || !value) return "";
    return value.startsWith(scheme) ? value : `${scheme}${value}`;
}

/**
 * Renders a stored date label through the user's formatting locale, all-numeric so that columns stay
 * narrow and every locale shows a four-digit year.
 *
 * Unparseable values are echoed back rather than formatted: label values are free text, so a
 * date-typed column can hold anything a user typed, imported, or left behind by retyping a text
 * label as a date. `Intl.DateTimeFormat` throws a `RangeError` on an invalid date, and since this
 * runs inside a Tabulator formatter, that would take down the whole grid rather than one cell.
 */
export function formatLabelDate(value: unknown, withTime: boolean) {
    if (typeof value !== "string" || !value) return "";
    // Passed as a string so that formatDateNumeric() keeps its date-only ("YYYY-MM-DD") handling,
    // which pins the value to the local calendar day instead of shifting it across timezones.
    if (Number.isNaN(new Date(value).getTime())) return value;
    return formatDateNumeric(value, withTime);
}

interface BuildColumnArgs {
    info: AttributeDefinitionInformation[];
    movableRows: boolean;
    existingColumnData: ColumnDefinition[] | undefined;
    rowNumberHint: number;
    position?: number;
}

export function buildColumnDefinitions({ info, movableRows, existingColumnData, rowNumberHint, position }: BuildColumnArgs) {
    let columnDefs: ColumnDefinition[] = [
        {
            title: "#",
            headerSort: false,
            hozAlign: "center",
            resizable: false,
            frozen: true,
            rowHandle: movableRows,
            width: calculateIndexColumnWidth(rowNumberHint, movableRows),
            formatter: (cell) => rowNumberFormatter(cell, movableRows)
        },
        {
            field: "noteId",
            title: "Note ID",
            formatter: wrapFormatter(({ cell }) => <code>{cell.getValue()}</code>),
            visible: false
        },
        {
            field: "title",
            title: "Title",
            editor: "input",
            formatter: wrapFormatter(({ cell }) => {
                const { noteId, iconClass, colorClass } = cell.getRow().getData();
                return <span className={`reference-link ${colorClass}`} data-href={`#root/${noteId}`}>
                    <Icon icon={iconClass} />{" "}{cell.getValue()}
                </span>;
            }),
            width: 400
        }
    ];

    const seenFields = new Set<string>();
    for (const { name, title, type } of info) {
        const prefix = (type === "relation" ? "relations" : "labels");
        const field = `${prefix}.${name}`;

        if (seenFields.has(field)) {
            continue;
        }

        columnDefs.push({
            field,
            title: title ?? name,
            editor: "input",
            rowHandle: false,
            ...labelTypeMappings[type ?? "text"],
        });
        seenFields.add(field);
    }

    if (existingColumnData) {
        columnDefs = restoreExistingData(columnDefs, existingColumnData, position);
    }

    return columnDefs;
}

export function restoreExistingData(newDefs: ColumnDefinition[], oldDefs: ColumnDefinition[], position?: number) {
    // 1. Keep existing columns, but restore their properties like width, visibility and order.
    const newItemsByField = new Map<string, ColumnDefinition>(
        newDefs.map(def => [def.field!, def])
    );
    const existingColumns = oldDefs
        .filter(item => (item.field && newItemsByField.has(item.field!)) || item.title === "#")
        .map(oldItem => {
            const data = newItemsByField.get(oldItem.field!)!;
            if (oldItem.resizable !== false && oldItem.width !== undefined) {
                data.width = oldItem.width;
            }
            if (oldItem.visible !== undefined) {
                data.visible = oldItem.visible;
            }
            return data;
        }) as ColumnDefinition[];

    // 2. Determine new columns.
    const existingFields = new Set(existingColumns.map(item => item.field));
    const newColumns = newDefs
        .filter(item => !existingFields.has(item.field!));

    // Clamp position to a valid range
    const insertPos = position !== undefined
        ? Math.min(Math.max(position, 0), existingColumns.length)
        : existingColumns.length;

    // 3. Insert new columns at the specified position
    return [
        ...existingColumns.slice(0, insertPos),
        ...newColumns,
        ...existingColumns.slice(insertPos)
    ];
}

function calculateIndexColumnWidth(rowNumberHint: number, movableRows: boolean): number {
    let columnWidth = 16 * (rowNumberHint.toString().length || 1);
    if (movableRows) {
        columnWidth += 32;
    }
    return columnWidth;
}

// `watchPosition` is provided by Tabulator but missing from the current type definitions.
type RowComponentWithPositionWatch = RowComponent & {
    watchPosition(callback: (position: number) => void): void;
};

function rowNumberFormatter(cell: CellComponent, movableRows: boolean): HTMLElement {
    const container = document.createElement("div");

    if (movableRows) {
        const handle = document.createElement("span");
        handle.className = "bx bx-dots-vertical-rounded";
        container.append(handle, " ");
    }

    const number = document.createElement("span");
    container.append(number);

    // The row-number column has no field, so Tabulator never re-runs its formatter when the
    // rows are re-sorted or reordered, leaving stale numbers (see #10347). Watching the row
    // position keeps the displayed number in sync, mirroring Tabulator's built-in "rownum".
    const row = cell.getRow() as RowComponentWithPositionWatch;
    const currentPosition = row.getPosition();
    if (currentPosition) {
        number.innerText = String(currentPosition);
    }
    row.watchPosition((position) => {
        number.innerText = String(position);
    });

    return container;
}

interface FormatterOpts {
    cell: CellComponent
    formatterParams: FormatterParams;
}

interface EditorOpts {
    cell: CellComponent,
    success: ValueBooleanCallback,
    cancel: ValueVoidCallback,
    editorParams: {}
}

function wrapFormatter(Component: (opts: FormatterOpts) => JSX.Element): ((cell: CellComponent, formatterParams: {}, onRendered: EmptyCallback) => string | HTMLElement) {
    return (cell, formatterParams, onRendered) => {
        const elWithParams = <Component cell={cell} formatterParams={formatterParams} />;
        return renderReactWidget(null, elWithParams)[0];
    };
}

function wrapEditor(Component: (opts: EditorOpts) => JSX.Element): ((
    cell: CellComponent,
    onRendered: EmptyCallback,
    success: ValueBooleanCallback,
    cancel: ValueVoidCallback,
    editorParams: {},
) => HTMLElement | false) {
    return (cell, _, success, cancel, editorParams) => {
        const elWithParams = <Component cell={cell} success={success} cancel={cancel} editorParams={editorParams} />;
        return renderReactWidget(null, elWithParams)[0];
    };
}

function NoteFormatter({ cell }: FormatterOpts) {
    const noteId = cell.getValue();
    const [ note, setNote ] = useState(noteId ? froca.getNoteFromCache(noteId) : null);

    useEffect(() => {
        if (!noteId || note?.noteId === noteId) return;
        froca.getNote(noteId).then(setNote);
    }, [ noteId ]);

    return <span className={`reference-link ${note?.getColorClass()}`} data-href={`#root/${noteId}`}>
        {note && <><Icon icon={note?.getIcon()} />{" "}{note.title}</>}
    </span>;
}

function RelationEditor({ cell, success }: EditorOpts) {
    const inputRef = useRef<HTMLInputElement>(null);
    useEffect(() => inputRef.current?.focus());

    return <NoteAutocomplete
        inputRef={inputRef}
        noteId={cell.getValue()}
        opts={{
            allowCreatingNotes: true,
            hideAllButtons: true
        }}
        noteIdChanged={success}
    />;
}
