import type { AiDiffResult } from "@triliumnext/ckeditor5";
import { diffArrays } from "diff";
import HtmlDiff from "htmldiff-js";

import { escapeHtml } from "../../../services/utils.js";

/**
 * The "Changes" view of the AI assistant's review: the response marked up against the content it
 * would replace.
 *
 * A word-level HTML diff — `htmldiff-js` on the two fragments, which is what the revisions dialog
 * shows — is the right tool only while both sides are recognisably the same text. It aligns on the
 * longest common runs of words, so a corrected typo or a tightened sentence comes out as a precise
 * mark on an otherwise readable paragraph. Give it a translation, or any rewrite that keeps the
 * meaning and none of the words, and the longest common runs are single words like "a" and "de":
 * the paragraph shreds into dozens of alternating `<del>`/`<ins>` pairs that read as neither the
 * old text nor the new one.
 *
 * So the alignment happens a level up first. Both sides are cut into top-level blocks and matched
 * against each other; only a pair that is still the same block — same container, and enough words
 * in common — is handed to the word differ. A pair that is not is shown as what it is: the old
 * block struck through, the response's block after it. A block with no counterpart is a plain
 * insertion or deletion.
 *
 * The second thing that falls out of the block pass is {@link AiDiffResult.rewriteRatio}: how much
 * of the response the alignment gave up on. The review reads it to decide whether to open on the
 * changes at all — a translation scores 1 and is shown as the plain result instead.
 */
export default function diffAiResponse(oldHtml: string, newHtml: string): AiDiffResult {
    const oldBlocks = splitIntoBlocks(oldHtml);
    const newBlocks = splitIntoBlocks(newHtml);

    // Nothing to align against, so the whole of whichever side exists is the change.
    if (!oldBlocks.length || !newBlocks.length) {
        return { html: HtmlDiff.execute(oldHtml, newHtml), rewriteRatio: 1 };
    }

    const chunks: string[] = [];
    /** Text length of the response that came out as a replacement rather than as an edit. */
    let rewrittenLength = 0;
    let removed: Block[] = [];
    let added: Block[] = [];

    // Pairs up the blocks between two anchors positionally: the model rewrote the first paragraph
    // into the first, the second into the second. Where the counts differ the extras are pure
    // insertions or deletions, which is also what a split or merged paragraph degrades to.
    function flushPending() {
        for (let index = 0; index < Math.max(removed.length, added.length); index++) {
            const before = index < removed.length ? removed[index] : null;
            const after = index < added.length ? added[index] : null;

            if (before && after) {
                if (isSameBlockRewritten(before, after)) {
                    chunks.push(HtmlDiff.execute(before.html, after.html));
                } else {
                    chunks.push(markBlock("del", before), markBlock("ins", after));
                    rewrittenLength += after.text.length;
                }
            } else if (before) {
                chunks.push(markBlock("del", before));
            } else if (after) {
                chunks.push(markBlock("ins", after));
            }
        }
        removed = [];
        added = [];
    }

    for (const part of diffArrays(oldBlocks, newBlocks, { comparator: isUnchangedBlock })) {
        if (part.removed) {
            removed = removed.concat(part.value);
        } else if (part.added) {
            added = added.concat(part.value);
        } else {
            flushPending();
            // An unchanged block is emitted in the shape the *response* gave it, so that the two
            // views show the same content and a rewrapped paragraph (a callout, a collapsible)
            // still renders as one.
            chunks.push(...part.value.map((block) => block.html));
        }
    }
    flushPending();

    const responseLength = newBlocks.reduce((total, block) => total + block.text.length, 0);
    return {
        html: chunks.join(""),
        rewriteRatio: responseLength ? rewrittenLength / responseLength : 0
    };
}

/**
 * How much of two blocks' words must coincide before their difference is worth marking word by
 * word. Below it the word differ has nothing to align on and produces noise, so the pair is shown
 * as a replacement instead — which is what a translation or a heavy rewrite is.
 */
const INLINE_DIFF_SIMILARITY = 0.4;

/** A top-level piece of a fragment: what the block pass aligns, and the unit a mark is put on. */
interface Block {
    /** The block's own HTML, as it will appear in the diff. */
    html: string;
    /** Its container's tag name, or the empty string for a run of loose inline content. */
    tag: string;
    /** Its text, whitespace-collapsed — what similarity and equality are measured over. */
    text: string;
}

/**
 * The elements that stand on their own in note content. Anything else at the top level (bare text,
 * `<strong>`, an inline image — what a selection inside a paragraph stringifies to) is inline, and
 * consecutive inline nodes are gathered into one block so that a phrase is diffed as a phrase.
 */
