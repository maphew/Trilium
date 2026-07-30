import "./PromotedAttributes.css";

import { DefinitionObject, extractAttributeDefinitionTypeAndName, UpdateAttributeResponse } from "@triliumnext/commons";
import clsx from "clsx";
import { ComponentChild, MouseEventHandler, TargetedEvent } from "preact";
import { Dispatch, StateUpdater, useCallback, useEffect, useState } from "preact/hooks";

import NoteContext from "../components/note_context";
import FAttribute from "../entities/fattribute";
import FNote from "../entities/fnote";
import { Attribute } from "../services/attribute_parser";
import attributes from "../services/attributes";
import { t } from "../services/i18n";
import server from "../services/server";
import { randomString } from "../services/utils";
import ws from "../services/ws";
import LabelValueInput from "./attribute_widgets/label_value_input";
import MultiValueInput from "./attribute_widgets/multi_value_input";
import { useNoteContext, useNoteLabel, useTriliumEvent, useUniqueName } from "./react/hooks";
import NoteAutocomplete from "./react/NoteAutocomplete";

interface Cell {
    uniqueId: string;
    definitionAttr: FAttribute;
    definition: DefinitionObject;
    valueAttr: Attribute;
    valueName: string;
    /**
     * Every value the note holds under this name, for a label whose definition allows several — the
     * whole set being edited as one field of chips rather than as a field per value.
     *
     * Absent for a definition holding one value, and for a relation, which is still a field per value:
     * a relation's values are note ids, which the chips have no way of naming yet.
     */
    values?: string[];
}

interface CellProps {
    note: FNote;
    componentId: string;
    cell: Cell,
    cells: Cell[],
    shouldFocus: boolean;
    setCells: Dispatch<StateUpdater<Cell[] | undefined>>;
    setCellToFocus(cell: Cell): void;
}

type OnChangeEventData = TargetedEvent<HTMLInputElement | HTMLTextAreaElement, Event> | InputEvent | JQuery.TriggeredEvent<HTMLInputElement, undefined, HTMLInputElement, HTMLInputElement>;
type OnChangeListener = (e: OnChangeEventData) => void | Promise<void>;

export default function PromotedAttributes() {
    const { note, componentId, noteContext } = useNoteContext();
    const [ cells, setCells ] = usePromotedAttributeData(note, componentId, noteContext);
    return <PromotedAttributesContent note={note} componentId={componentId} cells={cells} setCells={setCells} />;
}

export function PromotedAttributesContent({ note, componentId, cells, setCells }: {
    note: FNote | null | undefined;
    componentId: string;
    cells: Cell[] | undefined;
    setCells: Dispatch<StateUpdater<Cell[] | undefined>>;
}) {
    const [ cellToFocus, setCellToFocus ] = useState<Cell>();

    return (
        <div className="promoted-attributes-widget">
            {cells && cells.length > 0 && <div className="promoted-attributes-container">
                {note && cells?.map(cell => <PromotedAttributeCell
                    key={cell.uniqueId}
                    cell={cell}
                    cells={cells} setCells={setCells}
                    shouldFocus={cell === cellToFocus} setCellToFocus={setCellToFocus}
                    componentId={componentId} note={note}
                />)}
            </div>}
        </div>
    );
}

/**
 * Handles the individual cells (fields for promoted attributes, including empty ones). A label
 * allowing several values is one cell holding the whole set; a relation allowing several is still a
 * cell per value — see {@link buildPromotedCells}.
 *
 * The cells are returned as a state since they can also be altered internally if needed, for example to add a new empty cell.
 */
export function usePromotedAttributeData(note: FNote | null | undefined, componentId: string, noteContext: NoteContext | undefined): [ Cell[] | undefined, Dispatch<StateUpdater<Cell[] | undefined>> ] {
    const [ viewType ] = useNoteLabel(note, "viewType");
    const [ cells, setCells ] = useState<Cell[]>();

    function refresh() {
        if (!note || viewType === "table" || noteContext?.viewScope?.viewMode !== "default") {
            setCells([]);
            return;
        }
        setCells(buildPromotedCells(note));
    }

    useEffect(refresh, [ note, viewType, noteContext ]);
    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (loadResults.getAttributeRows(componentId).find((attr) => attributes.isAffecting(attr, note))) {
            refresh();
        }
    });

    return [ cells, setCells ];
}

