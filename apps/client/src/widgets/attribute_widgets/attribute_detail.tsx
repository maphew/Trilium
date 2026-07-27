import "./attribute_detail.css";

import type { DefinitionObject, LabelType, Multiplicity } from "@triliumnext/commons";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

import appContext from "../../components/app_context.js";
import type { Attribute } from "../../services/attribute_parser.js";
import { isExperimentalFeatureEnabled } from "../../services/experimental_features.js";
import { focusSavedElement, saveFocusedElement } from "../../services/focus.js";
import froca from "../../services/froca.js";
import { t } from "../../services/i18n.js";
import promotedAttributeDefinitionParser from "../../services/promoted_attribute_definition_parser.js";
import server from "../../services/server.js";
import { isIMEComposing } from "../../services/shortcuts.js";
import utils from "../../services/utils.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import Button from "../react/Button.jsx";
import FormAutocomplete, { AUTOCOMPLETE_DROPDOWN_SELECTOR } from "../react/FormAutocomplete.jsx";
import FormCheckbox from "../react/FormCheckbox.jsx";
import FormSelect from "../react/FormSelect.jsx";
import FormTextBox, { FormTextBoxWithUnit } from "../react/FormTextBox.jsx";
import NoteAutocomplete from "../react/NoteAutocomplete.jsx";
import NoteLink from "../react/NoteLink.jsx";
import { disposeReactWidget, renderReactWidgetAtElement } from "../react/react_utils.jsx";

export interface AttributeDetailOpts {
    allAttributes?: Attribute[];
    attribute: Attribute;
    isOwned: boolean;
    x: number;
    y: number;
    focus?: "name";
    /**
     * The element the popup was spawned from. Mouse presses inside it do not dismiss the
     * popup, leaving the spawning widget free to swap the shown attribute on click.
     */
    parent?: HTMLElement;
    hideMultiplicity?: boolean;
}

/**
 * Transitional adapter keeping the legacy widget contract (`showAttributeDetail()`/`hide()`)
 * while the actual UI is progressively ported to the {@link AttributeDetail} Preact component.
 * Will be removed once the consumers can render the component directly.
 */
export default class AttributeDetailWidget extends NoteContextAwareWidget {
    private opts: AttributeDetailOpts | null = null;
    /** Bumped on every show so the form remounts with state seeded from the new attribute. */
    private showId = 0;

    doRender() {
        // No initial renderComponent() here: doRender() runs synchronously inside the
        // parent's render phase (via useLegacyWidget's useMemo), and a nested Preact
        // render() there corrupts the outer component's hook state.
        this.$widget = $("<div>");
    }

    async refresh() {
        // switching note/tab should close the widget
        this.hide();
    }

    async noteSwitched() {
        this.hide();
    }

    showAttributeDetail(opts: AttributeDetailOpts) {
        if (!opts.attribute) {
            // the attribute can be null at runtime, e.g. when the editor content fails to parse
            this.hide();
            return;
        }

        saveFocusedElement();

        this.opts = opts;
        this.showId++;
        // The widget has no note context, so isEnabled() is falsy and render()
        // stamps the container with hidden-int; visibility is driven manually,
        // exactly like the legacy widget did. The container must be visible
        // before rendering: the positioning layout effect runs synchronously
        // inside renderComponent() and needs to measure the popup.
        this.toggleInt(true);
        this.renderComponent();
    }

    hide() {
        this.opts = null;
        this.renderComponent();
        this.toggleInt(false);
    }

    cleanup() {
        disposeReactWidget(this.$widget[0]);
    }

    private async cancelAndClose() {
        await this.triggerCommand("reloadAttributes");

        this.hide();

        focusSavedElement();
    }

    private async saveAndClose() {
        await this.triggerCommand("saveAttributes");

        this.hide();

        focusSavedElement();
    }

