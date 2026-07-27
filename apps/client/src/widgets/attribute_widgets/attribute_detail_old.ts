import type { Attribute } from "../../services/attribute_parser.js";
import froca from "../../services/froca.js";
import { t } from "../../services/i18n.js";
import linkService from "../../services/link.js";
import noteAutocompleteService from "../../services/note_autocomplete.js";
import promotedAttributeDefinitionParser from "../../services/promoted_attribute_definition_parser.js";
import utils, { openInAppHelpFromUrl } from "../../services/utils.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import { ATTR_HELP } from "./attr_help.js";
import type { AttributeDetailOpts } from "./attribute_detail.jsx";

const TPL = /*html*/`
<div>
    <div class="attr-is-owned-by">${t("attribute_detail.attr_is_owned_by")}</div>

    <table class="attr-edit-table">
        <tr class="attr-help"></tr>
        <tr class="attr-row-target-note">
            <th title="${t("attribute_detail.target_note_title")}">${t("attribute_detail.target_note")}</th>
            <td>
                <div class="input-group">
                    <input type="text" class="attr-input-target-note form-control" />
                </div>
            </td>
        </tr>
        <tr class="attr-row-promoted"
            title="${t("attribute_detail.promoted_title")}">
            <th></th>
            <td>
                <label class="tn-checkbox">
                    <input type="checkbox" class="attr-input-promoted" />
                    ${t("attribute_detail.promoted")}
                </label>
            </td>
        </tr>
        <tr class="attr-row-promoted-alias">
            <th title="${t("attribute_detail.promoted_alias_title")}">${t("attribute_detail.promoted_alias")}</th>
            <td>
                <div class="input-group">
                    <input type="text" class="attr-input-promoted-alias form-control" />
                </div>
            </td>
        </tr>
        <tr class="attr-row-multiplicity">
            <th title="${t("attribute_detail.multiplicity_title")}">${t("attribute_detail.multiplicity")}</th>
            <td>
                <select class="attr-input-multiplicity form-control">
                  <option value="single">${t("attribute_detail.single_value")}</option>
                  <option value="multi">${t("attribute_detail.multi_value")}</option>
                </select>
            </td>
        </tr>
        <tr class="attr-row-label-type">
            <th title="${t("attribute_detail.label_type_title")}">${t("attribute_detail.label_type")}</th>
            <td>
                <select class="attr-input-label-type form-control">
                  <option value="text">${t("attribute_detail.text")}</option>
                  <option value="textarea">${t("attribute_detail.textarea")}</option>
                  <option value="number">${t("attribute_detail.number")}</option>
                  <option value="boolean">${t("attribute_detail.boolean")}</option>
                  <option value="date">${t("attribute_detail.date")}</option>
                  <option value="datetime">${t("attribute_detail.date_time")}</option>
                  <option value="time">${t("attribute_detail.time")}</option>
                  <option value="url">${t("attribute_detail.url")}</option>
                  <option value="color">${t("attribute_detail.color_type")}</option>
                </select>
            </td>
        </tr>
        <tr class="attr-row-number-precision">
            <th title="${t("attribute_detail.precision_title")}">${t("attribute_detail.precision")}</th>
            <td>
                <div class="input-group">
                    <input type="number" class="form-control attr-input-number-precision" style="text-align: end">
                    <span class="input-group-text">${t("attribute_detail.digits")}</span>
                </div>
            </td>
        </tr>
        <tr class="attr-row-inverse-relation">
            <th title="${t("attribute_detail.inverse_relation_title")}">${t("attribute_detail.inverse_relation")}</th>
            <td>
                <div class="input-group">
                    <input type="text" class="attr-input-inverse-relation form-control" />
                </div>
            </td>
        </tr>
    </table>
</div>`;

