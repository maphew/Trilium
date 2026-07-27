import type { Attribute } from "../../services/attribute_parser.js";
import { t } from "../../services/i18n.js";
import linkService from "../../services/link.js";
import promotedAttributeDefinitionParser from "../../services/promoted_attribute_definition_parser.js";
import { openInAppHelpFromUrl } from "../../services/utils.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import { ATTR_HELP } from "./attr_help.js";
import type { AttributeDetailOpts } from "./attribute_detail.jsx";

const TPL = /*html*/`
<div>
    <div class="attr-is-owned-by">${t("attribute_detail.attr_is_owned_by")}</div>

    <table class="attr-edit-table">
        <tr class="attr-help"></tr>
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
    private $inputInverseRelation!: JQuery<HTMLElement>;
    private $rowInverseRelation!: JQuery<HTMLElement>;
    private $attrIsOwnedBy!: JQuery<HTMLElement>;
    private $attrHelp!: JQuery<HTMLElement>;

    private attribute!: Attribute;
    private allAttributes?: Attribute[];
    private attrType!: ReturnType<AttributeDetailWidget["getAttrType"]>;

    doRender() {
        this.$widget = $(TPL);

        this.$inputName = this.$widget.find(".attr-input-name");

        this.$rowInverseRelation = this.$widget.find(".attr-row-inverse-relation");
        this.$inputInverseRelation = this.$widget.find(".attr-input-inverse-relation");
        this.$inputInverseRelation.on("input", (ev) => {
            if (!(ev.originalEvent as KeyboardEvent)?.isComposing) {
                // https://github.com/zadam/trilium/pull/3812
                this.userEditedAttribute();
            }
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

        this.$rowInverseRelation.toggle(this.attrType === "relation-definition");
        this.$inputInverseRelation.val(definition.inverseRelation || "").attr("disabled", disabledFn);

        this.updateHelp();

        this.toggleInt(true);
    }

    userEditedAttribute() {
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
