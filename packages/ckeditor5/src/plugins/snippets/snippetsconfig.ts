/**
 * The shape of a single text-snippet ("template") entry shown in the `insertTemplate` dropdown.
 *
 * Intentionally structurally compatible with the premium `TemplateDefinition` this plugin replaces,
 * so the client-side builder in `snippets.ts` does not have to change: `data` may be a plain HTML
 * string or a getter, which lets the content stay live (the getter reads a mutable cache) without
 * recreating the editor.
 */
export interface SnippetDefinition {
    /** The title of the snippet, shown as the primary label and used for search matching. */
    title: string;

    /**
     * The HTML inserted at the caret, or a callback returning it. A callback is evaluated on every
     * insertion, so snippet content can change at runtime without rebuilding the definition list.
     */
    data: (() => string) | string;

    /** Optional SVG string used as the entry icon. A generic icon is used when omitted. */
    icon?: string;

    /** Optional longer description shown under the title and also matched during search. */
    description?: string;
}

export interface SnippetsConfig {
    /** The list of snippet definitions displayed in the `insertTemplate` dropdown. */
    definitions?: Array<SnippetDefinition>;
}