/**
 * The fields a note's promoted definitions ask for, in the order they are shown.
 *
 * One definition is usually one field. A label allowing several values is still one — the set is
 * edited as chips within it, so the note shows one field however many values it holds — while a
 * relation allowing several is a field per value, there being no chip yet that can name a note.
 *
 * A definition the note holds nothing under still gets its field, empty, so that a value can be
 * entered where there is none. For a set that is the field with no chips in it rather than a blank
 * value among them: an empty chip would stand for nothing, and pressing its remove button would
 * remove nothing.
 *
 * Exported for its own tests.
 */
export function buildPromotedCells(note: FNote): Cell[] {
    const promotedDefAttrs = note.getPromotedDefinitionAttributes();
    const ownedAttributes = note.getOwnedAttributes();
    // attrs are not resorted if position changes after the initial load
    // promoted attrs are sorted primarily by order of definitions, but with multi-valued promoted attrs
    // the order of attributes is important as well
    ownedAttributes.sort((a, b) => a.position - b.position);

    const cells: Cell[] = [];
    for (const definitionAttr of promotedDefAttrs) {
        const [ valueType, valueName ] = extractAttributeDefinitionTypeAndName(definitionAttr.name);
        const definition = definitionAttr.getDefinition();
        const held = ownedAttributes.filter((el) => el.name === valueName && el.type === valueType) as Attribute[];
        const blank: Attribute = {
            attributeId: "",
            type: valueType,
            name: valueName,
            value: ""
        };

        if (definition.multiplicity === "multi" && valueType === "label") {
            cells.push({
                definitionAttr,
                definition,
                valueName,
                // The set is written back by name rather than through any one attribute, so the field
                // carries the definition's own blank: what it needs from an attribute is the type and
                // the name, which every value under it shares.
                valueAttr: blank,
                values: held.map((attr) => attr.value).filter((value): value is string => !!value),
                uniqueId: randomString()
            });
            continue;
        }

        let valueAttrs = held.length ? held : [ blank ];
        if (definition.multiplicity === "single") {
            valueAttrs = valueAttrs.slice(0, 1);
        }

        for (const valueAttr of valueAttrs) {
            // if not owned, we'll force creation of a new attribute instead of updating the inherited one
            if (valueAttr.noteId !== note.noteId) {
                valueAttr.attributeId = "";
            }

            cells.push({ definitionAttr, definition, valueAttr, valueName, uniqueId: randomString() });
        }
    }

    return cells;
}

function PromotedAttributeCell(props: CellProps) {
    const { valueName, valueAttr, definition } = props.cell;
    const inputId = useUniqueName(`value-${valueAttr.name}`);

    useEffect(() => {
        if (!props.shouldFocus) return;
        const inputEl = document.getElementById(inputId);
        if (inputEl) {
            inputEl.focus();
        }
    }, [ props.shouldFocus ]);

    const holdsSet = !!props.cell.values;

    let correspondingInput: ComponentChild;
    let className: string | undefined;
    switch (valueAttr.type) {
        case "label":
            correspondingInput = holdsSet
                ? <MultiLabelInput inputId={inputId} {...props} />
                : <LabelInput inputId={inputId} {...props} />;
            className = `promoted-attribute-label-${definition.labelType}`;
            break;
        case "relation":
            correspondingInput = <RelationInput inputId={inputId} {...props} />;
            className = "promoted-attribute-relation";
            break;
        default:
            ws.logError(t(`promoted_attributes.unknown_attribute_type`, { type: valueAttr.type }));
            break;
    }

    return (
        <div className={clsx("promoted-attribute-cell", className)}>
            {/* A single flag names itself after its own box, a checkbox before its name reading as the
                sentence it is. A field of flags is a field like any other: the chips in it stand for
                values, not for the field being on, so the name goes ahead of it as elsewhere. */}
            {(definition.labelType !== "boolean" || holdsSet) &&
                <label for={inputId}>{definition.promotedAlias ?? valueName}</label>}
            {correspondingInput}
            <MultiplicityCell {...props} />
        </div>
    );
}

