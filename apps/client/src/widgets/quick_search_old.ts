import type { QuickSearchResponse } from "@triliumnext/commons";
import { Dropdown, Tooltip } from "bootstrap";

import server from "../services/server.js";
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
    </div>
  </div>
</div>`;

export default class QuickSearchWidget extends BasicWidget {

    private dropdown!: bootstrap.Dropdown;
    /** The query, set by the field that holds it. */
    searchString = "";

    doRender() {
        this.$widget = $(TPL);

        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0], {
            popperConfig: {
                strategy: "fixed",
                placement: "bottom"
            }
        });

        return this.$widget;
    }

    async search() {
        const searchString = this.searchString.trim();

        if (!searchString) {
            this.dropdown.hide();
            return;
        }

        const { error } = await server.get<QuickSearchResponse>(`quick-search/${encodeURIComponent(searchString)}`);

        if (error) {
            const tooltip = new Tooltip(this.$widget[0], {
                trigger: "manual",
                title: `Search error: ${error}`,
                placement: handleRightToLeftPlacement("right")
            });

            tooltip.show();

            setTimeout(() => tooltip.dispose(), 4000);
        }
    }
}
