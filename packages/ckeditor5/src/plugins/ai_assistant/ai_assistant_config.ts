/**
 * A single completion request made by the AI assistant.
 */
export interface AiCompletionRequest {
    /** The user's instruction — either typed free-form or a preset command's prompt. */
    query: string;

    /**
     * The HTML the instruction applies to (the selection, or on a follow-up query the previous
     * response). Empty when the user generates new content from a collapsed selection.
     */
    context: string;
}

/**
 * Called with the *cumulative* response HTML every time more of the stream arrives — the same
 * contract CKEditor's premium `AITextAdapter` uses. Re-parsing the growing prefix keeps the
 * preview renderable at every tick (the HTML parser auto-closes tags cut off mid-stream).
 */
export type AiStreamCallback = (cumulativeHtml: string) => void;

/**
 * What a finished completion cost, shown in the review phase. All fields are optional — whatever
 * the provider reports gets displayed, the rest is omitted.
 */
export interface AiCompletionUsage {
    /** Identifier of the model that produced the response. */
    model?: string;
    /** Total tokens consumed (prompt + completion). */
    totalTokens?: number;
    /** Estimated cost in USD. */
    cost?: number;
}

/**
 * Host-provided transport for AI completions. The plugin knows nothing about providers, endpoints
 * or authentication — the client injects this the same way it injects `snippets.definitions` or
 * `syntaxHighlighting.loadHighlightJs`.
 *
 * The returned promise resolves when the stream finishes — with the run's usage, when the
 * provider reports it — and rejects on transport or provider error. An abort through `signal`
 * must reject with a DOM `AbortError`; the partial content already delivered through `onData`
 * stays usable.
 */
export type AiStreamFunction = (
    request: AiCompletionRequest,
    onData: AiStreamCallback,
    signal: AbortSignal
) => Promise<AiCompletionUsage | void>;

/** Which of the review's two views the preview shows: the plain response, or its diff. */
export type AiReviewView = "result" | "changes";

/** What a {@link AiDiffFunction} produced, when it has more to say than the diff itself. */
export interface AiDiffResult {
    /** The diff, marked up with `<ins>`/`<del>` elements. */
    html: string;
    /**
     * How much of the response — 0 to 1, measured over its text — replaced what it was given
     * outright instead of editing it in place. Past half the review opens on the plain result:
     * a diff of two texts with next to nothing in common is noise however well it is rendered,
     * and the response itself is the thing worth reading.
     *
     * Optional; a renderer that does not measure this is treated as having rewritten nothing,
     * which is the behaviour of a plain word-level diff.
     */
    rewriteRatio?: number;
    /**
     * Whether the response *is* the content it was given — what proofreading text with nothing
     * wrong with it produces. The review says so outright rather than offering a diff with no
     * marks in it, which reads as a diff that failed.
     *
     * Optional, and only a renderer that compares the two sides itself can answer it: an empty
     * diff and an unchanged one are the same string.
     */
    isUnchanged?: boolean;
}

/**
 * Renders an inline HTML diff between two HTML fragments, returning HTML in which insertions and
 * deletions are marked with `<ins>`/`<del>` elements (the `htmldiff-js` output convention, the
 * same mechanism Trilium's revision dialog uses). Returning an {@link AiDiffResult} instead of a
 * bare string lets the renderer also say how much of the response it could not align.
 */
export type AiDiffFunction = (oldHtml: string, newHtml: string) => string | AiDiffResult;

/**
 * A predefined instruction offered in the menu of the toolbar's AI entry — the GPL counterpart of
 * the premium `AICommandDefinition`. Labels arrive pre-translated from the host; only the `prompt`
 * is sent to the model.
 */