function LabelInput(props: CellProps & { inputId: string }) {
    const { inputId, note, cell, componentId, setCells } = props;
    const { valueName, valueAttr, definition, definitionAttr } = cell;
    const [ valueDraft, setDraft ] = useState(valueAttr.value);
    const labelType = definition.labelType ?? "text";
    const commit = useCallback(
        (value: string) => updateAttribute(note, cell, componentId, value, setCells),
        [ cell, componentId, note, setCells ]);

    const createOption = useCreateSelectOption(definitionAttr, componentId, setCells);

    useTextLabelAutocomplete(inputId, valueAttr, definition, (e) => {
        if (e.currentTarget instanceof HTMLInputElement) {
            setDraft(e.currentTarget.value);
        }
    });

    // React to model changes.
    useEffect(() => {
        setDraft(valueAttr.value);
    }, [ valueAttr.value ]);

    const input = (
        <LabelValueInput
            labelType={labelType}
            // The draft is what the field shows: the autocomplete writes into it as the user picks.
            value={(labelType === "boolean" ? valueAttr.value : valueDraft) ?? ""}
            onCommit={commit}
            commitOn="blur"
            numberPrecision={definition.numberPrecision}
            selectOptions={definition.selectOptions}
            onCreateOption={labelType === "select" ? createOption : undefined}
            inputProps={{
                className: "form-control promoted-attribute-input",
                tabIndex: 200 + definitionAttr.position,
                id: inputId,
                placeholder: t("promoted_attributes.unset-field-placeholder"),
                "data-attribute-id": valueAttr.attributeId,
                "data-attribute-type": valueAttr.type,
                "data-attribute-name": valueAttr.name
            }}
        />
    );

    if (labelType === "boolean") {
        return <>
            <div>
                <label className="tn-checkbox">{input}</label>
            </div>
            <label for={inputId}>{definition.promotedAlias ?? valueName}</label>
        </>;
    }

    return <div className="input-group">{input}</div>;
}

/**
 * The field a label allowing several values is edited through: one field holding the whole set as
 * chips, rather than a field per value with buttons beside each for adding and removing one.
 *
 * The set is written back by name — every value under it at once — so nothing here holds an attribute
 * of its own: which attribute ends up carrying which value is neither knowable from here nor worth
 * knowing, the note holding a set rather than an ordered list of rows.
 */
function MultiLabelInput({ inputId, note, cell, componentId, setCells }: CellProps & { inputId: string }) {
    const { valueName, definition, definitionAttr, values, uniqueId } = cell;
    const labelType = definition.labelType ?? "text";
    const createOption = useCreateSelectOption(definitionAttr, componentId, setCells);

    const commit = useCallback(async (edited: string[]) => {
        await attributes.setLabelValues(note, valueName, edited, componentId);
        // The grid ignores reloads it is itself the source of (see usePromotedAttributeData), so the
        // set it shows is patched in place, as updateAttribute does for a single value — otherwise
        // the chips would not follow the value just taken.
        setCells(prev => prev?.map(c => c.uniqueId === uniqueId ? { ...c, values: edited } : c));
    }, [ note, valueName, componentId, uniqueId, setCells ]);

    return (
        <div className="promoted-attribute-values">
            <MultiValueInput
                labelType={labelType}
                values={values ?? []}
                options={definition.selectOptions}
                onCreateOption={labelType === "select" ? createOption : undefined}
                inputId={inputId}
                tabIndex={200 + definitionAttr.position}
                onCommit={commit}
            />
        </div>
    );
}

/**
 * Adds an option to a `select` definition from the very field being typed into. Written to whichever
 * note owns the definition — typically a parent or a template — so every note sharing the field
 * offers the new option from now on.
 */
function useCreateSelectOption(definitionAttr: FAttribute, componentId: string, setCells: Dispatch<StateUpdater<Cell[] | undefined>>) {
    return useCallback(async (option: string) => {
        const newDefinition = await attributes.addSelectOption(definitionAttr, option, componentId);
        // The grid ignores reloads it is itself the source of (see usePromotedAttributeData), so the
        // cells sharing the definition are patched in place, as updateAttribute does for a value —
        // otherwise the list keeps offering the old options until something else changes.
        setCells(prev => prev?.map(c =>
            c.definitionAttr.attributeId === definitionAttr.attributeId
                ? { ...c, definition: newDefinition }
                : c
        ));
    }, [ definitionAttr, componentId, setCells ]);
}

function RelationInput({ inputId, ...props }: CellProps & { inputId: string }) {
    return (
        <NoteAutocomplete
            id={inputId}
            noteId={props.cell.valueAttr.value}
            opts={{ allowCreatingNotes: true }}
            noteIdChanged={async (value) => {
                const { note, cell, componentId, setCells } = props;
                await updateAttribute(note, cell, componentId, value, setCells);
            }}
        />
    );
}

/**
 * The buttons beside a field that is one value of several: one adding a field after it, one removing
 * the value it holds.
 *
 * Only for the kinds still shown a field per value — which is to say relations. A label holding
 * several is one field of chips, where a value is added by entering it and removed by pressing the
 * chip it is on, so a pair of buttons beside it would offer the same twice.
 */
