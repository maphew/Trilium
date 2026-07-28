/**
 * A single completion request made by the AI assistant balloon.
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

/**
 * Renders an inline HTML diff between two HTML fragments, returning HTML in which insertions and
 * deletions are marked with `<ins>`/`<del>` elements (the `htmldiff-js` output convention, the
 * same mechanism Trilium's revision dialog uses).
 */
export type AiDiffFunction = (oldHtml: string, newHtml: string) => string;

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
     */
    diff?: AiDiffFunction;
}
