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
import ValuesInput from "../../attribute_widgets/values_input.jsx";
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
    /** Whether the column holds a set of values rather than one, shown and edited as chips. */
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
        editor: wrapEditor(ColorEditor),
        formatter: wrapFormatter(ColorFormatter)
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
            // What a cell's editor needs beyond the value itself, which for a select is the options
            // it offers. Handed as a function because that is the shape Tabulator types for params
            // of an editor's own — which also means the options are answered for as each cell is
            // opened, late enough to include one the definition has just been given.
            ...((type === "select" || isMulti) && {
                editorParams: (): Record<string, unknown> => ({
                    labelType: type ?? "text",
                    options: currentSelectOptions?.(name) ?? options ?? [],
                    isMulti,
                    onCreateOption: onCreateSelectOption
                        && ((option: string) => onCreateSelectOption(name, option))
                } satisfies ValuesEditorParams)
            }),
            // A set is shown as the chips it is edited as, whatever it holds — and sorted by those
            // values rather than by the array Tabulator would otherwise compare as an object.
            ...(isMulti && {
                editor: wrapEditor(ValuesEditor),
                formatter: wrapFormatter(ValuesFormatter),
                formatterParams: { type: type ?? "text" },
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
    const { options, onCreateOption } = editorParams as ValuesEditorParams;
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => containerRef.current?.querySelector("input")?.focus(), []);

    return (
        <div ref={containerRef} className="table-values-editor">
            <LabelValueInput
                labelType="select"
                value={cell.getValue() ?? ""}
                selectOptions={options}
                onCommit={success}
                onCreateOption={onCreateOption}
            />
        </div>
    );
}

/**
 * A cell holding several values is edited as the chips it shows: a select picks them from its
 * options, anything else takes what is typed. Either way the set is what is being edited, so the two
 * share everything around the field — how the set is gathered, and when it is handed over.
 *
 * Reporting a value as it is taken would close the editor on the first one — reporting is Tabulator's
 * "the edit is done" — so the set is held here and handed over once, when the cell is left.
 */
function ValuesEditor({ cell, success, editorParams }: EditorOpts) {
    const { labelType, options, onCreateOption } = editorParams as ValuesEditorParams;
    const containerRef = useRef<HTMLDivElement>(null);
    useEffect(() => containerRef.current?.querySelector("input")?.focus(), []);

    const [ values, setValues ] = useState<string[]>(() => asValues(cell.getValue()));
    // The set as the handler below will read it. Written as the edit is made rather than left to the
    // next render, because leaving the field both takes what was typed and ends the edit — in that
    // order, and within the one event, which a value only reachable through a render would miss.
    const editedValues = useRef(values);
    function editValues(edited: string[]) {
        editedValues.current = edited;
        setValues(edited);
    }

    useEffect(() => {
        const editor = containerRef.current;
        if (!editor) return;

        const onFocusOut = (e: FocusEvent) => {
            // Focus moving within the editor — the box to a chip's remove button, or back — is not
            // leaving it. Picking from a list does not blur at all: the list keeps the focus in the
            // box, which is what lets it stay open across picks.
            if (e.relatedTarget instanceof Node && editor.contains(e.relatedTarget)) return;

            // Nothing in the page took the focus over, and either the editor still holds it or the
            // window itself has lost it — which is what opening a native picker's dialog does. The
            // cell has not been left, and ending the edit here would take the dialog down with it
            // before it could report the colour picked.
            if (!e.relatedTarget && (!document.hasFocus() || editor.contains(document.activeElement))) {
                return;
            }

            success(editedValues.current);
        };

        editor.addEventListener("focusout", onFocusOut);
        return () => editor.removeEventListener("focusout", onFocusOut);
    }, [ success ]);

    // The editor grows downwards as values are taken, which the pane the table scrolls in cuts off at
    // its foot — on the last row there is nothing below the cell to grow into.
    const growsUpwards = useGrowsUpwards(containerRef);

    return (
        <div ref={containerRef} className={clsx("table-values-editor", growsUpwards && "grows-upwards")}>
            {/* A flag is picked from a closed set as a select is — its set is simply the two values
                a flag has — so the two are gathered through the same field. */}
            {labelType === "select" || labelType === "boolean" ? (
                <SelectValuesInput
                    options={labelType === "boolean" ? BOOLEAN_OPTIONS : options}
                    values={values}
                    placeholder={t("promoted_attributes.select_values_placeholder")}
                    onCreateOption={labelType === "boolean" ? undefined : onCreateOption}
                    renderValue={labelType === "boolean" ? renderFlag : undefined}
                    onCommit={editValues}
                />
            ) : (
                <ValuesInput
                    labelType={labelType === "relation" ? "text" : labelType}
                    values={values}
                    placeholder={t("promoted_attributes.values_placeholder")}
                    // A colour reads as its swatch even while being edited, `#3d5a80` naming nothing
                    // to the eye. The rest show what is stored, which is what is being edited.
                    renderValue={labelType === "color" ? (value) => <ColorSwatch color={value} /> : undefined}
                    onCommit={editValues}
                />
            )}
        </div>
    );
}

