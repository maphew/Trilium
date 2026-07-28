import { createDropdown, type Locale, MenuBarMenuListItemButtonView, MenuBarMenuListItemView, MenuBarMenuListView, MenuBarMenuView, Plugin, SearchTextView } from "ckeditor5";

import SnippetsEditing from "./snippetsediting.js";
import SnippetListView from "./snippetlistview.js";
import templateIcon from "./theme/icons/template.svg?raw";
import "./theme/snippets.css";

/**
 * Registers the snippet UI: the `insertTemplate` toolbar dropdown (a searchable list) and the
 * `menuBar:insertTemplate` menu entry. Both render from {@link SnippetsEditing}'s live definition
 * collection, so snippet changes appear without recreating the editor.
 *
 * The user-facing strings deliberately reuse the same English source keys as the premium plugin this
 * replaces (`"Insert template"`, `"Search template"`, …) so the existing `translation_overrides.ts`
 * relabelling ("Insert text snippet" / "Search text snippet") keeps applying.
 */
export default class SnippetsUI extends Plugin {

    static get requires() {
        return [SnippetsEditing] as const;
    }

    static get pluginName() {
        return "SnippetsUI" as const;
    }

    public init(): void {
        const editor = this.editor;
        const t = editor.t;
        const editing = editor.plugins.get(SnippetsEditing);

        const insert = (data: string | (() => string)) => {
            editor.execute("insertTemplate", data);
            editor.editing.view.focus();
        };

        editor.ui.componentFactory.add("insertTemplate", (locale) => {
            const command = editor.commands.get("insertTemplate");
            const dropdownView = createDropdown(locale);

            const listView = new SnippetListView(locale, editing.definitions, (definition) => insert(definition.data));

            const searchView = new SearchTextView(locale, {
                filteredView: listView,
                queryView: {
                    label: t("Search template")
                },
                class: "ck-snippet-form",
                infoView: {
                    text: {
                        notFound: {
                            primary: (query) => t("No templates were found matching \"%0\".", query as string),
                            secondary: t("Please try a different phrase or check the spelling.")
                        },
                        noSearchableItems: {
                            primary: t("No templates available.")
                        }
                    }
                }
            });

            searchView.on("search", (evt, data: { query: string; resultsCount: number }) => {
                if (data.query?.length) {
                    editor.ui.ariaLiveAnnouncer.announce(t("%0 templates found", data.resultsCount));
                }
            });

            if (command) {
                dropdownView.bind("isEnabled").to(command);
            }
            dropdownView.panelView.children.add(searchView);
            dropdownView.buttonView.set({
                label: t("Insert template"),
                icon: templateIcon,
                tooltip: true
            });

            // Clear the query (and thus the filter/highlight) each time the dropdown is closed.
            dropdownView.on("change:isOpen", (evt, name, isOpen) => {
                if (!isOpen) {
                    searchView.reset();
                }
            });

            return dropdownView;
        });

        editor.ui.componentFactory.add("menuBar:insertTemplate", (locale) => {
            const command = editor.commands.get("insertTemplate");
            const menuView = new MenuBarMenuView(locale);
            menuView.buttonView.set({
                label: t("Template"),
                icon: templateIcon
            });

            const listView = new MenuBarMenuListView(locale);
            this._populateMenuList(locale, listView, menuView, insert);

            // Rebuild the menu whenever the snippet set changes (kept in sync with the toolbar list).
            this.listenTo(editing.definitions, "change", () => {
                this._populateMenuList(locale, listView, menuView, insert);
            });

            menuView.panelView.children.add(listView);
            if (command) {
                menuView.bind("isEnabled").to(command, "isEnabled");
            }

            return menuView;
        });
    }

    private _populateMenuList(locale: Locale, listView: MenuBarMenuListView, menuView: MenuBarMenuView, insert: (data: string | (() => string)) => void): void {
        const editor = this.editor;
        const t = editor.t;
        const definitions = editor.plugins.get(SnippetsEditing).definitions;

        listView.items.clear();

        if (!definitions.length) {
            const emptyItem = new MenuBarMenuListItemView(locale, menuView);
            const emptyButton = new MenuBarMenuListItemButtonView(locale);
            emptyButton.set({ label: t("No templates available."), isEnabled: false });
            emptyItem.children.add(emptyButton);
            listView.items.add(emptyItem);
            return;
        }

        for (const definition of definitions) {
            const item = new MenuBarMenuListItemView(locale, menuView);
            const button = new MenuBarMenuListItemButtonView(locale);
            button.set({
                class: "ck-snippet-button",
                label: definition.title,
                icon: definition.icon
            });
            button.delegate("execute").to(menuView);
            button.on("execute", () => insert(definition.data));
            item.children.add(button);
            listView.items.add(item);
        }
    }
}
