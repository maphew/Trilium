/**
 * Pure HTML helpers for the AI assistant: undoing the models' habit of wrapping HTML output in
 * markdown fences.
 *
 * Sanitizing is deliberately *not* here. CKEditor ships no sanitizer and a hand-maintained strip
 * list is not one either, so the host supplies the real thing through `aiAssistant.sanitizeHtml`
 * (Trilium passes the DOMPurify pass it uses for note content) and the plugin refuses to render
 * without it.
 */

/**
 * Removes a leading markdown code fence (```html or ```) and, when present, the matching closing
 * fence. Models add these despite instructions not to; the stripper is applied to the cumulative
 * stream, so it must also handle a fence whose closing half has not arrived yet.
 */
export function stripMarkdownFences(cumulative: string): string {
    const opening = /^\s*```[a-z]*\s*\n?/i.exec(cumulative);
    if (!opening) {
        return cumulative;
    }

    let body = cumulative.slice(opening[0].length);
    const closingIndex = body.lastIndexOf("```");
    if (closingIndex !== -1 && body.slice(closingIndex + 3).trim() === "") {
        body = body.slice(0, closingIndex);
    }
    return body;
}