const BLOCK_TAGS = new Set([
    "ADDRESS", "ARTICLE", "ASIDE", "BLOCKQUOTE", "DETAILS", "DIV", "DL", "FIGURE", "FOOTER",
    "H1", "H2", "H3", "H4", "H5", "H6", "HEADER", "HR", "MAIN", "NAV", "OL", "P", "PRE",
    "SECTION", "TABLE", "UL"
]);

/**
 * Cuts a fragment into blocks. Parsed with `DOMParser` rather than through an element's
 * `innerHTML`: the document it builds is inert, so nothing in a model's response loads or runs on
 * the way past.
 */
function splitIntoBlocks(html: string): Block[] {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const blocks: Block[] = [];
    let inline: ChildNode[] = [];

    function flushInline() {
        if (inline.length) {
            blocks.push({
                html: inline.map(serialize).join(""),
                tag: "",
                text: normalize(inline.map((node) => node.textContent).join(" "))
            });
            inline = [];
        }
    }

    for (const node of Array.from(doc.body.childNodes)) {
        const element = node.nodeType === Node.ELEMENT_NODE ? (node as Element) : null;

        if (element && BLOCK_TAGS.has(element.tagName)) {
            flushInline();
            blocks.push({ html: element.outerHTML, tag: element.tagName, text: normalize(node.textContent) });
        } else if (element || node.textContent?.trim() || inline.length) {
            // Whitespace between two blocks is formatting rather than content, so it starts
            // nothing — but once a run is open, the space between two inline elements is part of
            // the text and has to stay.
            inline.push(node);
        }
    }

    flushInline();
    return blocks;
}

/** A node as it will appear in the diff. A bare text node is content, not markup, so it escapes. */
function serialize(node: ChildNode): string {
    return node.nodeType === Node.ELEMENT_NODE
        ? (node as Element).outerHTML
        : escapeHtml(node.textContent ?? "");
}

/**
 * Whether the response left a block alone. Compared by text rather than by markup, so a paragraph
 * the model wrapped in a callout or a collapsible is still recognised as the same paragraph — the
 * wrapper is visible in the block that gets rendered, and marking every word of an untouched
 * sentence to announce it would bury the wording changes the reader is looking for.
 */
function isUnchangedBlock(left: Block, right: Block): boolean {
    return left.text ? left.text === right.text : left.html === right.html;
}

/**
 * Whether a pair is the same block reworded — the case the word differ handles well — rather than
 * one block replaced by another.
 *
 * The containers have to match, and not only because a paragraph turned into a list is a
 * structural change rather than a reworded one: `htmldiff-js` interleaves the two markup streams,
 * so diffing a `<p>` against a `<ul>` emits tags that close in the wrong order, and the preview's
 * parser then puts the mess back together in whatever shape it likes.
 */
function isSameBlockRewritten(before: Block, after: Block): boolean {
    return before.tag === after.tag && similarity(before, after) >= INLINE_DIFF_SIMILARITY;
}

/**
 * How much two blocks have in common, from 0 to 1: the Sørensen–Dice coefficient over their words,
 * counting repeats, which is cheap and cares about neither word order nor markup.
 */
function similarity(before: Block, after: Block): number {
    if (before.text === after.text) {
        return before.text || before.html === after.html ? 1 : 0;
    }

    const beforeWords = tokenize(before.text);
    const afterWords = tokenize(after.text);
    if (!beforeWords.length || !afterWords.length) {
        return 0;
    }

    const remaining = new Map<string, number>();
    for (const word of beforeWords) {
        remaining.set(word, (remaining.get(word) ?? 0) + 1);
    }

    let common = 0;
    for (const word of afterWords) {
        const count = remaining.get(word) ?? 0;
        if (count) {
            remaining.set(word, count - 1);
            common++;
        }
    }

    return (2 * common) / (beforeWords.length + afterWords.length);
}

/**
 * Wraps a whole block in an insertion or deletion mark. `<ins>`/`<del>` are transparent elements,
 * so they may hold a block; the `diffblock` class is what tells the preview's stylesheet to draw
 * this one as a replaced paragraph rather than as a few struck-through words.
 */
function markBlock(mark: "ins" | "del", block: Block): string {
    const kind = mark === "ins" ? "diffins" : "diffdel";
    return `<${mark} class="${kind} diffblock">${block.html}</${mark}>`;
}

function tokenize(text: string): string[] {
    return text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function normalize(text: string | null): string {
    return (text ?? "").replace(/\s+/g, " ").trim();
}
