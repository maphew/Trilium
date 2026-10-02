import "../../theme/content_embed_tools.css";

import { ButtonView, type Locale, Plugin, View, type ViewCollection } from "ckeditor5";

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
    public readonly buttons: ViewCollection<ButtonView>;
    private provider: ContentEmbedToolProvider | null = null;
    private unsubscribe: (() => void) | undefined;
    private toolIds: string[] = [];

    constructor(locale?: Locale) {
        super(locale);
        this.set("isVisible", false);
        this.buttons = this.createCollection();

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
            children: this.buttons
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
        this.buttons.first?.focus();
    }

    override destroy() {
        this.unsubscribe?.();
        super.destroy();
    }

    /** Shows the tools of the provider. Returns whether the buttons were created again. */
    private showTools() {
        const tools = this.provider?.getTools() ?? [];
        const ids = tools.map(tool => tool.id);
        const isNewSet = ids.length !== this.toolIds.length
            || ids.some((id, index) => id !== this.toolIds[index]);

        if (isNewSet) {
            this.toolIds = ids;
            this.buttons.clear();
            this.buttons.addMany(ids.map(id => this.createButton(id)));
        }

        for (const [ index, tool ] of tools.entries()) {
            this.buttons.get(index)?.set({
                label: tool.label,
                tooltip: tool.tooltip,
                ariaLabel: tool.tooltip,
                isOn: tool.isOn
            });
        }
        this.isVisible = tools.length > 0;

        return isNewSet;
    }

    private createButton(id: string) {
        const button = new ButtonView(this.locale);
        button.set({ withText: true, isToggleable: true });
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
