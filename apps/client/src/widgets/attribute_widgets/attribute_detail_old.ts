import { t } from "../../services/i18n.js";
import linkService from "../../services/link.js";
import NoteContextAwareWidget from "../note_context_aware_widget.js";
import type { AttributeDetailOpts } from "./attribute_detail.jsx";

const TPL = /*html*/`
<div>
    <div class="attr-is-owned-by">${t("attribute_detail.attr_is_owned_by")}</div>
</div>`;

export default class AttributeDetailWidget extends NoteContextAwareWidget {
    private $attrIsOwnedBy!: JQuery<HTMLElement>;

    doRender() {
        this.$widget = $(TPL);

        this.$attrIsOwnedBy = this.$widget.find(".attr-is-owned-by");
    }

    async showAttributeDetail({ attribute, isOwned }: AttributeDetailOpts) {
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

        this.toggleInt(true);
    }

    hide() {
        this.toggleInt(false);
    }
}
