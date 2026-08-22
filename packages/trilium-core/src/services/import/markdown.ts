import { renderToHtml as renderToHtmlShared } from "@triliumnext/commons/src/lib/markdown_renderer.js";
import { HTMLElement, Node, NodeType, parse as parseHtml } from "node-html-parser";

import { sanitizeHtml } from "../sanitizer.js";
import { getTaskStates } from "../task_states.js";

function renderToHtml(content: string, title: string, opts?: { obsidian?: boolean }): string {
    const html = renderToHtmlShared(content, title, {
        sanitize: sanitizeHtml,
        taskStates: getTaskStates(),
        obsidian: opts?.obsidian
    });
    return normalizeCollapsibles(html);
}

export default {
    renderToHtml
};

/**
 * Restores what `buildDetailsFilter()` in `services/export/markdown.ts` gives up when it
 * writes a `<details>` block to Markdown: the `trilium-collapsible` class, and the absence
 * of whitespace between block children, which that filter indents for readability. Both are
 * what the collapsible CKEditor plugin downcasts, so a note that goes out to Markdown and
 * comes back keeps the content it started with instead of changing on its next save.
 */
function normalizeCollapsibles(html: string): string {
    if (!html.includes("<details")) {
        return html;
    }

    const root = parseHtml(html);
    const collapsibles = root.querySelectorAll("details");
    if (!collapsibles.length) {
        return html;
    }

    for (const collapsible of collapsibles) {
        // The plugin builds the element around `class`, so writing the attributes back in that
        // order keeps a collapsible the user has expanded (`open=""`) byte-identical too.
        const { class: classNames, ...rest } = collapsible.attributes;
        const classList = classNames ? classNames.split(/\s+/) : [];
        if (!classList.includes(COLLAPSIBLE_CLASS)) {
            classList.push(COLLAPSIBLE_CLASS);
        }
        collapsible.setAttributes({ class: classList.join(" "), ...rest });
        removeLayoutWhitespace(collapsible);
    }
    return root.toString();
}

/**
 * Drops whitespace-only text nodes from an element whose children are blocks, and recurses
 * into the block containers `buildDetailsFilter()` indents. An element holding text of its
 * own is left alone, so spacing that separates inline content survives. Whitespace inside
 * `<pre>` is never reached — `<pre>` is not one of the containers.
 */
function removeLayoutWhitespace(element: HTMLElement) {
    const isText = (node: Node) => node.nodeType === NodeType.TEXT_NODE;
    const holdsText = (node: Node) => isText(node) && node.rawText.trim() !== "";

    if (!element.childNodes.some(holdsText)) {
        element.childNodes = element.childNodes.filter((node) => !isText(node) || holdsText(node));
    }

    for (const child of element.childNodes) {
        if (child instanceof HTMLElement && BLOCK_CONTAINER_TAGS.has(child.tagName)) {
            removeLayoutWhitespace(child);
        }
    }
}

/** The styling hook `collapsible_editing.ts` downcasts onto every `<details>` it writes. */
const COLLAPSIBLE_CLASS = "trilium-collapsible";

/** Mirrors `DETAILS_CONTAINER_TAGS` in `services/export/markdown.ts`, the tags it indents into. */
const BLOCK_CONTAINER_TAGS = new Set(["DETAILS", "UL", "OL", "LI", "BLOCKQUOTE"]);
