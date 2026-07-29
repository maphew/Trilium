import "./AttributeList.css";

import { promotedAttributeDefinitionParser } from "@triliumnext/commons";
import clsx from "clsx";
import { ComponentChildren } from "preact";
import { createPortal } from "preact/compat";
import { useContext, useEffect, useRef, useState } from "preact/hooks";

import FAttribute from "../../entities/fattribute";
import FNote from "../../entities/fnote";
import contextMenu, { MenuItem } from "../../menus/context_menu";
import type { Attribute } from "../../services/attribute_parser";
import attributes, { isBuiltinAttribute } from "../../services/attributes";
import dialog from "../../services/dialog";
import { t } from "../../services/i18n";
import server from "../../services/server";
import { isMobile } from "../../services/utils";
import { AttributeDetail, AttributeDetailOpts, AttrType, DEFINITION_TYPES, getAttrType, RELATION_DEFINITION_TYPE } from "../attribute_widgets/attribute_detail";
import ActionButton from "../react/ActionButton";
import { FormListItem } from "../react/FormList";
import HelpButton from "../react/HelpButton";
import { useActiveNoteContext, useTriliumEvent } from "../react/hooks";
import Icon from "../react/Icon";
import NoItems from "../react/NoItems";
import NoteLink from "../react/NoteLink";
import { ParentComponent } from "../react/react_utils";
import { ATTRIBUTE_HELP_PAGE } from "../ribbon/components/AttributeHelp";
import OptionsSection from "../type_widgets/options/components/OptionsSection";
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
    const internal = useRef<Attribute[]>([]);
    const [ , setRevision ] = useState(0);
    const rerender = () => setRevision((revision) => revision + 1);

    // Collected while rendering rather than in an effect, which would leave one frame listing the
    // attributes of the note navigated away from. The initial `undefined` is what collects the first.
    const shownNoteId = useRef<string | null>();
    if (shownNoteId.current !== (note?.noteId ?? null)) {
        shownNoteId.current = note?.noteId ?? null;
        owned.current = collectOwned(note);
        inherited.current = collectInherited(note);
        internal.current = collectInternal(note);
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
            internal.current = collectInternal(note);
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
    const internalRows = internal.current.map((attribute) => toEntry(attribute, true));
    const rowProps = {
        activeAttribute: detail?.attribute,
        onOpen: openDetail,
        onDelete: (attribute: Attribute) => void deleteAttribute(attribute)
    };
    // The cards a section has nothing for are left out, so an ordinary note sees one or two of the four.
    const shownCards = 1
        + (sections.inherited.length ? 1 : 0)
        + (sections.definitions.length ? 1 : 0)
        + (internalRows.length ? 1 : 0);

    return (
        <>
            {/* A card each, so a section is collapsed on its own and the inherited attributes — which a
                template can run to dozens of — can be put away without taking the note's own with them.
                Which is also why the collapsing is offered here rather than left to the tab: the tab
                counts this whole panel as one widget (see RightPanelContainer), being one entry in its
                list. Down to a single card, collapsing it away is not on offer. */}
            <CollapsibleWidgets.Provider value={shownCards > 1}>
                <AttributeSection
                    id="attributes"
                    title={t("attribute_list_panel.owned", { count: sections.owned.length })}
                    grow
                    buttons={note && (
                        <>
                            <HelpButton helpPage={ATTRIBUTE_HELP_PAGE} />
                            <AddAttributeButton
                                text={t("attribute_editor.add_a_new_attribute")}
                                attrTypes={ALL_ATTRIBUTE_KINDS}
                                onSelect={addAttribute}
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
                </AttributeSection>

                {sections.inherited.length > 0 && (
                    <AttributeSection
                        id="attributes-inherited"
                        title={t("attribute_list_panel.inherited", { count: sections.inherited.length })}
                    >
                        <div class="attribute-list-panel" onClick={() => setDetail(null)}>
                            <AttributeRowList rows={sections.inherited} {...rowProps} />
                        </div>
                    </AttributeSection>
                )}

                {sections.definitions.length > 0 && (
                    <AttributeSection
                        id="attributes-definitions"
                        title={t("attribute_list_panel.definitions", { count: sections.definitions.length })}
                        buttons={note && (
                            <AddAttributeButton
                                text={t("attribute_list_panel.add_definition")}
                                attrTypes={DEFINITION_KINDS}
                                onSelect={addAttribute}
                            />
                        )}
                    >
                        <div class="attribute-list-panel" onClick={() => setDetail(null)}>
                            <AttributeRowList rows={sections.definitions} {...rowProps} />
                        </div>
                    </AttributeSection>
                )}

                {internalRows.length > 0 && (
                    <AttributeSection
                        id="attributes-internal"
                        title={t("attribute_list_panel.internal", { count: internalRows.length })}
                    >
                        <div class="attribute-list-panel" onClick={() => setDetail(null)}>
                            <AttributeRowList rows={internalRows} readOnly {...rowProps} />
                        </div>
                    </AttributeSection>
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

interface AttributeSectionProps {
    /** What the right pane remembers the section by, collapsed state and all. */
    id: string;
    title: string;
    children: ComponentChildren;
    buttons?: ComponentChildren;
    /** Passed on to {@link RightPanelWidget}, which is the only host that has room to give. */
    grow?: boolean;
}

/**
 * One section, drawn as the layout it is in draws a titled group of things: a card of the right pane on
 * a desktop, foldable and remembered as folded; the same card the settings pages are built from on a
 * phone, where the panel is a page of its own and a title is read rather than pressed.
 */
function AttributeSection({ id, title, children, buttons, grow }: AttributeSectionProps) {
    if (IS_MOBILE) {
        // The id names the section here too, as a class: it is what the right pane knows the section by,
        // and there is no reason for a stylesheet (or a test) to know it by anything else.
        return <OptionsSection className={id} title={title} actions={buttons}>{children}</OptionsSection>;
    }

    return (
        <RightPanelWidget id={id} title={title} buttons={buttons} grow={grow}>
            {children}
        </RightPanelWidget>
    );
}

interface AttributeRowListProps {
    rows: AttributeEntry[];
    /** The attribute the detail popup is showing, marked as such in the list. */
    activeAttribute?: Attribute;
    /**
     * The rows stand for attributes Trilium writes and keeps up to date itself, which leaves them
     * nothing to offer: nothing to edit, nothing to delete, no note to name as their source (they are
     * always the current one's), and no split to draw between the note's own names and Trilium's —
     * every one of them is Trilium's, which is what the card they are in says.
     */
    readOnly?: boolean;
    onOpen: (attribute: Attribute, isOwned: boolean, anchor: HTMLElement | null, e: MouseEvent) => void;
    onDelete: (attribute: Attribute) => void;
}

/**
 * One card's worth of rows, in two lists: what the note was given a name for, and below a rule, what
 * Trilium reads for itself. What a row offers follows from whether the note owns its attribute rather
 * than from the card it is in: the definitions card holds the note's own alongside a template's.
 */
function AttributeRowList({ rows, activeAttribute, readOnly, onOpen, onDelete }: AttributeRowListProps) {
    function renderRows(group: AttributeEntry[]) {
        return (
            // The rows are menu items on a phone (see AttributeRow), and the theme dresses a menu item
            // through the menu around it — so the list stands in as that menu, the way the other lists
            // of menu items outside a dropdown do (`dropdown-menu static show`, as in the code-note
            // switcher). Static: it opens nowhere and is positioned by nothing.
            <ul class={clsx("attribute-rows", IS_MOBILE && "dropdown-menu tn-dropdown-menu static show")}>
                {group.map(({ attribute, isOwned, isSystem }, index) => (
                    <AttributeRow
                        key={attribute.attributeId ?? `new-${index}`}
                        attribute={attribute}
                        active={activeAttribute === attribute}
                        isSystem={isSystem && !readOnly}
                        // An attribute of another note names it; the current note's own would name itself.
                        showOwner={!isOwned && !readOnly}
                        // A read-only row opens the popup as an inherited one does: to be read, not edited.
                        onOpen={(anchor, e) => onOpen(attribute, isOwned && !readOnly, anchor, e)}
                        onDelete={isOwned && !readOnly ? () => onDelete(attribute) : undefined}
                    />
                ))}
            </ul>
        );
    }

    // The system attributes are sorted last (see splitIntoSections), so one index is the whole boundary.
    const boundary = readOnly ? -1 : rows.findIndex((entry) => entry.isSystem);
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
    const marker = getKindMarker(attribute, attrType, isSystem);
    const kindIcon = getKindIcon(attribute, attrType);
    const rowClass = clsx("attribute-row", active && "active");

    function open(e: MouseEvent) {
        // Keep the container's closing handler from undoing this.
        e.stopPropagation();
        onOpen(rowRef.current, e);
    }

    const contents = (
        <>
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
        </>
    );

    // On a phone the rows are menu items, drawn as everything else the note's menu leads to is: the
    // panel is reached from that menu (see the note attributes modal), and a row there is something
    // pressed with a thumb rather than pointed at.
    if (IS_MOBILE) {
        return (
            <FormListItem
                itemRef={rowRef}
                className={rowClass}
                icon={kindIcon}
                // The badge hangs off the icon's own corner here, there being no wrapper to hang it on.
                iconClassName={clsx("attribute-kind", marker?.class)}
                title={[ KIND_TITLES[attrType], marker?.title ].filter(Boolean).join(" · ")}
                onClick={open}
            >
                {contents}
            </FormListItem>
        );
    }

    return (
        <li
            ref={rowRef}
            class={rowClass}
            title={KIND_TITLES[attrType]}
            onClick={open}
        >
            {/* The kind is the icon, and what is worth saying about it beyond that is a badge on its
                corner: its own tooltip names it, the badge being the only thing that says so. */}
            <span class={clsx("attribute-kind", marker?.class)} title={marker?.title}>
                <Icon icon={kindIcon} />
            </span>

            {contents}
        </li>
    );
}

/**
 * Whether a row is a menu item, read once: what the app is running on does not change under it, and
 * the rows are redrawn on every keystroke the popup takes.
 */
const IS_MOBILE = isMobile();

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

/**
 * The badge the kind icon carries on its corner, where there is one to carry: a cog for the names
 * Trilium reads for itself, and a chevron for a definition whose field is promoted — lifted, that is,
 * out of the attributes and into the note's own ribbon. At most one of the two, which no attribute is
 * ever both of: no built-in name is a definition.
 */
function getKindMarker(attribute: Attribute, attrType: AttributeKind, isSystem?: boolean) {
    if (isSystem) {
        // The hint the detail popup's badge carries, rather than the word the badge shows beside it:
        // there is no text against the cog to be named, so what a reader hovering it wants is what
        // being a system attribute means.
        return { class: "marker-system", title: t("attribute_names.system_description") };
    }

    if (isDefinition(attrType) && promotedAttributeDefinitionParser.parse(attribute.value ?? "").isPromoted) {
        return { class: "marker-promoted", title: t("attribute_detail.promoted") };
    }

    return undefined;
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
        return <DefinitionSummary attribute={attribute} />;
    }

    // A label with no value still gets its slot: it is what takes up the room between the name and what
    // the row ends with, so a bare label lines its markers and its delete button up with every other row's.
    return <span class="attribute-value" title={attribute.value}>{attribute.value}</span>;
}

/**
 * What a definition sets up, beyond the two things its icon and its badge already say — the type of
 * field it defines, and whether that field is promoted. First the name that field goes by, if it was
 * given one of its own; then its settings, which are quiet enough that a plain single-value definition
 * summarises to the display name alone, or to nothing at all.
 */
function DefinitionSummary({ attribute }: { attribute: Attribute }) {
    const definition = promotedAttributeDefinitionParser.parse(attribute.value ?? "");
    const displayName = definition.promotedAlias?.trim();
    const settings: string[] = [];

    if (definition.multiplicity === "multi") {
        settings.push(t("attribute_detail.multi_value"));
    }

    if (definition.inverseRelation) {
        settings.push(t("attribute_list_panel.inverse_of", { name: definition.inverseRelation }));
    }

    return (
        <span class="attribute-value definition">
            {displayName && (
                // Written by hand and shown as written, unlike the settings beside it, which are words
                // of Trilium's own (see AttributeList.css).
                <span class="definition-display-name" title={t("attribute_detail.promoted_alias")}>
                    {displayName}
                </span>
            )}
            {displayName && settings.length > 0 && SUMMARY_SEPARATOR}
            {settings.join(SUMMARY_SEPARATOR)}
        </span>
    );
}

const SUMMARY_SEPARATOR = " · ";

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

/**
 * A card's add button: it offers the kinds the card is about, so the definitions card offers the two
 * definitions alone while the note's own attributes are added from the top of the panel, whether or not
 * a definitions card exists yet to add one from.
 */
function AddAttributeButton({ text, attrTypes, onSelect }: {
    text: string;
    attrTypes: AttributeKind[];
    onSelect: (attrType: AttributeKind, e: MouseEvent) => void;
}) {
    return (
        <ActionButton
            icon="bx bx-plus"
            text={text}
            onClick={(e) => {
                // Keep the press from reaching the card header, which would collapse the card.
                e.stopPropagation();
                showAddMenu(e, attrTypes, (attrType) => onSelect(attrType, e));
            }}
        />
    );
}

/** What each card's add button offers, in the order the attributes editor's own menu offers it. */
const ADD_MENU_ENTRIES: { attrType: AttributeKind; title: string; icon: string }[] = [
    { attrType: "label", title: t("attribute_editor.add_new_label"), icon: "bx bx-hash" },
    { attrType: "relation", title: t("attribute_editor.add_new_relation"), icon: "bx bx-transfer" },
    { attrType: "label-definition", title: t("attribute_editor.add_new_label_definition"), icon: "bx bx-hash" },
    { attrType: "relation-definition", title: t("attribute_editor.add_new_relation_definition"), icon: "bx bx-transfer" }
];

const ALL_ATTRIBUTE_KINDS = ADD_MENU_ENTRIES.map((entry) => entry.attrType);

/** The kinds the definitions card can add: the last two of the menu above, on their own. */
const DEFINITION_KINDS: AttributeKind[] = [ "label-definition", "relation-definition" ];

function showAddMenu(e: MouseEvent, attrTypes: AttributeKind[], onSelect: (attrType: AttributeKind) => void) {
    const offered = ADD_MENU_ENTRIES.filter((entry) => attrTypes.includes(entry.attrType));
    const items: MenuItem<never>[] = [];

    for (const [ index, entry ] of offered.entries()) {
        // A definition is set apart from what it defines, where the two are offered together.
        if (index > 0 && isDefinition(entry.attrType) && !isDefinition(offered[index - 1].attrType)) {
            items.push({ kind: "separator" });
        }

        items.push({ title: entry.title, uiIcon: entry.icon, handler: () => onSelect(entry.attrType) });
    }

    void contextMenu.show({
        x: e.pageX,
        y: e.pageY,
        orientation: "left",
        items,
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
    const ownedEntries = owned.map((attribute) => toEntry(attribute, true));
    const inheritedEntries = inherited.map((attribute) => toEntry(attribute, false));

    return {
        owned: sortSystemLast(ownedEntries.filter((entry) => !isDefinitionEntry(entry))),
        inherited: sortSystemLast(inheritedEntries.filter((entry) => !isDefinitionEntry(entry))),
        definitions: sortSystemLast([ ...ownedEntries, ...inheritedEntries ].filter(isDefinitionEntry))
    };
}

function toEntry(attribute: Attribute, isOwned: boolean): AttributeEntry {
    return { attribute, isOwned, isSystem: isBuiltinAttribute(attribute.type, attribute.name) };
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

/**
 * The attributes Trilium writes for itself. They are bookkeeping rather than metadata — of interest
 * when working on Trilium and noise to everyone else — so they are collected in a development build
 * alone, as the attributes pane listed them in one before this panel took them over.
 */
function collectInternal(note: FNote | null | undefined): Attribute[] {
    return glob.isDev ? listInternal(note?.getOwnedAttributes() ?? []) : [];
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
 * The other half of what the note holds: exactly the attributes the two lists above leave out, which
 * Trilium wrote from the note's own content (a link in it is a `~internalLink`) and rewrites whenever
 * that content is saved. Only the note's own, an inherited one being the source note's bookkeeping.
 */
export function listInternal(ownedAttributes: FAttribute[]): Attribute[] {
    return ownedAttributes
        .filter((attribute) => attribute.isAutoLink)
        .toSorted((a, b) => a.position - b.position)
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
