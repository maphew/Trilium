/**
 * @license Copyright (c) 2003-2024, CKSource Holding sp. z o.o. All rights reserved.
 * For licensing, see the `README.md` next to this file or
 * https://ckeditor.com/legal/ckeditor-oss-license
 */

import { addListToDropdown, Collection, createDropdown, ListDropdownItemDefinition, Plugin, SplitButtonView, ViewModel } from "ckeditor5";

import admonitionIcon from "../../icons/admonition.svg?raw";
import { AdmonitionType } from "./admonition_command.js";

interface AdmonitionDefinition {
    title: string;
}

/**
 * The user-facing definition of each admonition type. Keyed by the type names in
 * `ADMONITION_TYPE_NAMES` (see `admonition_command.ts`).
 */
export const ADMONITION_TYPES: Record<AdmonitionType, AdmonitionDefinition> = {
    note: {
        title: "Note"
    },
    tip: {
        title: "Tip"
    },
    important: {
        title: "Important"
    },
    caution: {
        title: "Caution"
    },
    warning: {
        title: "Warning"
    }
};

/**
 * The admonition UI plugin.
 *
 * It introduces the `'admonition'` split button: clicking the button applies the previously chosen
 * type, while the dropdown offers every type.
 */
export default class AdmonitionUI extends Plugin {

    /**
     * @inheritDoc
     */
    public static get pluginName() {
        return "AdmonitionUI" as const;
    }

    /**
     * @inheritDoc
     */
    public init(): void {
        const editor = this.editor;

        editor.ui.componentFactory.add("admonition", () => this._createButton());
    }

    /**
     * Creates a button for the admonition command to use either in toolbar or in menu bar.
     */
    private _createButton() {
        const editor = this.editor;
        const locale = editor.locale;
        const command = editor.commands.get("admonition");
        const dropdownView = createDropdown(locale, SplitButtonView);
        const splitButtonView = dropdownView.buttonView;
        const t = locale.t;

        addListToDropdown(dropdownView, this._getDropdownItems());

        // Button configuration.
        splitButtonView.set({
            label: t("Admonition"),
            icon: admonitionIcon,
            isToggleable: true,
            tooltip: true
        });
        splitButtonView.on("execute", () => {
            editor.execute("admonition", { usePreviousChoice: true });
            editor.editing.view.focus();
        });

        if (command) {
            splitButtonView.bind("isOn").to(command, "value", (value) => !!value);
            dropdownView.bind("isEnabled").to(command, "isEnabled");
        }

        dropdownView.on("execute", (evt) => {
            const commandParam = (evt.source as { commandParam?: AdmonitionType }).commandParam;
            editor.execute("admonition", { forceValue: commandParam });
            editor.editing.view.focus();
        });

        return dropdownView;
    }

    private _getDropdownItems() {
        const itemDefinitions = new Collection<ListDropdownItemDefinition>();
        const command = this.editor.commands.get("admonition");
        if (!command) {
            return itemDefinitions;
        }

        for (const [type, admonition] of Object.entries(ADMONITION_TYPES)) {
            const definition: ListDropdownItemDefinition = {
                type: "button",
                model: new ViewModel({
                    commandParam: type,
                    label: admonition.title,
                    class: `ck-tn-admonition-option ck-tn-admonition-${type}`,
                    role: "menuitemradio",
                    withText: true
                })
            };

            definition.model.bind("isOn").to(command, "value", (currentType) => currentType === type);
            itemDefinitions.add(definition);
        }

        return itemDefinitions;
    }

}
