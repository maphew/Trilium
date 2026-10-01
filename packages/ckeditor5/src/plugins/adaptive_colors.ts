import {
    adaptColor,
    type AdaptiveColorBands,
    type AdaptiveColorRole,
    joinAdaptiveColorValue,
    splitAdaptiveColorValue,
    toAdaptiveColorValue
} from "@triliumnext/commons";
import {
    type CommandExecuteEvent,
    type DowncastAttributeEvent,
    type ModelElement,
    Plugin,
    priorities,
    type ViewElement
} from "ckeditor5";

/**
 * Stores the colors of text and tables as a light and dark theme pair (see `adaptColor`), whether
 * they come from a palette swatch, the color picker, the document colors or a typed value.
 *
 * Text, highlight and table backgrounds also keep the color as picked: in the model after the pair
 * (see `toAdaptiveColorValue`), and in the saved note as a `--tn-color` or `--tn-background`
 * property, which browsers without `light-dark()` fall back to.
 */
export default class AdaptiveColors extends Plugin {

    static get pluginName() {
        return "AdaptiveColors" as const;
    }

    init() {
        this.convertTextColor("fontColor", "color", "--tn-color");
        this.convertTextColor("fontBackgroundColor", "background-color", "--tn-background");
        this.convertCellBackground();
        this.convertTableBackground();
    }

    afterInit() {
        const bands = this.editor.config.get("adaptiveColorBands");
        for (const [ commandName, { role, hasSource } ] of Object.entries(COMMANDS)) {
            this.adaptCommandValue(commandName, role, hasSource, bands);
        }
    }

    private adaptCommandValue(
        commandName: string,
        role: AdaptiveColorRole,
        hasSource: boolean,
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
                const value = hasSource
                    ? toAdaptiveColorValue(options.value, role, bands)
                    : adaptColor(options.value, role, bands);
                args[0] = { ...options, value };
            }
        }, { priority: "high" });
    }

    /** Saves a text color or highlight as the pair and the color as picked, and reads it back. */
    private convertTextColor(modelKey: string, property: string, sourceProperty: string) {
        const conversion = this.editor.conversion;
        conversion.for("downcast").attributeToElement({
            model: modelKey,
            view: (value: string, { writer }) => writer.createAttributeElement(
                "span",
                { style: toStyleText(value, property, sourceProperty) },
                // CKEditor's own priority for font colors, so the two spans of a run merge.
                { priority: 7 }
            ),
            converterPriority: "high"
        });
        conversion.for("upcast").elementToAttribute({
            view: { name: "span", styles: { [property]: /[\s\S]+/, [sourceProperty]: /[\s\S]+/ } },
            model: {
                key: modelKey,
                value: (element: ViewElement) => readValue(element, property, sourceProperty)
            },
            converterPriority: "high"
        });
    }

    private convertCellBackground() {
        const conversion = this.editor.conversion;
        conversion.for("downcast").attributeToAttribute({
            model: { name: "tableCell", key: "tableCellBackgroundColor" },
            view: (value: string) => ({
                key: "style",
                value: toBackgroundStyles(value)
            }),
            converterPriority: "high"
        });
        conversion.for("upcast").attributeToAttribute({
            view: { name: /^(td|th)$/, styles: BACKGROUND_STYLES },
            model: {
                key: "tableCellBackgroundColor",
                value: readBackground
            },
            converterPriority: AHEAD_OF_TABLE_UPCAST
        });
    }

    /**
     * The table's background goes on the `<table>` inside the widget's `<figure>`, as CKEditor
     * does.
     */
    private convertTableBackground() {
        const conversion = this.editor.conversion;
        conversion.for("downcast").add((dispatcher) => {
            dispatcher.on<DowncastAttributeEvent<ModelElement>>(
                "attribute:tableBackgroundColor:table",
                (eventInfo, data, { consumable, mapper, writer }) => {
                    if (!consumable.consume(data.item, eventInfo.name)) {
                        return;
                    }

                    const figure = mapper.toViewElement(data.item);
                    const table = figure && [ ...figure.getChildren() ]
                        .find((child) => child.is("element", "table"));
                    if (!table?.is("element")) {
                        return;
                    }

                    const { attributeOldValue: oldValue, attributeNewValue: newValue } = data;
                    if (typeof oldValue === "string") {
                        writer.removeStyle(Object.keys(toBackgroundStyles(oldValue)), table);
                    }
                    if (typeof newValue === "string") {
                        writer.setStyle(toBackgroundStyles(newValue), table);
                    }
                },
                { priority: "high" }
            );
        });
        conversion.for("upcast").attributeToAttribute({
            view: { name: "table", styles: BACKGROUND_STYLES },
            model: {
                key: "tableBackgroundColor",
                value: readBackground
            },
            converterPriority: AHEAD_OF_TABLE_UPCAST
        });
    }

}

/**
 * The color commands, what their color paints, and whether the color as picked is kept. Borders
 * keep only the pair, which CKEditor can write into the `border` shorthand.
 */
const COMMANDS: Record<string, { role: AdaptiveColorRole; hasSource: boolean }> = {
    fontColor: { role: "text", hasSource: true },
    fontBackgroundColor: { role: "background", hasSource: true },
    tableBorderColor: { role: "tableBorder", hasSource: false },
    tableCellBorderColor: { role: "tableBorder", hasSource: false },
    tableBackgroundColor: { role: "tableBackground", hasSource: true },
    tableCellBackgroundColor: { role: "tableBackground", hasSource: true }
};

const BACKGROUND_STYLES = { "background-color": /[\s\S]+/, "--tn-background": /[\s\S]+/ };

/**
 * An attribute upcast runs only once its element is converted, and CKEditor reads table and cell
 * backgrounds at `low`; this one reads them just before.
 */
const AHEAD_OF_TABLE_UPCAST = priorities.low + 1;

function toStyles(value: string, property: string, sourceProperty: string): Record<string, string> {
    const { color, source } = splitAdaptiveColorValue(value);
    return source ? { [property]: color, [sourceProperty]: source } : { [property]: value };
}

function toBackgroundStyles(value: string) {
    return toStyles(value, "background-color", "--tn-background");
}

function toStyleText(value: string, property: string, sourceProperty: string) {
    return Object.entries(toStyles(value, property, sourceProperty))
        .map(([ name, styleValue ]) => `${name}:${styleValue}`)
        .join(";");
}

/** Reads the pair and the color as picked; CKEditor removes spaces from a color it loads. */
function readValue(element: ViewElement, property: string, sourceProperty: string) {
    const color = (element.getStyle(property) ?? "").replace(/\s/g, "");
    return joinAdaptiveColorValue(color, (element.getStyle(sourceProperty) ?? "").trim());
}

function readBackground(element: ViewElement) {
    return readValue(element, "background-color", "--tn-background");
}