    private async deleteAndClose() {
        await this.triggerCommand("updateAttributeList", {
            // the popup edits the very attribute object it was handed, so identity
            // is what identifies the attribute to remove
            attributes: (this.opts?.allAttributes ?? []).filter((attr) => attr !== this.opts?.attribute)
        });

        await this.triggerCommand("saveAttributes");

        this.hide();
    }

    private renderComponent() {
        renderReactWidgetAtElement(
            this,
            <AttributeDetail
                opts={this.opts}
                showId={this.showId}
                currentNoteId={this.noteId}
                parentOffset={this.parent?.$widget?.offset() ?? { top: 0, left: 0 }}
                onDismiss={() => this.hide()}
                onCancel={() => this.cancelAndClose()}
                onAttributesChanged={(attributes) => this.triggerCommand("updateAttributeList", { attributes })}
                onSaveAndClose={() => this.saveAndClose()}
                onDelete={() => this.deleteAndClose()}
            />,
            this.$widget[0]);
    }
}

interface AttributeDetailProps extends AttributeFormCallbacks {
    opts: AttributeDetailOpts | null;
    showId: number;
    /** The note being viewed, excluded from the related notes list. */
    currentNoteId?: string | null;
    /** Offset of the spawning widget, the reference point for classic-layout coordinates. */
    parentOffset: { top: number; left: number };
    /** Plain close, e.g. on click outside the popup. */
    onDismiss: () => void;
    /** Close discarding unsaved changes (close button, escape). */
    onCancel: () => void;
}

function AttributeDetail({ opts, showId, currentNoteId, parentOffset, onDismiss, onCancel, ...formCallbacks }: AttributeDetailProps) {
    const popupRef = useRef<HTMLDivElement>(null);
    const shown = !!opts;
    const { onSaveAndClose } = formCallbacks;

    // Positioning needs the popup's rendered size, so it runs after the DOM is
    // built but before paint.
    useLayoutEffect(() => {
        if (popupRef.current && opts) {
            positionPopup(popupRef.current, opts, parentOffset);
        }
    }, [ opts, parentOffset ]);

    // Dismiss on click outside the popup, except in floating UI logically belonging
    // to it (autocomplete dropdowns and context menus are appended to the body).
    // Unlike the legacy widget, the listener only exists while the popup is shown.
    const spawner = opts?.parent;
    useEffect(() => {
        if (!shown) {
            return;
        }

        const onMouseDown = (e: MouseEvent) => {
            if (!(e.target instanceof Element)
                || popupRef.current?.contains(e.target)
                // The spawning widget decides for itself on click whether to show another
                // attribute or close; dismissing here first would hide and immediately
                // re-show the popup, which reads as a flicker.
                || spawner?.contains(e.target)
                // Modals count as belonging to the popup: creating a note straight from the target
                // note field opens the note type chooser, and dismissing on its clicks would tear
                // the popup down before the created note could be filled in.
                || e.target.closest(`${AUTOCOMPLETE_DROPDOWN_SELECTOR}, .algolia-autocomplete, #context-menu-container, .modal, .modal-backdrop`)) {
                return;
            }
            onDismiss();
        };

        window.addEventListener("mousedown", onMouseDown);
        return () => window.removeEventListener("mousedown", onMouseDown);
    }, [ shown, spawner, onDismiss ]);

    if (!opts) {
        return null;
    }

    const attrType = getAttrType(opts.attribute);

    return (
        <div
            ref={popupRef}
            class="attr-detail tn-tool-dialog"
            // Handled here rather than through the shortcut service so the keys stay scoped
            // to the popup subtree and unbind with it.
            onKeyDown={(e) => {
                if (isIMEComposing(e)) {
                    return;
                }

                if (e.key === "Escape") {
                    e.stopPropagation();
                    onCancel();
                } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.stopPropagation();
                    onSaveAndClose();
                }
            }}
        >
            <div class="attr-detail-header">
                <h5 class="attr-detail-title">{attrType ? ATTR_TITLES[attrType] : ""}</h5>

                <button
                    class="close-attr-detail-button icon-action bx bx-x"
                    title={t("attribute_detail.close_button_title")}
                    onClick={onCancel}
                />
            </div>

            <AttributeForm key={showId} opts={opts} attrType={attrType} currentNoteId={currentNoteId} {...formCallbacks} />
        </div>
    );
}

