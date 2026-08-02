import "./MindMapNodePanel.css";

import { Dropdown as BootstrapDropdown } from "bootstrap";
import type { MindElixirInstance, NodeObj, TagObj } from "mind-elixir";
import { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";

import { t } from "../../services/i18n";
import note_autocomplete from "../../services/note_autocomplete";
import tree from "../../services/tree";
import ValuesInput from "../attribute_widgets/values_input";
import ColorPicker, { DEFAULT_COLOR_PALETTE } from "../react/ColorPicker";
import Dropdown from "../react/Dropdown";
import { FormListItem } from "../react/FormList";
import { useNote, useNoteIcon, useNoteTitle } from "../react/hooks";
import Icon from "../react/Icon";
import IconPicker from "../react/IconPicker";
import NoteAutocomplete from "../react/NoteAutocomplete";
import { refToJQuerySelector } from "../react/react_utils";
import SegmentedChoice from "../react/SegmentedChoice";
import { describeExternalLink, getLinkedNotePath, linkFromSuggestion } from "./helpers/mind_map_links";

/**
 * The hues offered by the panel: as many of the shared palette as fit on a single row next to the
 * clear and custom cells.
 */
export const NODE_COLORS = [0, 1, 2, 4, 7, 9].map((index) => DEFAULT_COLOR_PALETTE[index]);

/**
 * Backgrounds are the same hues at a quarter opacity. That keeps a node readable when its text and
 * its background are set to "the same" color, and lets a single set of swatches sit well on both
 * the light and the dark map theme, since the tint takes on whatever the canvas is.
 */
export const NODE_BACKGROUND_COLORS = NODE_COLORS.map((color) => `${color}40`);

interface MindMapNodePanelProps {
    mind: MindElixirInstance;
    /** The currently selected nodes; the panel edits all of them at once. */
    nodes: NodeObj[];
}

/**
 * Floating panel displayed over a mind map while at least one node is selected, holding the
 * formatting controls for the selection.
 */
export default function MindMapNodePanel({ mind, nodes }: MindMapNodePanelProps) {
    const fontSize = getCommonValue(nodes, (node) => node.style?.fontSize);
    const textColor = getCommonValue(nodes, (node) => node.style?.color);
    const backgroundColor = getCommonValue(nodes, (node) => node.style?.background);
    const branchColor = getCommonValue(nodes, (node) => node.branchColor);
    const icon = getCommonValue(nodes, (node) => node.icons?.[0]);
    const link = getCommonValue(nodes, (node) => node.hyperLink);
    const tags = gatherTags(nodes);

    /**
     * Applies a patch to every selected node. The selection is read back from the instance rather
     * than taken from the props, so that the elements the patch is applied to are the live ones.
     * The patch may be derived per node, for what is written depending on what a node already has.
     */
    function patchSelectedNodes(patch: Partial<NodeObj> | ((node: NodeObj) => Partial<NodeObj>)) {
        for (const topic of mind.currentNodes) {
            mind.reshapeNode(topic, typeof patch === "function" ? patch(topic.nodeObj) : patch);
        }
    }

    return (
        <div
            className="mind-map-node-panel"
            /* Keep interactions inside the panel from reaching the map underneath. */
            onMouseDown={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
        >
            <PanelSection label={t("mind-map.font-size")}>
                <SegmentedChoice
                    options={buildFontSizeOptions()}
                    currentValue={fontSize !== MIXED ? fontSize ?? DEFAULT_FONT_SIZE : MIXED_FONT_SIZE}
                    onChange={(fontSize) => patchSelectedNodes({ style: { fontSize } })}
                />
            </PanelSection>

            <PanelSection label={t("mind-map.text-color")}>
                <ColorPicker
                    presets={NODE_COLORS}
                    {...toPickerValue(textColor)}
                    // Mind Elixir only ever assigns the style properties it is given and never
                    // resets the ones it isn't, so clearing has to blank the property explicitly.
                    onChange={(color) => patchSelectedNodes({ style: { color: color ?? "" } })}
                />
            </PanelSection>

            <PanelSection label={t("mind-map.background-color")}>
                <ColorPicker
                    presets={NODE_BACKGROUND_COLORS}
                    {...toPickerValue(backgroundColor)}
                    onChange={(color) => patchSelectedNodes({ style: { background: color ?? "" } })}
                />
            </PanelSection>

            <PanelSection label={t("mind-map.branch-color")}>
                <ColorPicker
                    presets={NODE_COLORS}
                    {...toPickerValue(branchColor)}
                    onChange={(color) => patchSelectedNodes({ branchColor: color ?? "" })}
                />
            </PanelSection>

            <PanelSection label={t("mind-map.icon")}>
                <NodeIcon
                    currentValue={icon !== MIXED ? icon : null}
                    // A node takes one icon, like a note does, so what is picked replaces what was
                    // there rather than joining it.
                    onSelect={(iconClass) => patchSelectedNodes({ icons: [ iconClass ] })}
                    onClear={() => patchSelectedNodes({ icons: [] })}
                />
            </PanelSection>

            <PanelSection
                label={t("mind-map.node-link")}
                title={link === MIXED ? t("mind-map.links-differ") : undefined}
            >
                <NodeLink
                    currentValue={link !== MIXED ? link : null}
                    indeterminate={link === MIXED}
                    // A node carries one link, so what is picked takes the place of what was there.
                    // Clearing blanks the property, Mind Elixir only ever assigning the ones it is
                    // given (see the colors above).
                    onChange={(link) => patchSelectedNodes({ hyperLink: link ?? "" })}
                />
            </PanelSection>

            <PanelSection
                label={t("mind-map.tags")}
                title={tags.readOnly ? t("mind-map.tags-differ") : undefined}
            >
                <ValuesInput
                    labelType="text"
                    values={tags.texts}
                    placeholder={t("mind-map.tags-placeholder")}
                    addButtonText={t("mind-map.add-tag")}
                    removeButtonText={t("mind-map.remove-tag")}
                    disabled={tags.readOnly}
                    // Derived per node: the nodes agree on the texts, but each may dress its own
                    // tags differently, and that is kept by reading from the node being written to.
                    onCommit={(texts) => patchSelectedNodes((node) => ({ tags: applyTagTexts(node.tags, texts) }))}
                />
            </PanelSection>
        </div>
    );
}

/**
 * A node of medium size is one with no size of its own: that is what a node comes with, and it
 * leaves the root, which is larger by default, at the size its level implies rather than pinning
 * it to the size of an ordinary node.
 */
export const DEFAULT_FONT_SIZE = "";

/** Matches none of the sizes, for a selection whose nodes are not all of the same size. */
const MIXED_FONT_SIZE = "mixed";

/** The sizes a node can be given, after the ones the canvas note type offers. */
function buildFontSizeOptions() {
    return [
        { value: "12px", label: t("mind-map.font-size-small") },
        { value: DEFAULT_FONT_SIZE, label: t("mind-map.font-size-medium") },
        { value: "24px", label: t("mind-map.font-size-large") },
        { value: "32px", label: t("mind-map.font-size-extra-large") }
    ];
}

/**
 * What the tag field stands for, given the selection.
 *
 * Tags belong to a node rather than to a shape the selection shares, so a field standing for
 * several of them can only be edited where they already agree — one node always does. Where they
 * don't, the field shows everything the selection carries between them, for reading: taking a tag
 * as read would mean writing one node's tags over another's.
 */
export function gatherTags(nodes: NodeObj[]): { texts: string[], readOnly: boolean } {
    const perNode = nodes.map((node) => (node.tags ?? []).map(getTagText));
    const [ first = [], ...rest ] = perNode;

    if (rest.every((texts) => texts.length === first.length && texts.every((text) => first.includes(text)))) {
        return { texts: first, readOnly: false };
    }

    // In the order they are first met, so that the tags of the node selected first lead.
    return { texts: [ ...new Set(perNode.flat()) ], readOnly: true };
}

/** The text a tag reads as, whether it carries a style of its own or is only the text. */
export function getTagText(tag: string | TagObj) {
    return typeof tag === "string" ? tag : tag.text;
}

/**
 * Turns the texts a node is now tagged with back into tags. A tag that carries a style of its own
 * is kept as it was for as long as its text is, so that a map made elsewhere doesn't lose the
 * styling of its tags to one being added beside them.
 */
export function applyTagTexts(tags: NodeObj["tags"], texts: string[]): (string | TagObj)[] {
    return texts.map((text) => tags?.find((tag) => getTagText(tag) === text) ?? text);
}

/** Turns the outcome of {@link getCommonValue} into the matching {@link ColorPicker} state. */
function toPickerValue(value: string | null | typeof MIXED) {
    return {
        currentValue: (value !== MIXED ? value : null),
        indeterminate: (value === MIXED)
    };
}

/**
 * The icon a node wears, chosen through the picker every other icon in Trilium is chosen through.
 *
 * The picker is only built once opened: it holds every icon of every installed pack, which is far
 * more work than a panel that merely happens to be on screen should be doing.
 */
function NodeIcon({ currentValue, onSelect, onClear }: {
    currentValue: string | null;
    onSelect(iconClass: string): void;
    onClear(): void;
}) {
    const dropdownRef = useRef<BootstrapDropdown>(null);
    const [ pickerShown, setPickerShown ] = useState(false);

    return (
        <Dropdown
            // The legacy class dresses the menu the picker sits in, which the themes and the
            // picker's own stylesheet reach through it.
            className="mind-map-node-icon note-icon-widget"
            buttonClassName={`note-icon tn-focusable-button ${currentValue ?? "bx bx-empty"}`}
            title={t("mind-map.choose-icon")}
            dropdownRef={dropdownRef}
            dropdownContainerStyle={{ width: "620px" }}
            dropdownOptions={{ autoClose: "outside" }}
            // The panel scrolls, and the picker is wider than the panel is; hand the menu to the
            // page instead of leaving it to be clipped.
            portalToBody
            hideToggleArrow
            onShown={() => setPickerShown(true)}
            onHidden={() => setPickerShown(false)}
        >
            {pickerShown && (
                <IconPicker
                    columnCount={12}
                    resetText={t("mind-map.clear-icon")}
                    onSelect={(iconClass) => {
                        onSelect(iconClass);
                        dropdownRef.current?.hide();
                    }}
                    onReset={currentValue ? () => {
                        onClear();
                        dropdownRef.current?.hide();
                    } : undefined}
                />
            )}
        </Dropdown>
    );
}

/** Kept still, so that the autocomplete is not built anew every time the panel renders. */
const LINK_AUTOCOMPLETE_OPTIONS = { allowExternalLinks: true };

/**
 * The link a node carries: a note, or a page outside Trilium — one field, a node carrying one link.
 *
 * The picker sits in a menu rather than in the panel itself: it is the field a note is picked
 * through everywhere else in Trilium, and it wants more room than a panel this narrow can give it.
 */
function NodeLink({ currentValue, indeterminate, onChange }: {
    currentValue: string | null;
    indeterminate: boolean;
    onChange(link: string | null): void;
}) {
    const dropdownRef = useRef<BootstrapDropdown>(null);
    const inputRef = useRef<HTMLInputElement>(null);
    const pickerRef = useRef<HTMLDivElement>(null);
    const [ pickerShown, setPickerShown ] = useState(false);

    // Opened on the notes last visited, which are the likeliest thing to be linking to and what the
    // add-link dialog opens on as well. Once the picker is up, so that there is a field to fill.
    useEffect(() => {
        if (!pickerShown || !inputRef.current) return;
        const $input = refToJQuerySelector(inputRef);
        note_autocomplete.showRecentNotes($input);
        $input.trigger("focus");
    }, [ pickerShown ]);

    function commit(link: string | null) {
        onChange(link);
        dropdownRef.current?.hide();
    }

    return (
        <Dropdown
            className="mind-map-node-link"
            text={<NodeLinkFace link={currentValue} indeterminate={indeterminate} />}
            title={t("mind-map.choose-link")}
            dropdownRef={dropdownRef}
            dropdownContainerStyle={{ width: "360px" }}
            // The suggestions land inside the menu, so picking one is not the click outside that
            // would take the menu down before the pick is made.
            dropdownOptions={{ autoClose: "outside" }}
            // The panel scrolls, and the picker is wider than the panel is; hand the menu to the
            // page instead of leaving it to be clipped.
            portalToBody
            onShown={() => setPickerShown(true)}
            onHidden={() => setPickerShown(false)}
        >
            {pickerShown && (
                <div className="mind-map-node-link-picker" ref={pickerRef}>
                    <NoteAutocomplete
                        inputRef={inputRef}
                        container={pickerRef}
                        placeholder={t("mind-map.link-placeholder")}
                        opts={LINK_AUTOCOMPLETE_OPTIONS}
                        // Only a pick is worth taking: the field is also cleared as one types, and
                        // the way back to no link at all is the one offered below.
                        onChange={(suggestion) => {
                            const link = linkFromSuggestion(suggestion);
                            if (link) commit(link);
                        }}
                    />

                    {(currentValue || indeterminate) && (
                        <FormListItem
                            icon="bx bx-unlink"
                            onClick={() => commit(null)}
                        >{t("mind-map.clear-link")}</FormListItem>
                    )}
                </div>
            )}
        </Dropdown>
    );
}

/** What the button says the selection is linked to. */
function NodeLinkFace({ link, indeterminate }: { link: string | null, indeterminate: boolean }) {
    if (indeterminate) {
        return <><Icon icon="bx bx-link" /><span className="mind-map-node-link-label mind-map-node-link-mixed">{t("mind-map.link-mixed")}</span></>;
    }

    const notePath = getLinkedNotePath(link);
    if (notePath) {
        return <LinkedNoteFace notePath={notePath} />;
    }

    if (link) {
        return <><Icon icon="bx bx-link-external" /><span className="mind-map-node-link-label">{describeExternalLink(link)}</span></>;
    }

    return <><Icon icon="bx bx-link" /><span className="mind-map-node-link-label mind-map-node-link-empty">{t("mind-map.add-link")}</span></>;
}

/** A linked note as it is named and dressed now, rather than as it was when it was linked. */
function LinkedNoteFace({ notePath }: { notePath: string }) {
    const { noteId, parentNoteId } = tree.getNoteIdAndParentIdFromUrl(notePath);
    const note = useNote(noteId);
    const title = useNoteTitle(noteId, parentNoteId);
    const icon = useNoteIcon(note);

    // The title is read asynchronously; until it lands, what is already known of the note stands in
    // for it, rather than the address the panel would otherwise have to show.
    return <><Icon icon={icon} /><span className="mind-map-node-link-label">{title ?? note?.title ?? ""}</span></>;
}

function PanelSection({ label, title, children }: { label: string, title?: string, children: ComponentChildren }) {
    return (
        <div className="mind-map-node-panel-section" title={title}>
            <div className="mind-map-node-panel-section-label">{label}</div>
            {children}
        </div>
    );
}

/** Returned instead of a value when the selected nodes don't agree on one. */
export const MIXED = Symbol("mixed");

/**
 * Reads one property off every given node, returning the value they share, `null` if none of them
 * has one, or {@link MIXED} if they disagree. Values that are unset and values that were blanked
 * out (see {@link MindMapNodePanel}) count as the same thing.
 */
export function getCommonValue(nodes: NodeObj[], read: (node: NodeObj) => string | undefined): string | null | typeof MIXED {
    let common: string | null | undefined;

    for (const node of nodes) {
        const value = read(node) || null;
        if (common === undefined) {
            common = value;
        } else if (common !== value) {
            return MIXED;
        }
    }

    return common ?? null;
}
