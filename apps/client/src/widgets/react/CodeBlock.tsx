import "./CodeBlock.css";

import { normalizeMimeTypeForCKEditor } from "@triliumnext/commons";
import { useEffect, useLayoutEffect, useRef } from "preact/hooks";

import { copyTextWithToast } from "../../services/clipboard_ext";
import { t } from "../../services/i18n";
import { applySingleBlockSyntaxHighlight, isSyntaxHighlightEnabled } from "../../services/syntax_highlight";
import ActionButton from "./ActionButton";

interface CodeBlockProps {
    /** The code to display. Rendered verbatim — never interpreted as HTML. */
    code: string;
    /**
     * MIME type to highlight as, e.g. `application/json` or `text/x-sh`. Omit to render the
     * code unhighlighted. Highlighting is skipped when the user has turned it off for notes.
     */
    mimeType?: string;
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
 * `services/syntax_highlight` decorate after the fact. That path can't be driven from
 * Preact, so this component reproduces the same treatment — shared `--code-block-*`
 * variables, the same copy affordance, and the same highlighter — for code rendered
 * directly by the UI (options screens, dialogs).
 */
export default function CodeBlock({ code, mimeType, copyable = true, wrap, className }: CodeBlockProps) {
    const codeRef = useRef<HTMLElement>(null);

    // The <code> subtree is deliberately left out of Preact's control: highlighting swaps
    // its innerHTML, and Preact reconciling children it no longer recognises would either
    // clobber the highlight or duplicate the text. Writing the plain code in a layout
    // effect keeps it painted before the first frame, so there is no flash of empty block.
    useLayoutEffect(() => {
        if (codeRef.current) {
            codeRef.current.textContent = code;
        }
    }, [code]);

    useEffect(() => {
        const element = codeRef.current;
        if (!element || !mimeType || !isSyntaxHighlightEnabled()) {
            return;
        }

        let cancelled = false;
        void (async () => {
            await applySingleBlockSyntaxHighlight($(element), normalizeMimeTypeForCKEditor(mimeType));
            if (cancelled) {
                // A newer render is authoritative; the layout effect above has already
                // restored the correct plain text, so drop this stale highlight.
                return;
            }
            // The helper *toggles* `hljs` on the parent, so a second pass over the same
            // element would switch the theme's colours back off. Force it on instead.
            element.parentElement?.classList.add("hljs");
        })();

        return () => { cancelled = true; };
    }, [code, mimeType]);

    return (
        <pre className={`code-block ${wrap ? "wrap" : ""} ${className ?? ""}`}>
            <code ref={codeRef} />
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
