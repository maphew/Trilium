import "./AttributeList.css";

import { promotedAttributeDefinitionParser } from "@triliumnext/commons";
import clsx from "clsx";
import { createPortal } from "preact/compat";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import FAttribute from "../../entities/fattribute";
import FNote from "../../entities/fnote";
import contextMenu from "../../menus/context_menu";
import type { Attribute } from "../../services/attribute_parser";
import attributes, { isBuiltinAttribute } from "../../services/attributes";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import server from "../../services/server";
import { AttributeDetail, AttributeDetailOpts, AttrType, DEFINITION_TYPES, getAttrType, LABEL_TYPES, RELATION_DEFINITION_TYPE } from "../attribute_widgets/attribute_detail";
import ActionButton from "../react/ActionButton";
import HelpButton from "../react/HelpButton";
import { useActiveNoteContext, useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import { ParentComponent } from "../react/react_utils";
import { ATTRIBUTE_HELP_PAGE } from "../ribbon/components/AttributeHelp";
import RightPanelWidget, { CollapsibleWidgets } from "./RightPanelWidget";

/**
 * The note's attributes as a list, one row per attribute: the kind (label, relation, or either's
 * definition) is carried by an icon instead of by the `#`/`~`/`label:` syntax the attributes editor
 * spells out, and the value is shown as a preview rather than in full. Rows open the same detail
 * popup the editor uses, which is where an attribute is actually edited.
 */
export default function AttributeList() {
    const { note } = useActiveNoteContext();
    const parentComponent = useContext(ParentComponent);
    const containerRef = useRef<HTMLDivElement>(null);
    const [ detail, setDetail ] = useState<AttributeDetailOpts | null>(null);
    const componentId = parentComponent?.componentId;

    // The owned rows double as the detail popup's working copy: it edits the very objects it is handed,
    // so both lists are kept in refs (whose identity the popup holds on to) and redrawn by hand.
    const owned = useRef<Attribute[]>([]);
    const inherited = useRef<Attribute[]>([]);
    const [ , setRevision ] = useState(0);
    const rerender = () => setRevision((revision) => revision + 1);

    // Collected while rendering rather than in an effect, which would leave one frame listing the
    // attributes of the note navigated away from. The initial `undefined` is what collects the first.
    const shownNoteId = useRef<string | null>();
    if (shownNoteId.current !== (note?.noteId ?? null)) {
        shownNoteId.current = note?.noteId ?? null;
        owned.current = collectOwned(note);
        inherited.current = collectInherited(note);
    }

    // The popup edits one attribute of the note being left, so it closes with the note.
    useEffect(() => setDetail(null), [ note ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        // While the popup is open, the changes this widget itself made are skipped: its edits are the
        // freshest state, and reloading over them would discard what is being typed. Once it is closed
        // our own saves count too, which is how the list drops a row the server refused to keep (a
        // relation left without a target note).
        const changed = detail ? loadResults.getAttributeRows(componentId) : loadResults.getAttributeRows();
        if (note && changed.some((attr) => attributes.isAffecting(attr, note))) {
            owned.current = collectOwned(note);
            inherited.current = collectInherited(note);
            rerender();
        }
    });

    /** Persists the whole draft: the endpoint replaces the note's owned attributes with the list. */
    async function save() {
        if (note) {
            await server.put(`notes/${note.noteId}/attributes`, owned.current, componentId);
        }
    }

    function openDetail(attribute: Attribute, isOwned: boolean, anchor: HTMLElement | null, e: MouseEvent) {
        setDetail({
            allAttributes: isOwned ? owned.current : undefined,
            attribute,
            isOwned,
            x: e.pageX,
            y: e.pageY,
            anchor: anchor ?? undefined,
            // Presses on another row swap the shown attribute instead of dismissing the popup first.
            parent: spawningArea()
        });
    }

    /**
     * What the popup treats as the widget it was spawned from: the two sections are separate cards, so
     * it takes in the whole tab holding them, and a row of either swaps the shown attribute rather than
     * dismissing the popup and re-opening it. Falls back to the section itself outside of a tab.
     */
    function spawningArea() {
        return containerRef.current?.closest<HTMLElement>(".right-pane-tab-body") ?? containerRef.current ?? undefined;
    }

    function addAttribute(attrType: AttributeKind, e: MouseEvent) {
        const attribute = createAttribute(attrType);

        owned.current = [ ...owned.current, attribute ];
        setDetail({
            allAttributes: owned.current,
            attribute,
            isOwned: true,
            x: e.pageX,
            y: e.pageY,
            focus: "name",
            // There is no row to anchor to yet: the attribute only joins the list once it is saved.
            anchor: containerRef.current ?? undefined,
            parent: spawningArea()
        });
    }

    /** Closes the popup keeping its edits: a list of rows has no save step of its own. */
    function commit() {
        const isOwned = detail?.isOwned;

        setDetail(null);
        if (isOwned) {
            void save();
        }
    }

    /**
     * Deleting is a press away in every row, and the row is all there is to tell one attribute from
     * another, so it is confirmed first — from the popup too, which deletes the very same thing.
     */
    async function deleteAttribute(attribute: Attribute) {
        const name = getDisplayName(attribute, getAttributeKind(attribute));
        if (!await dialog.confirm(t("attribute_list_panel.delete_confirm", { name }))) {
            return;
        }

        owned.current = owned.current.filter((candidate) => candidate !== attribute);
        setDetail(null);
        rerender();

        await save();
    }

    const sections = splitIntoSections(owned.current, inherited.current);
    const rowProps = {
        activeAttribute: detail?.attribute,
        onOpen: openDetail,
        onDelete: (attribute: Attribute) => void deleteAttribute(attribute)
    };
    // The cards a section has nothing for are left out, so an ordinary note sees one or two of the three.
    const shownCards = 1 + (sections.inherited.length ? 1 : 0) + (sections.definitions.length ? 1 : 0);

    return (
        <>
            {/* A card each, so a section is collapsed on its own and the inherited attributes — which a
                template can run to dozens of — can be put away without taking the note's own with them.
                Which is also why the collapsing is offered here rather than left to the tab: the tab
                counts this whole panel as one widget (see RightPanelContainer), being one entry in its
                list. Down to a single card, collapsing it away is not on offer. */}
            <CollapsibleWidgets.Provider value={shownCards > 1}>
                <RightPanelWidget
                    id="attributes"
                    title={t("attribute_list_panel.owned", { count: sections.owned.length })}
                    grow
                    buttons={note && (
                        <>
                            <HelpButton helpPage={ATTRIBUTE_HELP_PAGE} />
                            <ActionButton
                                icon="bx bx-plus"
                                text={t("attribute_editor.add_a_new_attribute")}
                                onClick={(e) => {
                                    // Keep the press from reaching the card header, which would collapse the card.
                                    e.stopPropagation();
                                    showAddMenu(e, (attrType) => addAttribute(attrType, e));
                                }}
                            />
                        </>
                    )}
                >
                    {/* Presses inside the sections do not dismiss the popup (see `parent` above), which
                        leaves closing on a press next to a row up to this handler. */}
                    <div class="attribute-list-panel" ref={containerRef} onClick={() => setDetail(null)}>
                        {sections.owned.length > 0 ? (
                            <AttributeRowList rows={sections.owned} {...rowProps} />
                        ) : (
                            <NoItems icon="bx bx-hash" text={t("attribute_list_panel.no_attributes")} />
                        )}
                    </div>
                </RightPanelWidget>

                {sections.inherited.length > 0 && (
                    <RightPanelWidget
                        id="attributes-inherited"
                        title={t("attribute_list_panel.inherited", { count: sections.inherited.length })}
                    >
                        <div class="attribute-list-panel" onClick={() => setDetail(null)}>
                            <AttributeRowList rows={sections.inherited} {...rowProps} />
                        </div>
                    </RightPanelWidget>
                )}

                {sections.definitions.length > 0 && (
                    <RightPanelWidget
                        id="attributes-definitions"
                        title={t("attribute_list_panel.definitions", { count: sections.definitions.length })}
                    >
                        <div class="attribute-list-panel" onClick={() => setDetail(null)}>
                            <AttributeRowList rows={sections.definitions} {...rowProps} />
                        </div>
                    </RightPanelWidget>
                )}
            </CollapsibleWidgets.Provider>

            {createPortal(
                <AttributeDetail
                    opts={detail}
                    currentNoteId={note?.noteId}
                    // A press outside keeps the edits, matching the attributes editor (which saves on
                    // blur); the close button and escape go through onCancel and revert instead.
                    onDismiss={commit}
                    onCancel={() => {
                        if (note) {
                            owned.current = collectOwned(note);
                        }
                        setDetail(null);
                        rerender();
                    }}
                    // The popup edits the attribute in place, so there is nothing to apply here: the
                    // rows only need to be redrawn to follow along as it is typed into.
                    onAttributesChanged={rerender}
                    // An inherited attribute is shown read-only, so it has neither of the two.
                    onSaveAndClose={detail?.isOwned ? commit : undefined}
                    onDelete={detail?.isOwned ? () => void deleteAttribute(detail.attribute) : undefined}
                />,
                document.body)}
        </>
    );
}

interface AttributeRowListProps {
    rows: AttributeEntry[];
    /** The attribute the detail popup is showing, marked as such in the list. */
    activeAttribute?: Attribute;
    onOpen: (attribute: Attribute, isOwned: boolean, anchor: HTMLElement | null, e: MouseEvent) => void;
    onDelete: (attribute: Attribute) => void;
}

/**
 * One card's worth of rows, in two lists: what the note was given a name for, and below a rule, what
 * Trilium reads for itself. What a row offers follows from whether the note owns its attribute rather
 * than from the card it is in: the definitions card holds the note's own alongside a template's.
 */
function AttributeRowList({ rows, activeAttribute, onOpen, onDelete }: AttributeRowListProps) {
    function renderRows(group: AttributeEntry[]) {
        return (
            <ul class="attribute-rows">
                {group.map(({ attribute, isOwned, isSystem }, index) => (
                    <AttributeRow
                        key={attribute.attributeId ?? `new-${index}`}
                        attribute={attribute}
                        active={activeAttribute === attribute}
                        isSystem={isSystem}
                        // An attribute of another note names it; the current note's own would name itself.
                        showOwner={!isOwned}
                        onOpen={(anchor, e) => onOpen(attribute, isOwned, anchor, e)}
                        onDelete={isOwned ? () => onDelete(attribute) : undefined}
                    />
                ))}
            </ul>
        );
    }

    // The system attributes are sorted last (see splitIntoSections), so one index is the whole boundary.
    const boundary = rows.findIndex((entry) => entry.isSystem);
    const userDefined = boundary < 0 ? rows : rows.slice(0, boundary);
    const system = boundary < 0 ? [] : rows.slice(boundary);

    return (
        <>
            {userDefined.length > 0 && renderRows(userDefined)}
            {userDefined.length > 0 && system.length > 0 && <hr class="attribute-rows-divider" />}
            {system.length > 0 && renderRows(system)}
        </>
    );
}

interface AttributeRowProps {
    attribute: Attribute;
    /** Whether the detail popup is currently showing this attribute. */
    active: boolean;
    /** Whether the name is one Trilium reads for itself rather than one the note was given. */
    isSystem?: boolean;
    /** Names the note the attribute is inherited from, for attributes not owned by the current note. */
    showOwner?: boolean;
    onOpen: (anchor: HTMLElement | null, e: MouseEvent) => void;
    onDelete?: () => void;
}

function AttributeRow({ attribute, active, isSystem, showOwner, onOpen, onDelete }: AttributeRowProps) {
    const rowRef = useRef<HTMLLIElement>(null);
    const attrType = getAttributeKind(attribute);

    return (
        <li
            ref={rowRef}
            class={clsx("attribute-row", active && "active")}
            title={KIND_TITLES[attrType]}
            onClick={(e) => {
                // Keep the container's closing handler from undoing this.
                e.stopPropagation();
                onOpen(rowRef.current, e);
            }}
        >
            {/* The kind is the icon, and a system attribute carries a cog on its corner: its own tooltip
                names it, the marker being the only thing that says so. */}
            <span
                class={clsx("attribute-kind", isSystem && "marker-system")}
                title={isSystem ? t("attribute_names.system") : undefined}
            >
                <Icon icon={getKindIcon(attribute, attrType)} />
            </span>

            <span class="attribute-name">{getDisplayName(attribute, attrType)}</span>

            <AttributeValue attribute={attribute} attrType={attrType} />

            {attribute.isInheritable && (
                <Icon
                    className="attribute-marker"
                    icon="bx bx-sitemap"
                    title={t("attribute_list_panel.inheritable")}
                />
            )}

            {showOwner && attribute.noteId && (
                <NoteLink containerClassName="attribute-owner" notePath={attribute.noteId} noPreview />
            )}

            {onDelete && (
                <ActionButton
                    className="attribute-delete-button"
                    icon="bx bx-x"
                    text={t("attribute_list_panel.delete")}
                    onClick={(e) => {
                        e.stopPropagation();
                        onDelete();
                    }}
                />
            )}
        </li>
    );
}

/**
 * What the attribute is, as an icon. A definition takes the icon of the field it sets up, the same one
 * the popup offers that field under — it needs no marker of its own, being only ever listed in a card
 * of definitions. Everything else is the icon of a label or of a relation.
 */
function getKindIcon(attribute: Attribute, attrType: AttributeKind) {
    if (isDefinition(attrType)) {
        // A definition written by hand can name a field the popup knows nothing of, leaving the icon of
        // the label it defines to stand for it.
        return getDefinitionType(attribute, attrType)?.icon ?? "bx bx-hash";
    }

    return attrType === "relation" ? "bx bx-transfer" : "bx bx-hash";
}

/** The entry of the popup's definition-type list that the definition is currently set to. */
function getDefinitionType(attribute: Attribute, attrType: AttributeKind) {
    // A relation definition is named after what it points at rather than after a field it fills in.
    const value = attrType === "relation-definition"
        ? RELATION_DEFINITION_TYPE
        : promotedAttributeDefinitionParser.parse(attribute.value ?? "").labelType ?? "text";

    return DEFINITION_TYPES.find((definitionType) => definitionType.value === value);
}

/** A preview of what the attribute holds — the row stands for the attribute, the popup shows it in full. */
function AttributeValue({ attribute, attrType }: { attribute: Attribute; attrType: AttributeKind }) {
    if (attrType === "relation") {
        // A relation just created from the add menu has no target yet.
        return attribute.value
            ? <NoteLink containerClassName="attribute-value" notePath={attribute.value} showNoteIcon noPreview />
            : <span class="attribute-value empty">{t("attribute_list_panel.no_target")}</span>;
    }

    if (isDefinition(attrType)) {
        return <span class="attribute-value definition">{summarizeDefinition(attribute, attrType)}</span>;
    }

    // A label with no value still gets its slot: it is what takes up the room between the name and what
    // the row ends with, so a bare label lines its markers and its delete button up with every other row's.
    return <span class="attribute-value" title={attribute.value}>{attribute.value}</span>;
}

/** What a definition sets up, in the order the popup offers it: type, multiplicity, then the extras. */
function summarizeDefinition(attribute: Attribute, attrType: AttributeKind) {
    const definition = promotedAttributeDefinitionParser.parse(attribute.value ?? "");
    const parts: string[] = [];

    if (attrType === "label-definition") {
        const labelType = definition.labelType ?? "text";
        parts.push(LABEL_TYPES.find(({ value }) => value === labelType)?.title ?? labelType);
    }

    if (definition.multiplicity === "multi") {
        parts.push(t("attribute_detail.multi_value"));
    }

    if (definition.isPromoted) {
        parts.push(t("attribute_detail.promoted"));
    }

    if (definition.inverseRelation) {
        parts.push(t("attribute_list_panel.inverse_of", { name: definition.inverseRelation }));
    }

    return parts.join(" · ");
}

type AttributeKind = NonNullable<AttrType>;

export function getAttributeKind(attribute: Attribute): AttributeKind {
    // The popup resolves the kind of what it is about to edit the same way; an attribute that is
    // neither a label nor a relation cannot reach a list built from the note's own attributes.
    return getAttrType(attribute) ?? attribute.type;
}

function isDefinition(attrType: AttributeKind) {
    return attrType === "label-definition" || attrType === "relation-definition";
}

/** Definitions are stored prefixed (`label:foo`), but the prefix is what the icon already says. */
export function getDisplayName(attribute: Attribute, attrType: AttributeKind) {
    return isDefinition(attrType)
        ? attribute.name.substring(attribute.name.indexOf(":") + 1)
        : attribute.name;
}

const KIND_TITLES: Record<AttributeKind, string> = {
    label: t("attribute_list_panel.type_label"),
    relation: t("attribute_list_panel.type_relation"),
    "label-definition": t("attribute_list_panel.type_label_definition"),
    "relation-definition": t("attribute_list_panel.type_relation_definition")
};

function showAddMenu(e: MouseEvent, onSelect: (attrType: AttributeKind) => void) {
    void contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        orientation: "left",
        items: [
            { title: t("attribute_editor.add_new_label"), uiIcon: "bx bx-hash", handler: () => onSelect("label") },
            { title: t("attribute_editor.add_new_relation"), uiIcon: "bx bx-transfer", handler: () => onSelect("relation") },
            { kind: "separator" },
            { title: t("attribute_editor.add_new_label_definition"), uiIcon: "bx bx-hash", handler: () => onSelect("label-definition") },
            { title: t("attribute_editor.add_new_relation_definition"), uiIcon: "bx bx-transfer", handler: () => onSelect("relation-definition") }
        ],
        selectMenuItemHandler: () => {}
    });
}