function MultiplicityCell({ cell, cells, setCells, setCellToFocus, note, componentId }: CellProps) {
    return (cell.definition.multiplicity === "multi" && !cell.values &&
        <td className="multiplicity">
            <PromotedActionButton
                icon="bx bx-plus"
                title={t("promoted_attributes.add_new_attribute")}
                onClick={() => {
                    const index = cells.indexOf(cell);
                    const newCell: Cell = {
                        ...cell,
                        uniqueId: randomString(),
                        valueAttr: {
                            attributeId: "",
                            type: cell.valueAttr.type,
                            name: cell.valueName,
                            value: ""
                        }
                    };
                    setCells([
                        ...cells.slice(0, index + 1),
                        newCell,
                        ...cells.slice(index + 1)
                    ]);
                    setCellToFocus(newCell);
                }}
            />{' '}
            <PromotedActionButton
                icon="bx bx-trash"
                title={t("promoted_attributes.remove_this_attribute")}
                onClick={async () => {
                    // Remove the attribute from the server if it exists.
                    const { attributeId, type } = cell.valueAttr;
                    const valueName = cell.valueName;
                    if (attributeId) {
                        await server.remove(`notes/${note.noteId}/attributes/${attributeId}`, componentId);
                    }

                    const index = cells.indexOf(cell);
                    const isLastOneOfType = cells.filter(c => c.valueAttr.type === type && c.valueAttr.name === valueName).length < 2;
                    const newOnesToInsert: Cell[] = [];
                    if (isLastOneOfType) {
                        newOnesToInsert.push({
                            ...cell,
                            valueAttr: {
                                attributeId: "",
                                type: cell.valueAttr.type,
                                name: cell.valueName,
                                value: ""
                            }
                        });
                    }
                    setCells(cells.toSpliced(index, 1, ...newOnesToInsert));
                }}
            />
        </td>
    );
}

function PromotedActionButton({ icon, title, onClick }: {
    icon: string,
    title: string,
    onClick: MouseEventHandler<HTMLSpanElement>
}) {
    return (
        <span
            className={clsx("tn-tool-button pointer", icon)}
            title={title}
            onClick={onClick}
        />
    );
}

function useTextLabelAutocomplete(inputId: string, valueAttr: Attribute, definition: DefinitionObject, onChangeListener: OnChangeListener) {
    const [ attributeValues, setAttributeValues ] = useState<{ value: string }[] | null>(null);

    // Obtain data.
    useEffect(() => {
        // A nameless attribute has no values to suggest, and would request `attribute-values/`, which
        // matches no route.
        if (definition.labelType !== "text" || !valueAttr.name) {
            return;
        }

        server.get<string[]>(`attribute-values/${encodeURIComponent(valueAttr.name)}`).then((_attributesValues) => {
            setAttributeValues(_attributesValues.map((attribute) => ({ value: attribute })));
        });
    }, [ definition.labelType, valueAttr.name ]);

    // Initialize autocomplete.
    useEffect(() => {
        if (attributeValues?.length === 0) return;
        const el = document.getElementById(inputId) as HTMLInputElement | null;
        if (!el) return;

        const $input = $(el);
        $input.autocomplete(
            {
                appendTo: document.querySelector("body"),
                hint: false,
                autoselect: false,
                openOnFocus: true,
                minLength: 0,
                tabAutocomplete: false
            },
            [
                {
                    displayKey: "value",
                    source (term, cb) {
                        term = term.toLowerCase();

                        const filtered = (attributeValues ?? []).filter((attr) => attr.value.toLowerCase().includes(term));

                        cb(filtered);
                    }
                }
            ]
        );

        $input.off("autocomplete:selected");
        $input.on("autocomplete:selected", onChangeListener);

        return () => $input.autocomplete("destroy");
    }, [ inputId, attributeValues, onChangeListener ]);
}

async function updateAttribute(note: FNote, cell: Cell, componentId: string, value: string | undefined, setCells: Dispatch<StateUpdater<Cell[] | undefined>>) {
    if (value === cell.valueAttr.value) return;
    const { attributeId } = await server.put<UpdateAttributeResponse>(
        `notes/${note.noteId}/attribute`,
        {
            attributeId: cell.valueAttr.attributeId,
            type: cell.valueAttr.type,
            name: cell.valueName,
            value: value || ""
        },
        componentId
    );
    setCells(prev =>
        prev?.map(c =>
            c.uniqueId === cell.uniqueId
                ? { ...c, valueAttr: {
                    ...c.valueAttr,
                    attributeId,
                    value
                } }
                : c
        )
    );
}
