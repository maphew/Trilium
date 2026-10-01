import type { QuickSearchResponse, SearchResultDetails } from "@triliumnext/commons";
import { Dropdown, Tooltip } from "bootstrap";

import appContext from "../components/app_context.js";
import { t } from "../services/i18n.js";
import { calculateHash, type ViewScope } from "../services/link.js";
import server from "../services/server.js";
import shortcutService from "../services/shortcuts.js";
import utils, { handleRightToLeftPlacement } from "../services/utils.js";
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

const INITIAL_DISPLAYED_NOTES = 15;
const LOAD_MORE_BATCH_SIZE = 10;

export default class QuickSearchWidget extends BasicWidget {

    private dropdown!: bootstrap.Dropdown;
    /** The query, set by the field that holds it. */
    searchString = "";
    private $dropdownMenu!: JQuery<HTMLElement>;
    private $searchResults!: JQuery<HTMLElement>;
    private $footer!: JQuery<HTMLElement>;

    // State for infinite scrolling
    private allSearchResults: SearchResultDetails[] = [];
    private currentDisplayedCount: number = 0;
    private isLoadingMore: boolean = false;

    // Attached to each result link so the opened note jumps to the first match; undefined when the
    // last search highlighted nothing, which keeps the links at a plain `#notePath`.
    private lastResultViewScope: ViewScope | undefined;

    doRender() {
        this.$widget = $(TPL);
        this.$dropdownMenu = this.$widget.find(".dropdown-menu");
        this.$searchResults = this.$dropdownMenu.find(".quick-search-results");
        this.$footer = this.$dropdownMenu.find(".quick-search-footer");

        this.dropdown = Dropdown.getOrCreateInstance(this.$widget.find("[data-bs-toggle='dropdown']")[0], {
            popperConfig: {
                strategy: "fixed",
                placement: "bottom"
            }
        });

        // Add scroll event listener for infinite scrolling
        this.$searchResults.on("scroll", () => {
            this.handleScroll();
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

        // Reset state for new search
        this.allSearchResults = [];
        this.currentDisplayedCount = 0;
        this.isLoadingMore = false;

        this.$footer.addClass("hidden-ext");
        this.$searchResults.empty();
        this.$searchResults.append(`
            <span class="dropdown-item disabled">
                <span class="bx bx-loader bx-spin"></span>
                ${t("quick-search.searching")}
            </span>`);

        const { searchResults, highlightedTokens, error } = await server.get<QuickSearchResponse>(`quick-search/${encodeURIComponent(searchString)}`);

        this.lastResultViewScope = highlightedTokens.length ? { searchTerms: highlightedTokens } : undefined;

        if (error) {
            const tooltip = new Tooltip(this.$widget[0], {
                trigger: "manual",
                title: `Search error: ${error}`,
                placement: handleRightToLeftPlacement("right")
            });

            tooltip.show();

            setTimeout(() => tooltip.dispose(), 4000);
        }

        // Store all results for infinite scrolling
        this.allSearchResults = searchResults;

        this.$searchResults.empty();

        if (this.allSearchResults.length === 0) {
            this.$searchResults.append(`<span class="dropdown-item disabled">${t("quick-search.no-results")}</span>`);
            return;
        }

        // Display initial batch
        await this.displayMoreResults(INITIAL_DISPLAYED_NOTES);

        this.$footer.removeClass("hidden-ext");

        this.dropdown.update();
    }

    private async displayMoreResults(batchSize: number) {
        if (this.isLoadingMore) return;
        this.isLoadingMore = true;

        const startIndex = this.currentDisplayedCount;
        const endIndex = Math.min(startIndex + batchSize, this.allSearchResults.length);
        const resultsToDisplay = this.allSearchResults.slice(startIndex, endIndex);

        for (const result of resultsToDisplay) {
            if (!result.notePath) continue;

            // Set the href with .attr() rather than interpolating it into the HTML string, so
            // the query separators are not parsed as HTML entities.
            const $item = $(`<a class="dropdown-item" tabindex="0">`);
            $item.attr("href", calculateHash({ notePath: result.notePath, viewScope: this.lastResultViewScope }));

            // Build the display HTML with content snippet below the title
            let itemHtml = `<div class="quick-search-item">
                <div class="quick-search-item-header">
                    <span class="quick-search-item-icon ${utils.escapeHtml(result.icon)}"></span>
                    <span class="search-result-title">${result.highlightedNotePathTitle}</span>
                </div>`;

            // Add attribute snippet (tags/attributes) below the title if available
            if (result.highlightedAttributeSnippet) {
                // Replace <br> with a blank space to join the atributes on the same single line
                const snippet = (result.highlightedAttributeSnippet as string).replace(/<br\s?\/?>/g, " ");
                itemHtml += `<div class="search-result-attributes">${snippet}</div>`;
            }

            // Add content snippet below the attributes if available
            if (result.highlightedContentSnippet) {
                itemHtml += `<div class="search-result-content">${result.highlightedContentSnippet}</div>`;
            }

            itemHtml += `</div>`;

            $item.html(itemHtml);

            $item.on("click auxclick", () => {
                this.dropdown.hide();
            });

            shortcutService.bindElShortcut($item, "return", () => {
                this.dropdown.hide();
                $item[0].click();
            });

            this.$searchResults.append($item);
        }

        this.currentDisplayedCount = endIndex;

        this.isLoadingMore = false;
    }

    private handleScroll() {
        if (this.isLoadingMore) return;

        const results = this.$searchResults[0];
        const scrollTop = results.scrollTop;
        const scrollHeight = results.scrollHeight;
        const clientHeight = results.clientHeight;

        // Trigger loading more when user scrolls near the bottom (within 50px)
        if (scrollTop + clientHeight >= scrollHeight - 50) {
            if (this.currentDisplayedCount < this.allSearchResults.length) {
                this.displayMoreResults(LOAD_MORE_BATCH_SIZE).then(() => this.dropdown.update());
            }
        }
    }

    async showInFullSearch() {
        this.dropdown.hide();

        await appContext.triggerCommand("searchNotes", {
            searchString: this.searchString
        });
    }
}