/** The defaults the attributes editor's add menu creates, so both entry points agree. */
function createAttribute(attrType: AttributeKind): Attribute {
    switch (attrType) {
        case "label":
            return { type: "label", name: "myLabel", value: "", isInheritable: false };
        case "relation":
            return { type: "relation", name: "myRelation", value: "", isInheritable: false };
        case "label-definition":
            return { type: "label", name: "label:myLabel", value: "promoted,single,text", isInheritable: false };
        case "relation-definition":
            return { type: "label", name: "relation:myRelation", value: "promoted,single", isInheritable: false };
    }
}

/** An attribute as a row: what the row offers depends on whether the current note owns it. */
export interface AttributeEntry {
    attribute: Attribute;
    isOwned: boolean;
    /** Whether Trilium reads this name for itself, as opposed to the note having been given it. */
    isSystem: boolean;
}

export interface AttributeSections {
    /** The note's own labels and relations. */
    owned: AttributeEntry[];
    /** Labels and relations reaching it from elsewhere. */
    inherited: AttributeEntry[];
    /**
     * The definitions among either, the note's own first. They share a card rather than following the
     * split above: they are the schema behind an attribute and not something the note is tagged with,
     * there are rarely more than a handful, and a row already names the note its definition lives on —
     * which for a definition (nearly always a template's) is the more precise answer anyway.
     */
    definitions: AttributeEntry[];
}

