import "./AttributeHelp.css";

import { t } from "../../../services/i18n";
import { RawHtmlBlock } from "../../react/RawHtml";

/** In-app help note describing labels and relations. */
export const ATTRIBUTE_HELP_PAGE = "zEY4DaJG4YT5";

/**
 * Quick reference on how to type attributes into the attribute editor. Rendered inside a
 * `HelpDropdown`, either the editor's own `?` button or the attributes panel's one in the new layout.
 */
export default function AttributeHelp() {
    return (
        <div className="attribute-help">
            <RawHtmlBlock html={t("attribute_editor.help_text_body1")} />
            <RawHtmlBlock html={t("attribute_editor.help_text_body2")} />
            <RawHtmlBlock html={t("attribute_editor.help_text_body3")} />
        </div>
    );
}