export default class AttributeDetailWidget extends NoteContextAwareWidget {
    private $inputName!: JQuery<HTMLElement>;
    private $rowPromoted!: JQuery<HTMLElement>;
    private $inputPromoted!: JQuery<HTMLElement>;
    private $inputPromotedAlias!: JQuery<HTMLElement>;
    private $inputMultiplicity!: JQuery<HTMLElement>;
    private $inputInverseRelation!: JQuery<HTMLElement>;
    private $inputLabelType!: JQuery<HTMLElement>;
    private $inputTargetNote!: JQuery<HTMLElement>;
    private $inputNumberPrecision!: JQuery<HTMLElement>;
    private $rowMultiplicity!: JQuery<HTMLElement>;
    private $rowLabelType!: JQuery<HTMLElement>;
    private $rowNumberPrecision!: JQuery<HTMLElement>;
    private $rowInverseRelation!: JQuery<HTMLElement>;
    private $rowTargetNote!: JQuery<HTMLElement>;
    private $rowPromotedAlias!: JQuery<HTMLElement>;
    private $attrIsOwnedBy!: JQuery<HTMLElement>;
    private $attrHelp!: JQuery<HTMLElement>;

    private attribute!: Attribute;
    private allAttributes?: Attribute[];
    private attrType!: ReturnType<AttributeDetailWidget["getAttrType"]>;

    doRender() {
        this.$widget = $(TPL);

        this.$inputName = this.$widget.find(".attr-input-name");

        this.$rowPromoted = this.$widget.find(".attr-row-promoted");
        this.$inputPromoted = this.$widget.find(".attr-input-promoted");
        this.$inputPromoted.on("change", () => this.userEditedAttribute());

        this.$rowPromotedAlias = this.$widget.find(".attr-row-promoted-alias");
        this.$inputPromotedAlias = this.$widget.find(".attr-input-promoted-alias");
        this.$inputPromotedAlias.on("change", () => this.userEditedAttribute());

        this.$rowMultiplicity = this.$widget.find(".attr-row-multiplicity");
        this.$inputMultiplicity = this.$widget.find(".attr-input-multiplicity");
        this.$inputMultiplicity.on("change", () => this.userEditedAttribute());

        this.$rowLabelType = this.$widget.find(".attr-row-label-type");
        this.$inputLabelType = this.$widget.find(".attr-input-label-type");
        this.$inputLabelType.on("change", () => this.userEditedAttribute());

        this.$rowNumberPrecision = this.$widget.find(".attr-row-number-precision");
        this.$inputNumberPrecision = this.$widget.find(".attr-input-number-precision");
        this.$inputNumberPrecision.on("change", () => this.userEditedAttribute());

        this.$rowInverseRelation = this.$widget.find(".attr-row-inverse-relation");
        this.$inputInverseRelation = this.$widget.find(".attr-input-inverse-relation");
        this.$inputInverseRelation.on("input", (ev) => {
            if (!(ev.originalEvent as KeyboardEvent)?.isComposing) {
                // https://github.com/zadam/trilium/pull/3812
                this.userEditedAttribute();
            }
        });

        this.$rowTargetNote = this.$widget.find(".attr-row-target-note");
        this.$inputTargetNote = this.$widget.find(".attr-input-target-note");

        noteAutocompleteService.initNoteAutocomplete(this.$inputTargetNote, { allowCreatingNotes: true }).on("autocomplete:noteselected", (event, suggestion, dataset) => {
            if (!suggestion.notePath) {
                return false;
            }

            const pathChunks = suggestion.notePath.split("/");

            this.attribute.value = pathChunks[pathChunks.length - 1]; // noteId

            this.triggerCommand("updateAttributeList", { attributes: this.allAttributes ?? [] });
        });

        this.$attrIsOwnedBy = this.$widget.find(".attr-is-owned-by");

        this.$attrHelp = this.$widget.find(".attr-help");
    }