export function splitIntoSections(owned: Attribute[], inherited: Attribute[]): AttributeSections {
    const isDefinitionEntry = ({ attribute }: AttributeEntry) => isDefinition(getAttributeKind(attribute));
    const toEntry = (isOwned: boolean) => (attribute: Attribute): AttributeEntry => ({
        attribute,
        isOwned,
        isSystem: isBuiltinAttribute(attribute.type, attribute.name)
    });
    const ownedEntries = owned.map(toEntry(true));
    const inheritedEntries = inherited.map(toEntry(false));

    return {
        owned: sortSystemLast(ownedEntries.filter((entry) => !isDefinitionEntry(entry))),
        inherited: sortSystemLast(inheritedEntries.filter((entry) => !isDefinitionEntry(entry))),
        definitions: sortSystemLast([ ...ownedEntries, ...inheritedEntries ].filter(isDefinitionEntry))
    };
}

/**
 * The names the note was given first, the ones Trilium reads for itself after them: the note's own
 * vocabulary is what its reader is looking for, and `cssClass` or `template` is plumbing they set once.
 * A stable sort, so each group keeps the order it was collected in.
 */
function sortSystemLast(entries: AttributeEntry[]) {
    return entries.toSorted((a, b) => Number(a.isSystem) - Number(b.isSystem));
}