interface AttributeFormCallbacks {
    /** Reports the edited attribute list back to the spawning widget, which re-renders from it. */
    onAttributesChanged: (attributes: Attribute[]) => void;
    onSaveAndClose: () => void;
    onDelete: () => void;
}

/**
 * The editable part of the popup. Remounted per show (keyed on `showId`) so the field state is
 * simply seeded from the attribute instead of being synchronized to it on every change.
 */
function AttributeForm({ opts, attrType, currentNoteId, onAttributesChanged, onSaveAndClose, onDelete }: AttributeFormCallbacks & {
    opts: AttributeDetailOpts;
    attrType: AttrType;
    currentNoteId?: string | null;
}) {
    const { attribute, allAttributes, isOwned, focus } = opts;
    // Definitions describe the attribute they define, so they complete against its own type.
    const suggestAttributeNames = useCallback((query: string) => {
        const type = attrType === "relation" || attrType === "relation-definition" ? "relation" : "label";
        return server.get<string[]>(`attribute-names/?type=${type}&query=${encodeURIComponent(query)}`);
    }, [ attrType ]);
    const [ name, setName ] = useState(() => stripDefinitionPrefix(attribute.name, attrType));
    const [ value, setValue ] = useState(attribute.value ?? "");
    const [ isInheritable, setIsInheritable ] = useState(!!attribute.isInheritable);
    const [ definition, setDefinition ] = useState(() => parseDefinition(attribute, attrType));
    const nameRef = useRef<HTMLInputElement>(null);
    // The values known for a label name never change while the popup is open, so they are fetched
    // once per name and filtered locally afterwards.
    const knownValues = useRef<{ name: string; values: string[] }>();
    const suggestLabelValues = useCallback(async (query: string) => {
        if (!name.trim()) {
            return [];
        }

        if (knownValues.current?.name !== name) {
            knownValues.current = {
                name,
                values: await server.get<string[]>(`attribute-values/${encodeURIComponent(name)}`)
            };
        }

        const term = query.toLowerCase();
        return knownValues.current.values.filter((value) => value.toLowerCase().includes(term));
    }, [ name ]);
    // Committing mid-composition makes the spawning editor re-render and swallow the
    // characters being composed: https://github.com/zadam/trilium/pull/3812
    const isComposing = useRef(false);

    useEffect(() => {
        if (focus === "name") {
            nameRef.current?.focus();
            nameRef.current?.select();
        }
    }, [ focus ]);

    // The attribute object is shared with the spawning widget: it is edited in place so that
    // its identity survives, which is how the delete path recognizes it.
    function commitName(newName: string) {
        // invalid characters are simply ignored (from the user's perspective they are not even entered)
        const filteredName = utils.filterAttributeName(newName);

        setName(filteredName);
        attribute.name = addDefinitionPrefix(filteredName, attrType);
        onAttributesChanged(allAttributes ?? []);
    }

    function commitValue(newValue: string) {
        setValue(newValue);
        attribute.value = newValue;
        onAttributesChanged(allAttributes ?? []);
    }

    /** Definitions keep their settings serialized in the value, so any change rebuilds the whole thing. */
    function commitDefinition(changes: Partial<DefinitionObject>) {
        const newDefinition = { ...definition, ...changes };

        setDefinition(newDefinition);
        attribute.value = buildDefinitionValue(newDefinition, attrType);
        onAttributesChanged(allAttributes ?? []);
    }

    // A relation stores the target note's id as its value; clearing the field clears the target.
    const commitTargetNote = useCallback((targetNoteId?: string) => {
        attribute.value = targetNoteId ?? "";
        onAttributesChanged(allAttributes ?? []);
    }, [ attribute, allAttributes, onAttributesChanged ]);

    return (
        <>
            <table class="attr-edit-table">
                <tbody>
                    <tr title={t("attribute_detail.attr_name_title")}>
                        <th>{t("attribute_detail.name")}</th>
                        <td>
                            <FormAutocomplete
                                className="attr-input-name"
                                inputRef={nameRef}
                                currentValue={name}
                                readOnly={!isOwned}
                                source={suggestAttributeNames}
                                openOnFocus
                                onChange={(newName) => isComposing.current ? setName(newName) : commitName(newName)}
                                onCompositionStart={() => isComposing.current = true}
                                onCompositionEnd={(e) => {
                                    isComposing.current = false;
                                    commitName(e.currentTarget.value);
                                }}
                            />
                        </td>
                    </tr>

                    {attrType === "relation" && (
                        <tr class="attr-row-target-note">
                            <th title={t("attribute_detail.target_note_title")}>{t("attribute_detail.target_note")}</th>
                            <td>
                                <NoteAutocomplete
                                    noteId={attribute.value || undefined}
                                    readOnly={!isOwned}
                                    opts={TARGET_NOTE_OPTS}
                                    noteIdChanged={commitTargetNote}
                                />
                            </td>
                        </tr>
                    )}

                    {attrType === "label" && (
                        <tr class="attr-row-value">
                            <th>{t("attribute_detail.value")}</th>
                            <td>
                                <FormAutocomplete
                                    className="attr-input-value"
                                    currentValue={value}
                                    readOnly={!isOwned}
                                    source={suggestLabelValues}
                                    openOnFocus
                                    onChange={(newValue) => isComposing.current ? setValue(newValue) : commitValue(newValue)}
                                    onCompositionStart={() => isComposing.current = true}
                                    onCompositionEnd={(e) => {
                                        isComposing.current = false;
                                        commitValue(e.currentTarget.value);
                                    }}
                                />
                            </td>
                        </tr>
                    )}

                    {isDefinition(attrType) && (
                        <tr class="attr-row-promoted" title={t("attribute_detail.promoted_title")}>
                            <th></th>
                            <td>
                                <FormCheckbox
                                    label={t("attribute_detail.promoted")}
                                    currentValue={!!definition.isPromoted}
                                    disabled={!isOwned}
                                    onChange={(isPromoted) => commitDefinition({ isPromoted })}
                                />
                            </td>
                        </tr>
                    )}

                    {isDefinition(attrType) && definition.isPromoted && (
                        <tr class="attr-row-promoted-alias">
                            <th title={t("attribute_detail.promoted_alias_title")}>{t("attribute_detail.promoted_alias")}</th>
                            <td>
                                <FormTextBox
                                    className="attr-input-promoted-alias"
                                    currentValue={definition.promotedAlias ?? ""}
                                    disabled={!isOwned}
                                    onChange={(promotedAlias) => commitDefinition({ promotedAlias })}
                                />
                            </td>
                        </tr>
                    )}

                    {isDefinition(attrType) && !opts.hideMultiplicity && (
                        <tr class="attr-row-multiplicity">
                            <th title={t("attribute_detail.multiplicity_title")}>{t("attribute_detail.multiplicity")}</th>
                            <td>
                                <FormSelect
                                    className="attr-input-multiplicity"
                                    values={MULTIPLICITIES}
                                    keyProperty="value"
                                    titleProperty="title"
                                    currentValue={definition.multiplicity ?? "single"}
                                    disabled={!isOwned}
                                    onChange={(multiplicity) => commitDefinition({ multiplicity: multiplicity as Multiplicity })}
                                />
                            </td>
                        </tr>
                    )}

                    {attrType === "label-definition" && (
                        <tr class="attr-row-label-type">
                            <th title={t("attribute_detail.label_type_title")}>{t("attribute_detail.label_type")}</th>
                            <td>
                                <FormSelect
                                    className="attr-input-label-type"
                                    values={LABEL_TYPES}
                                    keyProperty="value"
                                    titleProperty="title"
                                    currentValue={definition.labelType ?? "text"}
                                    disabled={!isOwned}
                                    onChange={(labelType) => commitDefinition({ labelType: labelType as LabelType })}
                                />
                            </td>
                        </tr>
                    )}

                    {attrType === "label-definition" && definition.labelType === "number" && (
                        <tr class="attr-row-number-precision">
                            <th title={t("attribute_detail.precision_title")}>{t("attribute_detail.precision")}</th>
                            <td>
                                <FormTextBoxWithUnit
                                    className="attr-input-number-precision"
                                    type="number"
                                    min={0}
                                    unit={t("attribute_detail.digits")}
                                    currentValue={definition.numberPrecision?.toString() ?? ""}
                                    disabled={!isOwned}
                                    onChange={(precision) => commitDefinition({
                                        numberPrecision: precision === "" ? undefined : parseInt(precision, 10)
                                    })}
                                />
                            </td>
                        </tr>
                    )}

                    {attrType === "relation-definition" && (
                        <tr class="attr-row-inverse-relation">
                            <th title={t("attribute_detail.inverse_relation_title")}>{t("attribute_detail.inverse_relation")}</th>
                            <td>
                                <FormTextBox
                                    className="attr-input-inverse-relation"
                                    currentValue={definition.inverseRelation ?? ""}
                                    disabled={!isOwned}
                                    onChange={(inverseRelation) => commitDefinition({
                                        // A relation name, so the same characters are dropped as in the name field
                                        inverseRelation: utils.filterAttributeName(inverseRelation)
                                    })}
                                />
                            </td>
                        </tr>
                    )}

                    <tr title={t("attribute_detail.inheritable_title")}>
                        <th></th>
                        <td>
                            <FormCheckbox
                                label={t("attribute_detail.inheritable")}
                                currentValue={isInheritable}
                                disabled={!isOwned}
                                onChange={(checked) => {
                                    setIsInheritable(checked);
                                    attribute.isInheritable = checked;
                                    onAttributesChanged(allAttributes ?? []);
                                }}
                            />
                        </td>
                    </tr>
                </tbody>
            </table>

            {isOwned && (
                <div class="attr-save-delete-button-container">
                    <Button
                        className="attr-save-changes-and-close-button"
                        kind="primary"
                        size="small"
                        text={t("attribute_detail.save_and_close_button")}
                        keyboardShortcut="Ctrl+Enter"
                        onClick={onSaveAndClose}
                    />

                    <Button
                        className="attr-delete-button"
                        size="small"
                        text={t("attribute_detail.delete")}
                        onClick={onDelete}
                    />
                </div>
            )}

            <RelatedNotes attribute={attribute} currentNoteId={currentNoteId} />
        </>
    );
}

