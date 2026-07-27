import type { Attribute } from "../../services/attribute_parser.js";
import { t } from "../../services/i18n.js";
import linkService from "../../services/link.js";
import { openInAppHelpFromUrl } from "../../services/utils.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import { ATTR_HELP } from "./attr_help.js";
import type { AttributeDetailOpts } from "./attribute_detail.jsx";

const TPL = /*html*/`
<div>
    <div class="attr-is-owned-by">${t("attribute_detail.attr_is_owned_by")}</div>

    <table class="attr-edit-table">
        <tr class="attr-help"></tr>
    </table>
</div>`;

export default class AttributeDetailWidget extends NoteContextAwareWidget {
    private $inputName!: JQuery<HTMLElement>;
    private $attrIsOwnedBy!: JQuery<HTMLElement>;
    private $attrHelp!: JQuery<HTMLElement>;

    private attrType!: ReturnType<AttributeDetailWidget["getAttrType"]>;

    doRender() {
        this.$widget = $(TPL);

        this.$inputName = this.$widget.find(".attr-input-name");

        this.$attrIsOwnedBy = this.$widget.find(".attr-is-owned-by");

        this.$attrHelp = this.$widget.find(".attr-help");
    }

    async showAttributeDetail({ allAttributes, attribute, isOwned, x, y, focus, hideMultiplicity }: AttributeDetailOpts) {
        this.attrType = this.getAttrType(attribute);

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

        this.updateHelp();

        this.toggleInt(true);
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
