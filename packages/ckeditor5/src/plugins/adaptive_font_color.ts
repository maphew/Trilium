import { adaptColor, type AdaptiveColorRole } from "@triliumnext/commons";
import {
    type CommandExecuteEvent,
    FontBackgroundColorEditing,
    FontColorEditing,
    Plugin
} from "ckeditor5";

/**
 * Stores Font Color and Font Background Color as a light and dark theme pair (see `adaptColor`),
 * whether the color comes from a palette swatch, the color picker or the document colors.
 */
export default class AdaptiveFontColor extends Plugin {

    static get requires() {
        return [ FontColorEditing, FontBackgroundColorEditing ] as const;
    }

    static get pluginName() {
        return "AdaptiveFontColor" as const;
    }

    init() {
        this.adaptCommandValue("fontColor", "text");
        this.adaptCommandValue("fontBackgroundColor", "background");
    }

    private adaptCommandValue(commandName: string, role: AdaptiveColorRole) {
        const command = this.editor.commands.get(commandName);
        /* v8 ignore next 3 -- the required editing plugins register both commands. */
        if (!command) {
            return;
        }

        this.listenTo<CommandExecuteEvent>(command, "execute", (_eventInfo, args) => {
            const options = args[0] as { value?: string } | undefined;
            if (options?.value) {
                args[0] = { ...options, value: adaptColor(options.value, role) };
            }
        }, { priority: "high" });
    }

}