/** Constant so it does not re-initialise the autocomplete on every render. */
const TARGET_NOTE_OPTS = { allowCreatingNotes: true };

const MULTIPLICITIES = [
    { value: "single", title: t("attribute_detail.single_value") },
    { value: "multi", title: t("attribute_detail.multi_value") }
];

const LABEL_TYPES = [
    { value: "text", title: t("attribute_detail.text") },
    { value: "textarea", title: t("attribute_detail.textarea") },
    { value: "number", title: t("attribute_detail.number") },
    { value: "boolean", title: t("attribute_detail.boolean") },
    { value: "date", title: t("attribute_detail.date") },
    { value: "datetime", title: t("attribute_detail.date_time") },
    { value: "time", title: t("attribute_detail.time") },
    { value: "url", title: t("attribute_detail.url") },
    { value: "color", title: t("attribute_detail.color_type") }
];

function isDefinition(attrType: AttrType) {
    return attrType === "label-definition" || attrType === "relation-definition";
}

function parseDefinition(attribute: Attribute, attrType: AttrType): DefinitionObject {
    return isDefinition(attrType) ? promotedAttributeDefinitionParser.parse(attribute.value || "") : {};
}

/**
 * Serializes a definition back into the comma separated form stored in the attribute value, e.g.
 * `promoted,alias=Foo,single,number,precision=2`.
 *
 * Unlike the legacy widget, the multiplicity and label type always land in the output with their
 * effective defaults rather than as an empty token, which the parser only warned about.
 */
