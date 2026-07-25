import "./CodeBlock.css";

import { copyTextWithToast } from "../../services/clipboard_ext";
import { t } from "../../services/i18n";
import ActionButton from "./ActionButton";

interface CodeBlockProps {
    /** The code to display. Rendered verbatim — never HTML. */
    code: string;
    /** Shows a copy-to-clipboard button in the corner. */
    copyable?: boolean;
    /** Wraps long lines instead of scrolling horizontally. */
    wrap?: boolean;
    className?: string;
}

/**
 * A read-only code block styled to match the ones rendered inside text notes.
 *
 * Text notes get their code blocks from CKEditor, which the jQuery helpers in
 * `services/syntax_highlight` decorate after the fact. That path can't be reused from
 * Preact, so this component reproduces the same treatment — shared `--code-block-*`
 * variables, the same copy affordance — for code samples rendered directly by the UI
 * (options screens, dialogs). It does not syntax-highlight: these are short, static
 * samples, and pulling in highlight.js for them would cost far more than it returns.
 */
export default function CodeBlock({ code, copyable = true, wrap, className }: CodeBlockProps) {
    return (
        <pre className={`code-block ${wrap ? "wrap" : ""} ${className ?? ""}`}>
            <code>{code}</code>
            {copyable && (
                <ActionButton
                    className="code-block-copy"
                    icon="bx bx-copy"
                    text={t("code_block.copy_title")}
                    onClick={(e) => {
                        e.stopPropagation();
                        copyTextWithToast(code);
                    }}
                />
            )}
        </pre>
    );
}
