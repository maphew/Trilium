import { Plugin } from "ckeditor5";

import type AdmonitionCommand from "./admonition_command.js";
import AdmonitionAutoformat from "./admonition_autoformat.js";
import AdmonitionEditing from "./admonition_editing.js";
import AdmonitionUI from "./admonition_ui.js";

/**
 * The admonition (info box / warning box) feature: an `<aside class="admonition <type>">`
 * container holding block content.
 *
 * This is a "glue" plugin which loads {@link AdmonitionEditing}, {@link AdmonitionUI} and
 * {@link AdmonitionAutoformat}.
 *
 * Adapted from CKEditor 5's block-quote feature; see the `README.md` next to this file.
 */
export default class Admonition extends Plugin {

    public static get requires() {
        return [AdmonitionEditing, AdmonitionUI, AdmonitionAutoformat] as const;
    }

    public static get pluginName() {
        return "Admonition" as const;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [Admonition.pluginName]: Admonition;
        [AdmonitionEditing.pluginName]: AdmonitionEditing;
        [AdmonitionUI.pluginName]: AdmonitionUI;
    }

    interface CommandsMap {
        admonition: AdmonitionCommand;
    }
}