function buildDefinitionValue(definition: DefinitionObject, attrType: AttrType) {
    const props: string[] = [];

    if (definition.isPromoted) {
        props.push("promoted");

        if (definition.promotedAlias) {
            props.push(`alias=${definition.promotedAlias}`);
        }
    }

    props.push(definition.multiplicity ?? "single");

    if (attrType === "label-definition") {
        const labelType = definition.labelType ?? "text";
        props.push(labelType);

        if (labelType === "number" && definition.numberPrecision !== undefined) {
            props.push(`precision=${definition.numberPrecision}`);
        }
    } else if (definition.inverseRelation?.trim()) {
        props.push(`inverse=${utils.filterAttributeName(definition.inverseRelation)}`);
    }

    return props.join(",");
}

const DISPLAYED_NOTES = 10;
/** Edits keep arriving while typing, so the lookup waits for a pause instead of running per keystroke. */
const RELATED_NOTES_DEBOUNCE_MS = 1000;

interface SearchRelatedResponse {
    // TODO: Deduplicate once we split client from server.
    results: {
        noteId: string;
        notePathArray: string[];
    }[];
    count: number;
}

/** Lists the other notes carrying the same attribute, hidden entirely when there are none. */
function RelatedNotes({ attribute, currentNoteId }: { attribute: Attribute; currentNoteId?: string | null }) {
    const [ related, setRelated ] = useState<{ notePaths: string[]; moreCount: number }>();
    const latestRequest = useRef(0);
    const isInitialLookup = useRef(true);
    const { type, name, value } = attribute;

    useEffect(() => {
        const requestId = ++latestRequest.current;

        async function lookup() {
            const { results, count } = await server.post<SearchRelatedResponse>("search-related", attribute);
            const otherNotes = results.filter((result) => result.notePathArray.at(-1) !== currentNoteId);
            const notes = await froca.getNotes(otherNotes
                .slice(0, DISPLAYED_NOTES)
                .map((result) => result.notePathArray.at(-1) ?? ""));

            // A newer edit superseded this lookup while it was awaiting.
            if (latestRequest.current !== requestId) {
                return;
            }

            const hoistedNoteId = appContext.tabManager.getActiveContext()?.hoistedNoteId;
            setRelated({
                notePaths: notes.map((note) => note.getBestNotePathString(hoistedNoteId)),
                // Counted against the server's total, so it also covers what the search itself capped.
                moreCount: otherNotes.length > DISPLAYED_NOTES ? count - DISPLAYED_NOTES : 0
            });
        }

        // The attribute the popup opened on is looked up right away; later edits are debounced.
        if (isInitialLookup.current) {
            isInitialLookup.current = false;
            void lookup();
            return;
        }

        const timeout = setTimeout(() => void lookup(), RELATED_NOTES_DEBOUNCE_MS);
        return () => clearTimeout(timeout);
        // `attribute` is edited in place, so its fields rather than its identity are the real inputs.
    }, [ type, name, value, currentNoteId ]); // eslint-disable-line react-hooks/exhaustive-deps

    if (!related?.notePaths.length) {
        return null;
    }

    return (
        <div class="related-notes-container">
            <h5 class="related-notes-title">
                {t("attribute_detail.other_notes_with_name", { attributeType: type, attributeName: name })}
            </h5>

            <ul class="related-notes-list">
                {related.notePaths.map((notePath) => (
                    <li key={notePath}><NoteLink notePath={notePath} showNotePath /></li>
                ))}
            </ul>

            {related.moreCount > 0 && (
                <div class="related-notes-more-notes">
                    {t("attribute_detail.and_more", { count: related.moreCount })}
                </div>
            )}
        </div>
    );
}

