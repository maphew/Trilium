/** A button that the content of an embed adds to the toolbar of the embed. */
export interface ContentEmbedTool {
    id: string;
    /** The text of the button. */
    label: string;
    /** The name of what the button does, shown as its tooltip. */
    tooltip: string;
    isOn: boolean;
}

/** The buttons that the content of an embed, such as a canvas drawing, adds to its toolbar. */
export interface ContentEmbedToolProvider {
    getTools(): ContentEmbedTool[];
    execute(id: string): void;
    /** Calls `callback` when `getTools()` changes, until the returned function is called. */
    subscribe(callback: () => void): () => void;
}

const providers = new Map<HTMLElement, ContentEmbedToolProvider>();

/**
 * Adds the buttons of `provider` to the toolbar of the embed that contains `element`, until the
 * returned function is called.
 */
export function registerContentEmbedTools(
    element: HTMLElement,
    provider: ContentEmbedToolProvider
) {
    providers.set(element, provider);
    return () => {
        providers.delete(element);
    };
}

/** The buttons that the content of `embed` adds to its toolbar, or `null`. */
export function getContentEmbedTools(embed: HTMLElement) {
    for (const [ element, provider ] of providers) {
        if (embed.contains(element)) {
            return provider;
        }
    }
    return null;
}
