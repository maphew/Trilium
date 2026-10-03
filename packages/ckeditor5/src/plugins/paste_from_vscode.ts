import { getMimeTypeFromMarkdownName, normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import { Plugin } from "ckeditor5";
import type { ViewDocumentClipboardInputEvent } from "ckeditor5";

/** The clipboard type VS Code writes next to the copied text, holding the language of the editor. */
export const VSCODE_EDITOR_DATA = "vscode-editor-data";

/**
 * VS Code language IDs that `getMimeTypeFromMarkdownName()` does not resolve, or resolves to a
 * variant (`java` to JSP, `json` to JSON-LD, `sql` to MariaDB).
 */
const VSCODE_LANGUAGE_MIMES: Record<string, string> = {
    bat: "application/x-bat",
    dockercompose: "text/x-yaml",
    java: "text/x-java",
    javascriptreact: "text/jsx",
    json: "application/json",
    jsonc: "application/json",
    "objective-c": "text/x-objectivec",
    perl: "text/x-perl",
    php: "text/x-php",
    shellscript: "text/x-sh",
    sql: "text/x-sql",
    swift: "text/x-swift",
    terraform: "text/x-hcl",
    toml: "text/x-toml",
    typescriptreact: "text/typescript-jsx",
    vb: "text/x-vb"
};

/**
 * Pastes code copied from VS Code as code: a single line as inline code, several lines as a code
 * block in the language of the VS Code editor.
 *
 * VS Code puts the syntax-highlighted HTML on the clipboard together with
 * {@link VSCODE_EDITOR_DATA}, a JSON object whose `mode` is the language ID. When that object is
 * present, the plugin replaces the HTML with code built from the plain text, so the indentation is
 * exact and the theme colors are dropped. A language that the editor does not offer falls back to
 * the code block's default language.
 *
 * Pasting into an existing code block is left to `CodeBlockEditing`, whose normal-priority
 * listener inserts the plain text.
 */
export default class PasteFromVsCode extends Plugin {

    static get pluginName() {
        return "PasteFromVsCode" as const;
    }

    init() {
        // `high`, to replace the HTML before `ClipboardPipeline` converts it at `low` priority.
        this.listenTo<ViewDocumentClipboardInputEvent>(
            this.editor.editing.view.document,
            "clipboardInput",
            (_evt, data) => {
                const html = vsCodePasteHtml(data.dataTransfer);
                if (html) {
                    data.content = html;
                }
            },
            { priority: "high" }
        );
    }
}

/**
 * The HTML to paste in place of the clipboard's, or `null` if the clipboard holds no code copied
 * from VS Code.
 */
export function vsCodePasteHtml(dataTransfer: { getData(type: string): string }): string | null {
    const mode = readVsCodeMode(dataTransfer.getData(VSCODE_EDITOR_DATA));
    if (mode === null) {
        return null;
    }

    const text = dataTransfer.getData("text/plain").replace(/\r\n?/g, "\n").replace(/\n$/, "");
    if (!text.trim()) {
        return null;
    }

    if (!text.includes("\n")) {
        return `<code>${escapeHtml(text.trim())}</code>`;
    }

    const language = codeBlockLanguage(mode);
    const classAttribute = language ? ` class="language-${language}"` : "";
    return `<pre><code${classAttribute}>${escapeHtml(text)}</code></pre>`;
}

/**
 * The code block language (a MIME type normalized by `normalizeMimeTypeForCKEditor()`) for a VS Code
 * language ID, or `null` if Trilium has no MIME type for it.
 */
export function codeBlockLanguage(mode: string): string | null {
    const mime = VSCODE_LANGUAGE_MIMES[mode] ?? getMimeTypeFromMarkdownName(mode)?.mime;
    return mime ? normalizeMimeTypeForCKEditor(mime) : null;
}

/**
 * The `mode` of the {@link VSCODE_EDITOR_DATA} JSON: the language ID, or an empty string if VS Code
 * named none. `null` if the data is absent or malformed.
 */
function readVsCodeMode(editorData: string): string | null {
    if (!editorData) {
        return null;
    }

    try {
        const parsed: unknown = JSON.parse(editorData);
        if (typeof parsed !== "object" || parsed === null) {
            return null;
        }

        const mode = (parsed as { mode?: unknown }).mode;
        return typeof mode === "string" ? mode : "";
    } catch {
        return null;
    }
}

function escapeHtml(text: string) {
    return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