const ATTR_TITLES: Record<string, string> = {
    label: t("attribute_detail.label"),
    "label-definition": t("attribute_detail.label_definition"),
    relation: t("attribute_detail.relation"),
    "relation-definition": t("attribute_detail.relation_definition")
};

const isNewLayout = isExperimentalFeatureEnabled("new-layout");

function positionPopup(popup: HTMLElement, { x, y }: AttributeDetailOpts, parentOffset: { top: number; left: number }) {
    const outerWidth = popup.offsetWidth;
    const outerHeight = popup.offsetHeight;
    const windowHeight = document.documentElement.clientHeight;

    if (!outerWidth || !outerHeight || !windowHeight) {
        console.warn("Can't position popup, is it attached?");
        return;
    }

    if (isNewLayout) {
        // The popup always sits above the note attributes pane so it never covers it;
        // when the pane is closed (e.g. opened from the collection column editor),
        // it docks to the status bar instead.
        const attrPane = document.querySelector(".bottom-panel.attribute-list");
        const paneShown = attrPane instanceof HTMLElement && !attrPane.classList.contains("hidden-ext");
        const anchorTop = paneShown
            ? attrPane.getBoundingClientRect().top
            : document.body.clientHeight - (document.querySelector<HTMLElement>(".component.status-bar")?.offsetHeight ?? 0);

        // Centered on the click, clamped to the viewport. Deliberately not using
        // getDetailPosition(): its legacy right-pin quirk reads as a plain 0 here,
        // which kept the popup flush left regardless of the click position.
        const windowWidth = document.documentElement.clientWidth;
        const left = Math.max(Math.min(x - outerWidth / 2, windowWidth - outerWidth - 10), 10);

        popup.style.left = `${left}px`;
        popup.style.right = "";
        popup.style.top = "unset";
        popup.style.bottom = `${document.body.clientHeight - anchorTop}px`;
        popup.style.maxHeight = `${anchorTop}px`;
    } else {
        const detPosition = getDetailPosition(x, parentOffset.left, outerWidth);

        popup.style.left = toCssPos(detPosition.left);
        popup.style.right = toCssPos(detPosition.right);
        popup.style.top = `${y - parentOffset.top + 70}px`;
        popup.style.bottom = "";
        popup.style.maxHeight = outerHeight + y > windowHeight - 50 ? `${windowHeight - y - 50}px` : "10000px";
    }
}