/** A multi-valued cell as the chips it is edited as, so reading and editing show the same set. */
function ValuesFormatter({ cell, formatterParams }: FormatterOpts) {
    const { type } = formatterParams as { type?: ColumnType };
    return (
        <span className="table-values">
            {asValues(cell.getValue()).map((value) => (
                <span key={value} className="tn-chip"><span>{renderValue(value, type)}</span></span>
            ))}
        </span>
    );
}

/** The schemes that make a value of a link-like type clickable; a url carries its own. */
const LINK_SCHEMES: Partial<Record<ColumnType, string>> = { url: "", email: "mailto:", phone: "tel:" };

/** The whole of what a flag can be, which is what a column of flags picks its values from. */
const BOOLEAN_OPTIONS = [ "true", "false" ];

/**
 * One value of a set, read as its type reads it — so that a set of dates is as legible as a single
 * one, and a set of addresses is as clickable. Anything else is the value as stored.
 */
function renderValue(value: string, type: ColumnType | undefined) {
    if (type === "date" || type === "datetime") {
        return formatLabelDate(value, type === "datetime");
    }

    if (type === "color") {
        return <ColorSwatch color={value} />;
    }

    if (type === "boolean") {
        return renderFlag(value);
    }

    const scheme = type && LINK_SCHEMES[type];
    return scheme !== undefined
        ? <a href={applyLinkScheme(value, scheme)}>{value}</a>
        : value;
}

/**
 * A flag as the mark a column of single flags shows, so that a cell holding several reads the same
 * way as one holding the one. The stored text is kept in the tooltip, a value that is neither of the
 * two being a thing worth being able to see.
 */
function renderFlag(value: string) {
    return <Icon
        className={value === "true" ? "table-flag-set" : "table-flag-unset"}
        icon={value === "true" ? "bx bx-check" : "bx bx-x"}
        title={value}
    />;
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
 * What a column hands its editor beyond the value: the kind of value it holds, and — a select being
 * the one type whose values are a closed set — the options it offers and how to add one. A type
 * rather than an interface so that it still reads as the loose record Tabulator types params as.
 */
export type ValuesEditorParams = {
    labelType: ColumnType;
    options: string[];
    isMulti?: boolean;
    /** Absent where the definition cannot be written to, which leaves the field a plain picker. */
    onCreateOption?: (option: string) => void | Promise<void>;
};

/**
 * A colour cell is edited through the very field the promoted grid and the attribute editor offer: a
 * picker, and beside it the button that empties it. A bare colour input cannot be emptied — it has no
 * such value — so a cell opened by accident used to fall to black, with no way back to unset.
 *
 * The colour is taken from the picker's own `change` rather than through the field's commit, which a
 * colour input fires at every step of a drag through it: reporting is Tabulator's "the edit is done",
 * so the first step would tear the editor out from under the open picker. `change` comes once, when
 * the pick is settled, which is also when a cell is finished with.
 *
 * The picker is reached through the container because {@link LabelValueInput} hands no reference to
 * what it builds, as {@link SelectEditor} reaches its box for the same reason.
 */
function ColorEditor({ cell, success }: EditorOpts) {
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const picker = containerRef.current?.querySelector<HTMLInputElement>("input[type=color]");
        if (!picker) return;

        picker.focus();
        const onPicked = () => success(picker.value);
        picker.addEventListener("change", onPicked);
        return () => picker.removeEventListener("change", onPicked);
    }, [ success ]);

    return (
        <div ref={containerRef} className="input-group table-color-editor">
            <LabelValueInput
                labelType="color"
                value={cell.getValue() ?? ""}
                // Nothing is what the clear button hands back, and only it — a picker always names a
                // colour. There being nothing to follow a clear with, it finishes the edit itself.
                onCommit={(value) => !value && success("")}
            />
        </div>
    );
}

/**
 * A colour cell as the swatch its editor shows, so that reading and editing a colour look alike, and
 * so that the row keeps its own striping, hover and selection — all of which a cell flooded with the
 * colour, as Tabulator's own colour formatter fills it, hides.
 *
 * The value itself is carried in the tooltip rather than set beside the swatch: a column of colours is
 * read by eye, and the text behind one is wanted only now and then — including where it names no
 * colour at all, a cell holding whatever the label does, which the swatch alone could not say.
 */
function ColorFormatter({ cell }: FormatterOpts) {
    const value = cell.getValue();
    const color = typeof value === "string" ? value : "";
    // A formatter hands back an element, so an unset cell is an empty one rather than nothing at all.
    if (!color) return <span />;

    return <ColorSwatch color={color} />;
}

/**
 * A colour as the square it is read as, wherever one is shown: a cell of its own, or a chip in a cell
 * holding several.
 *
 * The colour is the one thing about the swatch that cannot be told beforehand; its shape and size are
 * its class's. A value naming no colour is dropped by the browser, leaving the outline behind rather
 * than showing it as a colour it is not — and the text behind it is carried in the tooltip, a column
 * of colours being read by eye and its values wanted only now and then.
 */
export function ColorSwatch({ color }: { color: string }) {
    return <span className="table-color-swatch" title={color} style={{ backgroundColor: color }} />;
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
