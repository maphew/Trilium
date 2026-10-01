import { adaptColor, type AdaptiveColorBands, type AdaptiveColorRole } from "@triliumnext/commons";
import { type CommandExecuteEvent, Plugin } from "ckeditor5";

/**
 * Stores the colors of text and tables as a light and dark theme pair (see `adaptColor`), whether
 * they come from a palette swatch, the color picker, the document colors or a typed value.
 */
export default class AdaptiveColors extends Plugin {

    static get pluginName() {
        return "AdaptiveColors" as const;
    }

    afterInit() {
        const bands = this.editor.config.get("adaptiveColorBands");
        for (const [ commandName, role ] of Object.entries(COMMAND_ROLES)) {
            this.adaptCommandValue(commandName, role, bands);
        }
    }

    private adaptCommandValue(
        commandName: string,
        role: AdaptiveColorRole,
        bands: AdaptiveColorBands | undefined
    ) {
        // An editor without the table properties plugins has no table color commands.
        const command = this.editor.commands.get(commandName);
        if (!command) {
            return;
        }

        this.listenTo<CommandExecuteEvent>(command, "execute", (_eventInfo, args) => {
            const options = args[0] as { value?: unknown } | undefined;
            if (typeof options?.value === "string") {
                args[0] = { ...options, value: adaptColor(options.value, role, bands) };
            }
        }, { priority: "high" });
    }

}

/** The color commands, and what their color paints. */
const COMMAND_ROLES: Record<string, AdaptiveColorRole> = {
    fontColor: "text",
    fontBackgroundColor: "background",
    tableBorderColor: "tableBorder",
    tableCellBorderColor: "tableBorder",
    tableBackgroundColor: "tableBackground",
    tableCellBackgroundColor: "tableBackground"
};