function getDetailPosition(x: number, offsetLeft: number, outerWidth: number) {
    let left: number | string = x - offsetLeft - outerWidth / 2;
    let right: number | string = "";

    if (left < 0) {
        left = 10;
    } else {
        const rightEdge = left + outerWidth;

        // Kept bug-for-bug from the legacy widget: this compares against the popup's own
        // width instead of the viewport's, so it holds whenever left >= 0 and the popup
        // effectively pins to the right edge except for far-left clicks.
        if (rightEdge > outerWidth - 10) {
            left = "";
            right = 10;
        }
    }

    return { left, right };
}

/** An empty string clears the property, matching the jQuery `.css()` behavior. */
function toCssPos(value: number | string) {
    return typeof value === "number" ? `${value}px` : value;
}

type AttrType = "label" | "label-definition" | "relation" | "relation-definition" | undefined;

function getAttrType(attribute: Attribute): AttrType {
    if (attribute.type === "label") {
        if (attribute.name.startsWith("label:")) {
            return "label-definition";
        } else if (attribute.name.startsWith("relation:")) {
            return "relation-definition";
        }
        return "label";
    } else if (attribute.type === "relation") {
        return "relation";
    }
}

/** Definitions are stored prefixed (`label:foo`), but the popup edits the bare name. */
function stripDefinitionPrefix(name: string, attrType: AttrType) {
    if (attrType === "label-definition") {
        return name.substring("label:".length);
    } else if (attrType === "relation-definition") {
        return name.substring("relation:".length);
    }
    return name;
}

function addDefinitionPrefix(name: string, attrType: AttrType) {
    if (attrType === "label-definition") {
        return `label:${name}`;
    } else if (attrType === "relation-definition") {
        return `relation:${name}`;
    }
    return name;
}
