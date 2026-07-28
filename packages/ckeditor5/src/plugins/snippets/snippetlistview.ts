import { type Collection, type FilteredView, ListItemView, ListView, type Locale } from "ckeditor5";

import type { SnippetDefinition } from "./snippetsconfig.js";
import SnippetListItemButtonView from "./snippetlistitembuttonview.js";

/**
 * The scrollable list of snippets shown inside the `insertTemplate` search dropdown.
 *
 * Its rows are **bound** to a live {@link Collection} of definitions: adding, removing or editing a
 * snippet note updates the collection, and the list re-renders in place — no editor rebuild. It
 * implements {@link FilteredView} so the surrounding {@link module:ui/search/text/searchtextview~SearchTextView}
 * can filter it by the user's query.
 */
export default class SnippetListView extends ListView implements FilteredView {

    constructor(locale: Locale, definitions: Collection<SnippetDefinition>, insert: (definition: SnippetDefinition) => void) {
        super(locale);

        this.extendTemplate({
            attributes: {
                role: "listbox",
                class: ["ck-template-list"]
            }
        });

        this.items.bindTo(definitions).using((definition) => {
            const item = new ListItemView(locale);
            const button = new SnippetListItemButtonView(locale, definition);

            button.on("execute", () => insert(definition));

            item.children.add(button);
            return item;
        });
    }

    public filter(regExp: RegExp | null): { resultsCount: number; totalItemsCount: number } {
        let resultsCount = 0;

        for (const item of this.items) {
            if (!(item instanceof ListItemView)) {
                continue;
            }

            const button = getButton(item);
            if (!button) {
                continue;
            }

            const isVisible = regExp ? !!button.isMatching(regExp) : true;

            item.isVisible = isVisible;
            button.highlightText(isVisible && regExp ? regExp : null);

            if (isVisible) {
                resultsCount++;
            }
        }

        return {
            resultsCount,
            totalItemsCount: this.items.length
        };
    }

    public override focus(): void {
        // Focus the first *visible* row so keyboard users skip rows hidden by the current filter.
        for (const item of this.items) {
            if (item instanceof ListItemView && item.isVisible) {
                getButton(item)?.focus();
                return;
            }
        }
    }
}

function getButton(item: ListItemView): SnippetListItemButtonView | null {
    const first = item.children.first;
    return first instanceof SnippetListItemButtonView ? first : null;
}
