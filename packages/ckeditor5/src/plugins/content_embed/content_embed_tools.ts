import "../../theme/content_embed_tools.css";

import {
    ButtonView, type Locale, Plugin, ToolbarSeparatorView, View, type ViewCollection
} from "ckeditor5";

import ContentEmbed from "./content_embed.js";

/** The toolbar item with the buttons that the content of the selected embed adds. */
export const CONTENT_EMBED_TOOLS = "contentEmbedTools";

/**
 * Shows the buttons that the content of the selected embed adds to the embed's toolbar, such as
 * the tools of a canvas drawing. The host supplies them through `getContentEmbedTools()`.
 */
export default class ContentEmbedTools extends Plugin {

    static get requires() {
        return [ ContentEmbed ] as const;
    }

    static get pluginName() {
        return "ContentEmbedTools" as const;
    }

    init() {
        const editor = this.editor;

        editor.ui.componentFactory.add(CONTENT_EMBED_TOOLS, locale => {
            const view = new ContentEmbedToolsView(locale);

            // Runs before `WidgetToolbarRepository` positions the toolbar from its width.
            this.listenTo(editor.ui, "update", () => view.setProvider(this.getProvider()), {
                priority: "high"
            });
            this.listenTo<ContentEmbedToolsResizeEvent>(view, "resize", () => editor.ui.update());

            return view;
        });
    }

    /** The buttons that the content of the selected embed adds, or `null`. */
    private getProvider() {
        const embed = this.editor.plugins.get(ContentEmbed).getSelectedEmbedDom();
        if (!embed) {
            return null;
        }

        const editorEl = this.editor.editing.view.getDomRoot();
        const component: EditorComponent | undefined =
            glob.getComponentByEl<EditorComponent>(editorEl);
        return component?.getContentEmbedTools?.(embed) ?? null;
    }

}

/** Fired when the buttons are created again, which changes the width of the toolbar. */
type ContentEmbedToolsResizeEvent = {
    name: "resize";
    args: [];
};

/** The buttons of a `ContentEmbedToolProvider`, updated when the provider changes. */
export class ContentEmbedToolsView extends View {

    declare public isVisible: boolean;
    /** The buttons, in the order of the tools. */
    public buttons: ButtonView[] = [];
    /** The buttons and the separators between their groups. */
    private readonly items: ViewCollection;
    private provider: ContentEmbedToolProvider | null = null;
    private unsubscribe: (() => void) | undefined;
    /** The group and the id of each tool, to create the buttons again only for another set. */
    private toolKeys: string[] = [];

    constructor(locale?: Locale) {
        super(locale);
        this.set("isVisible", false);
        this.items = this.createCollection();

        const bind = this.bindTemplate;
        this.setTemplate({
            tag: "div",
            attributes: {
                class: [
                    "ck",
                    "ck-content-embed-tools",
                    bind.if("isVisible", "ck-hidden", isVisible => !isVisible)
                ]
            },
            children: this.items
        });
    }

    /** Shows the buttons of `provider`, and updates them when it changes. */
    setProvider(provider: ContentEmbedToolProvider | null) {
        if (provider === this.provider) {
            return;
        }

        this.unsubscribe?.();
        this.provider = provider;
        this.unsubscribe = provider?.subscribe(() => {
            if (this.showTools()) {
                this.fire<ContentEmbedToolsResizeEvent>("resize");
            }
        });
        this.showTools();
    }

    focus() {
        this.buttons[0]?.focus();
    }

    override destroy() {
        this.unsubscribe?.();
        super.destroy();
    }

    /** Shows the tools of the provider. Returns whether the buttons were created again. */
    private showTools() {
        const tools = this.provider?.getTools() ?? [];
        const keys = tools.map(tool => `${tool.group ?? ""}/${tool.id}`);
        const isNewSet = keys.length !== this.toolKeys.length
            || keys.some((key, index) => key !== this.toolKeys[index]);

        if (isNewSet) {
            this.toolKeys = keys;
            this.createButtons(tools);
        }

        for (const [ index, tool ] of tools.entries()) {
            this.buttons[index]?.set({
                label: tool.text ?? tool.label,
                withText: tool.text !== undefined,
                icon: tool.icon,
                tooltip: tool.label,
                ariaLabel: tool.label,
                isToggleable: tool.isOn !== undefined,
                isOn: tool.isOn ?? false,
                isEnabled: tool.isEnabled ?? true
            });
        }
        this.isVisible = tools.length > 0;

        return isNewSet;
    }

    /** Creates a button for each tool, with a separator between groups. */
    private createButtons(tools: ContentEmbedTool[]) {
        this.items.clear();
        this.buttons = [];

        let group: string | undefined;
        for (const tool of tools) {
            if (this.buttons.length && tool.group !== group) {
                this.items.add(new ToolbarSeparatorView(this.locale));
            }
            group = tool.group;

            const button = this.createButton(tool.id);
            this.buttons.push(button);
            this.items.add(button);
        }
    }

    private createButton(id: string) {
        const button = new ButtonView(this.locale);
        // Keeps the focus in the content that the tool acts on.
        button.extendTemplate({
            on: { mousedown: button.bindTemplate.to(evt => evt.preventDefault()) }
        });
        this.listenTo(button, "execute", () => this.provider?.execute(id));

        return button;
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [ ContentEmbedTools.pluginName ]: ContentEmbedTools;
    }
}