    async showAttributeDetail({ allAttributes, attribute, isOwned, x, y, focus, hideMultiplicity }: AttributeDetailOpts) {
        this.attrType = this.getAttrType(attribute);

        const definition = this.attrType?.endsWith("-definition") ? promotedAttributeDefinitionParser.parse(attribute.value || "") : {};

        this.allAttributes = allAttributes;
        this.attribute = attribute;

        if (isOwned) {
            this.$attrIsOwnedBy.hide();
        } else if (attribute.noteId) {
            this.$attrIsOwnedBy
                .show()
                .empty()
                .append(attribute.type === "label" ? "Label" : "Relation")
                .append(` ${t("attribute_detail.is_owned_by_note")} `)
                .append(await linkService.createLink(attribute.noteId));
        }

        const disabledFn = () => (!isOwned ? "true" : undefined);

        this.$rowTargetNote.toggle(this.attrType === "relation");

        this.$rowPromoted.toggle(["label-definition", "relation-definition"].includes(this.attrType || ""));
        this.$inputPromoted.prop("checked", !!definition.isPromoted).attr("disabled", disabledFn);

        this.$rowPromotedAlias.toggle(!!definition.isPromoted);
        this.$inputPromotedAlias.val(definition.promotedAlias || "").attr("disabled", disabledFn);

        this.$rowMultiplicity.toggle(["label-definition", "relation-definition"].includes(this.attrType || "") && !hideMultiplicity);
        this.$inputMultiplicity.val(definition.multiplicity || "").attr("disabled", disabledFn);

        this.$rowLabelType.toggle(this.attrType === "label-definition");
        this.$inputLabelType.val(definition.labelType || "").attr("disabled", disabledFn);

        this.$rowNumberPrecision.toggle(this.attrType === "label-definition" && definition.labelType === "number");
        this.$inputNumberPrecision.val(definition.numberPrecision || "").attr("disabled", disabledFn);

        this.$rowInverseRelation.toggle(this.attrType === "relation-definition");
        this.$inputInverseRelation.val(definition.inverseRelation || "").attr("disabled", disabledFn);

        if (attribute.type === "relation") {
            this.$inputTargetNote.attr("readonly", disabledFn).val("").setSelectedNotePath("");

            if (attribute.value) {
                const targetNote = await froca.getNote(attribute.value);

                if (targetNote) {
                    this.$inputTargetNote.val(targetNote ? targetNote.title : "").setSelectedNotePath(attribute.value);
                }
            }
        }

        this.updateHelp();

        this.toggleInt(true);
    }

    userEditedAttribute() {
        this.updateAttributeInEditor();
        this.updateHelp();
    }

    updateHelp() {
        const attrName = String(this.$inputName.val());

        if (this.attrType && this.attrType in ATTR_HELP && attrName && attrName in ATTR_HELP[this.attrType]) {
            const entry = ATTR_HELP[this.attrType][attrName];
            const description = typeof entry === "string" ? entry : entry.description;
            const helpPage = typeof entry === "string" ? undefined : entry.helpPage;

            const $td = $("<td colspan=2>").append($("<strong>").text(attrName)).append(" - ").append(description);

            if (helpPage) {
                const $helpButton = $(`<button class="icon-action bx bx-help-circle" type="button" style="margin-left: 5px; vertical-align: middle;" />`);
                $helpButton.on("click", () => openInAppHelpFromUrl(helpPage));
                $td.append($helpButton);
            }

            this.$attrHelp
                .empty()
                .append($td)
                .show();
        } else {
            this.$attrHelp.empty().hide();
        }
    }

    getAttrType(attribute: Attribute) {
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

    updateAttributeInEditor() {
        if (this.attrType?.endsWith("-definition")) {
            this.attribute.value = this.buildDefinitionValue();
        } else if (this.attrType === "relation") {
            this.attribute.value = this.$inputTargetNote.getSelectedNoteId() || "";
        }

        this.triggerCommand("updateAttributeList", { attributes: this.allAttributes ?? [] });
    }

    buildDefinitionValue() {
        const props: string[] = [];

        if (this.$inputPromoted.is(":checked")) {
            props.push("promoted");

            if (this.$inputPromotedAlias.val() !== "") {
                props.push(`alias=${this.$inputPromotedAlias.val()}`);
            }
        }

        props.push(this.$inputMultiplicity.val() as string);

        if (this.attrType === "label-definition") {
            props.push(this.$inputLabelType.val() as string);

            if (this.$inputLabelType.val() === "number" && this.$inputNumberPrecision.val() !== "") {
                props.push(`precision=${this.$inputNumberPrecision.val()}`);
            }
        } else if (this.attrType === "relation-definition" && String(this.$inputInverseRelation.val())?.trim().length > 0) {
            const inverseRelationName = this.$inputInverseRelation.val();

            props.push(`inverse=${utils.filterAttributeName(String(inverseRelationName))}`);
        }

        this.$rowNumberPrecision.toggle(this.attrType === "label-definition" && this.$inputLabelType.val() === "number");

        this.$rowPromotedAlias.toggle(this.$inputPromoted.is(":checked"));

        return props.join(",");
    }

    hide() {
        this.toggleInt(false);
    }

    createLink(noteId: string) {
        return $("<a>", {
            href: `#root/${noteId}`,
            class: "reference-link"
        });
    }
}
