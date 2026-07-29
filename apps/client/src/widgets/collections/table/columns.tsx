import "./columns.css";

import { LabelType } from "@triliumnext/commons";
import clsx from "clsx";
import { JSX } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import type { CellComponent, ColumnDefinition, EmptyCallback, FormatterParams, RowComponent, ValueBooleanCallback, ValueVoidCallback } from "tabulator-tables";

import froca from "../../../services/froca.js";
import { t } from "../../../services/i18n.js";
import { formatDateNumeric } from "../../../utils/formatters.js";
import LabelValueInput from "../../attribute_widgets/label_value_input.jsx";
import { SelectValuesInput } from "../../attribute_widgets/select_input.jsx";
import Icon from "../../react/Icon.jsx";
import NoteAutocomplete from "../../react/NoteAutocomplete.jsx";
import { renderReactWidget } from "../../react/react_utils.jsx";
import { useGrowsUpwards } from "./grows_upwards.js";

type ColumnType = LabelType | "relation";

export interface AttributeDefinitionInformation {
    name: string;
    title?: string;
    type?: ColumnType;
    /** The values a `select` column offers, from the definition that declared it. */
    options?: string[];
    /** Whether the column holds a set of values rather than one, which only a `select` may. */
    isMulti?: boolean;
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
    select: {
        // The options come from the column's definition, so `editorParams` is attached per column
        // in `buildColumnDefinitions` rather than here.
        editor: wrapEditor(SelectEditor)
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
        // No `format` param, so the editor stays on the stored "HH:mm" and needs no luxon — the same
        // value, through the same native field, as the promoted attribute of this type.
        editor: "time"
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
    /**
     * Adds an option to a select column's definition, for the entry its editor offers on a value
     * the column does not list yet. Omitted, such a value cannot be created from a cell.
     */
    onCreateSelectOption?: (columnName: string, option: string) => void | Promise<void>;
    /**
     * The options a select column offers, asked for as a cell is opened. A definition can gain an
     * option from the very editor that is open, which the columns as built know nothing about — so
     * where this is left out, or answers nothing, a cell falls back to the options it was built with.
     */
    currentSelectOptions?: (columnName: string) => string[] | undefined;
}

export function buildColumnDefinitions({ info, movableRows, existingColumnData, rowNumberHint, position, onCreateSelectOption, currentSelectOptions }: BuildColumnArgs) {
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
    for (const { name, title, type, options, isMulti } of info) {
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
            // A select's options come from its own definition, so they attach per column. Handed as
            // a function because that is the shape Tabulator types for params of an editor's own —
            // which also means the options are answered for as each cell is opened, late enough to
            // include one the definition has just been given.
            ...(type === "select" && {
                editorParams: (): Record<string, unknown> => ({
                    options: currentSelectOptions?.(name) ?? options ?? [],
                    isMulti,
                    onCreateOption: onCreateSelectOption
                        && ((option: string) => onCreateSelectOption(name, option))
                } satisfies SelectEditorParams)
            }),
            // A set is shown as the chips it is edited as, and sorted by the values it holds rather
            // than by the array Tabulator would otherwise compare as an object.
            ...(type === "select" && isMulti && {
                formatter: wrapFormatter(SelectValuesFormatter),
                sorter: (a, b) => joinValues(a).localeCompare(joinValues(b))
            })
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

/**
 * A select cell is edited through the very field the promoted-attribute grid offers, so a column and
 * the note's own field behave alike — the options listed on opening, typing filtering them, and an
 * unlisted value offered as one to create.
 *
 * The field is focused from the wrapper because it is reached through {@link LabelValueInput}, which
 * hands no reference to the box it builds; the list then opens as it does for any focused combobox.
 */
function SelectEditor({ cell, success, editorParams }: EditorOpts) {
    const { options, isMulti, onCreateOption } = editorParams as SelectEditorParams;
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => containerRef.current?.querySelector("input")?.focus(), []);
    // The set as it stands while the cell is open. Reporting each chip as it is taken would close the
    // editor on the first one — `success` is Tabulator's "the edit is done" — so the set is held here
    // and handed over once, when the field is left. A ref beside it because the handler below is
    // bound once and would otherwise report the set the editor opened with.
    const [ values, setValues ] = useState<string[]>(() => asValues(cell.getValue()));
    const editedValues = useRef(values);
    editedValues.current = values;

    useEffect(() => {
        const editor = containerRef.current;
        if (!isMulti || !editor) return;

        const onFocusOut = (e: FocusEvent) => {
            // Focus moving within the editor — the box to a chip's remove button, or back — is not
            // leaving it. Picking from the list does not blur at all: the list keeps the focus in
            // the box, which is what lets it stay open across picks.
            if (e.relatedTarget instanceof Node && editor.contains(e.relatedTarget)) return;
            success(editedValues.current);
        };

        editor.addEventListener("focusout", onFocusOut);
        return () => editor.removeEventListener("focusout", onFocusOut);
    }, [ isMulti, success ]);

    // The editor grows downwards as chips are taken, which the pane the table scrolls in cuts off at
    // its foot — on the last row there is nothing below the cell to grow into.
    const growsUpwards = useGrowsUpwards(containerRef);

    return (
        <div ref={containerRef} className={clsx("table-select-editor", growsUpwards && "grows-upwards")}>
            {isMulti ? (
                <SelectValuesInput
                    options={options}
                    values={values}
                    placeholder={t("promoted_attributes.select_values_placeholder")}
                    onCreateOption={onCreateOption}
                    onCommit={setValues}
                />
            ) : (
                <LabelValueInput
                    labelType="select"
                    value={cell.getValue() ?? ""}
                    selectOptions={options}
                    onCommit={success}
                    onCreateOption={onCreateOption}
                />
            )}
        </div>
    );
}

/** A multi-valued cell as the chips it is edited as, so reading and editing show the same set. */
function SelectValuesFormatter({ cell }: FormatterOpts) {
    return (
        <span className="table-select-values">
            {asValues(cell.getValue()).map((value) => (
                <span key={value} className="tn-chip">{value}</span>
            ))}
        </span>
    );
}

/**
 * A multi-valued cell's values. Stored as an array, but a cell can hold what an older single-valued
 * definition left behind, or nothing at all, so anything else is read as the set it stands for.
 */
function asValues(value: unknown): string[] {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    return typeof value === "string" && value ? [ value ] : [];
}

/** The values as one string, for comparing two sets in a sort. */
function joinValues(value: unknown) {
    return asValues(value).join(", ");
}

/**
 * What a select column hands its editor: the options it offers, whether it holds a set of them, and
 * how to add one. A type rather than an interface so that it still reads as the loose record
 * Tabulator types params as.
 */
export type SelectEditorParams = {
    options: string[];
    isMulti?: boolean;
    /** Absent where the definition cannot be written to, which leaves the field a plain picker. */
    onCreateOption?: (option: string) => void | Promise<void>;
};

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