export interface AiQuickAction {
    id: string;
    /** The label shown in the menu, already translated by the host. */
    label: string;
    /**
     * The action phrased as a standalone command ("Translate to Romanian"), for the places that
     * show it away from its group heading — the `/` palette, where the bare {@link label} the menu
     * gets away with ("Romanian") would say nothing. Also translated by the host, since only it can
     * word the composition; defaults to {@link label}, which is enough for an action whose label
     * already reads as a command ("Fix typos").
     */
    commandLabel?: string;
    /** The instruction sent to the model in place of a typed query. */
    prompt: string;
    /**
     * The action's icon, as a Boxicon class list (e.g. `"bx bx-check-double"`). Rendered directly
     * as a font-icon `<span>`, the same way {@link SnippetDefinition.iconClass} is: Trilium owns
     * this plugin, so there is no need to wrap the glyph in an SVG to satisfy CKEditor's generic
     * `IconView`.
     */
    iconClass?: string;
    /**
     * Whether the action needs content to work on. Actions that do (the default) are disabled
     * while there is nothing selected and nothing has been generated yet.
     */
    requiresContent?: boolean;
    /**
     * Which view the review opens on once this action's run finishes. Left unset, how much of the
     * response the diff could align decides (see {@link AiDiffResult.rewriteRatio}).
     *
     * Set it to `"result"` for an action whose answer replaces its source by definition — a
     * translation, a summary, a diagram — where the diff is two unrelated texts stacked on each
     * other whatever the measurement says.
     */
    reviewView?: AiReviewView;
}

/**
 * Sanitizes model-produced HTML before the dialog assigns it to the preview's `innerHTML`.
 *
 * CKEditor ships no sanitizer of its own and asks the integrator for one instead — the same
 * contract as `config.htmlEmbed.sanitizeHtml`, whose built-in default only warns and passes the
 * HTML straight through. (A top-level `config.sanitizeHtml` is rejected outright by the editor,
 * so this belongs under the feature's own namespace.)
 */
export type AiSanitizeFunction = (html: string) => string;

/**
 * A row appended to the bottom of a group's submenu, below a rule, that runs host code instead of
 * asking the model — for a group whose contents the user configures, so that what configures them
 * is reachable from the group itself rather than only from the settings.
 *
 * It is not an {@link AiQuickAction}: it has no prompt, needs no content, and has no business in
 * the `/` palette, which lists ways to instruct the model.
 */
export interface AiQuickActionFooter {
    /** The label shown in the menu, already translated by the host. */
    label: string;
    /** The row's icon, as a Boxicon class list. */
    iconClass?: string;
    run: () => void;
}

/** A labelled group of quick actions, rendered as a group in the menu. */
export interface AiQuickActionGroup {
    id: string;
    /** The group heading, already translated by the host. */
    label: string;
    actions: AiQuickAction[];
    /** The group's icon, as a Boxicon class list. Only shown when the group is a {@link submenu}. */
    iconClass?: string;
    /**
     * Whether the group opens as a submenu instead of having its actions listed directly in the
     * menu. Use it for the long groups whose actions only read as commands under their heading —
     * the same ones that need a {@link AiQuickAction.commandLabel}.
     *
     * An inlined group loses its heading: CKEditor's nested-menu definition has only buttons and
     * submenus, no group separators, so the choice is a submenu or bare top-level entries. That
     * suits actions that already read as commands on their own ("Fix typos", "Summarize").
     */
    submenu?: boolean;
    /** A row closing the group's submenu. Only rendered when the group is a {@link submenu}. */
    footer?: AiQuickActionFooter;
}

export interface AiAssistantConfig {
    /**
     * Streams a completion for a request. When absent (no LLM provider configured), the whole
     * feature stays disabled.
     */
    stream?: AiStreamFunction;

    /**
     * Renders the "Changes" view of the review phase: an inline diff of the response against the
     * content it replaces. Optional — without it the review phase only shows the result. The diff
     * is computed once per finished run, never against a partial stream (a half-streamed response
     * would render as a sea of deletions).
     *
     * Which of the two views the review opens on follows from what this returns, unless the quick
     * action that started the run named one itself ({@link AiQuickAction.reviewView}).
     */
    diff?: AiDiffFunction;

    /**
     * The predefined instructions hanging off the toolbar entry ("Fix typos", "Make shorter", …).
     * Optional — without them the toolbar entry is a plain button and only the free-form prompt
     * remains.
     */
    quickActions?: AiQuickActionGroup[];

    /**
     * Sanitizes the response HTML before it is rendered into the preview. **Required**: the
     * plugin has no built-in fallback and throws rather than render unsanitized model output —
     * a hand-maintained strip list only looks like a sanitizer, missing namespaced `xlink:href`,
     * SVG animation elements and `data:` URIs. Trilium passes the same DOMPurify pass it applies
     * to note content.
     */
    sanitizeHtml: AiSanitizeFunction;
}
