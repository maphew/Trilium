import type { QuickSearchResponse } from "@triliumnext/commons";
import { Dropdown, Tooltip } from "bootstrap";

import appContext from "../components/app_context.js";
import { t } from "../services/i18n.js";
import server from "../services/server.js";
import shortcutService from "../services/shortcuts.js";
import { handleRightToLeftPlacement } from "../services/utils.js";
import BasicWidget from "./basic_widget.js";

const TPL = /*html*/`
<div class="quick-search input-group input-group-sm">
  <div class="input-group-prepend">
    <button class="btn btn-outline-secondary search-button" type="button" data-bs-toggle="dropdown" aria-haspopup="true" aria-expanded="false">
        <span class="bx bx-search"></span>
    </button>
    <div class="dropdown-menu tn-dropdown-list">
        <div class="quick-search-results"></div>
        <div class="quick-search-footer hidden-ext">
            <div class="dropdown-divider"></div>
            <a class="dropdown-item show-in-full-search" tabindex="0">${t("quick-search.show-in-full-search")}</a>
        </div>
    </div>
  </div>
</div>`;

export default class QuickSearchWidget extends BasicWidget {

    private dropdown!: bootstrap.Dropdown;
    /** The query, set by the field that holds it. */
    searchString = "";
    private $footer!: JQuery<HTMLElement>;

    doRender() {
        this.$widget = $(TPL);
        this.$footer = this.$widget.find(".quick-search-footer");

        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0], {
            popperConfig: {
                strategy: "fixed",
                placement: "bottom"
            }
        });

        const $showInFullSearchButton = this.$footer.find(".show-in-full-search");
        $showInFullSearchButton.on("click", () => this.showInFullSearch());
        shortcutService.bindElShortcut($showInFullSearchButton, "return", () => this.showInFullSearch());

        return this.$widget;
    }

    async search() {
        const searchString = this.searchString.trim();

        if (!searchString) {
            this.dropdown.hide();
            return;
        }

        this.$footer.addClass("hidden-ext");

        const { searchResults, error } = await server.get<QuickSearchResponse>(`quick-search/${encodeURIComponent(searchString)}`);

        if (error) {
            const tooltip = new Tooltip(this.$widget[0], {
                trigger: "manual",
                title: `Search error: ${error}`,
                placement: handleRightToLeftPlacement("right")
            });

            tooltip.show();

            setTimeout(() => tooltip.dispose(), 4000);
        }

        if (searchResults.length) {
            this.$footer.removeClass("hidden-ext");
        }
    }

    async showInFullSearch() {
        this.dropdown.hide();

        await appContext.triggerCommand("searchNotes", {
            searchString: this.searchString
        });
    }
}