function collectOwned(note: FNote | null | undefined): Attribute[] {
    return listOwned(note?.getOwnedAttributes() ?? []);
}

function collectInherited(note: FNote | null | undefined): Attribute[] {
    return listInherited(note?.getAttributes() ?? [], note?.noteId);
}

/** The note's own attributes, in the order it holds them. */
export function listOwned(ownedAttributes: FAttribute[]): Attribute[] {
    return ownedAttributes
        // Attributes Trilium maintains itself (the links of the note's content) are not metadata the
        // note was given, and are preserved across a save regardless, so they are left out.
        .filter((attribute) => !attribute.isAutoLink)
        .toSorted((a, b) => a.position - b.position)
        .map(toPlainAttribute);
}

/** Everything reaching the note from elsewhere, out of the effective attributes it is mixed into. */
export function listInherited(effectiveAttributes: FAttribute[], noteId: string | undefined): Attribute[] {
    return effectiveAttributes
        .filter((attribute) => attribute.noteId !== noteId && !attribute.isAutoLink)
        // Inherited attributes stay grouped by the note they come from:
        // https://github.com/zadam/trilium/issues/3761
        .toSorted((a, b) => a.noteId === b.noteId ? a.position - b.position : a.noteId.localeCompare(b.noteId))
        .map(toPlainAttribute);
}

/**
 * The rows and the detail popup work on plain attributes, which the popup is free to edit in place
 * without touching the cached entity behind them.
 */
function toPlainAttribute(attribute: FAttribute): Attribute {
    return {
        attributeId: attribute.attributeId,
        noteId: attribute.noteId,
        type: attribute.type,
        name: attribute.name,
        value: attribute.value,
        isInheritable: attribute.isInheritable
    };
}
