/**
 * Builds backlink content previews for `llmChat` notes: the counterpart of `findExcerpts`
 * (routes/api/note_map.ts), which does the same for `text` notes by walking their HTML.
 *
 * A chat stores its whole conversation as one JSON blob (`{ messages: [...] }`), and its
 * internalLink relations come from `[[noteId]]` wiki-links in assistant text blocks (see
 * `findLlmChatLinks` in services/notes.ts). Excerpts therefore quote the assistant prose
 * around each wiki-link pointing at the referenced note; a chat that references the note
 * purely through tool calls has nothing quotable and yields no excerpts.
 */

import becca from "../becca/becca";
import { escapeHtml } from "./utils/index";

/** Character budget of one excerpt, shared with the text-note excerpts of note_map.ts. */
export const EXCERPT_CHAR_LIMIT = 200;

/**
 * Quotes the assistant prose around each `[[noteId]]` wiki-link pointing at the referenced
 * note, as `ck-content backlink-excerpt` HTML fragments (the shape the backlinks UI renders).
 * Returns an empty array for unparseable content or a chat with no quotable mention.
 */
export function findLlmChatExcerpts(jsonContent: string, referencedNoteId: string): string[] {
    let parsed: { messages?: unknown[] };
    try {
        parsed = JSON.parse(jsonContent);
    } catch {
        return [];
    }
    if (!Array.isArray(parsed.messages)) {
        return [];
    }

    const excerpts: string[] = [];
    for (const message of parsed.messages) {
        if (typeof message !== "object" || message === null) continue;
        const { role, content } = message as Record<string, unknown>;
        if (role !== "assistant" || !Array.isArray(content)) continue;

        for (const block of content) {
            if (typeof block !== "object" || block === null) continue;
            const b = block as Record<string, unknown>;
            if (b.type !== "text" || typeof b.content !== "string") continue;

            const tokens = tokenizeChatText(b.content);
            for (let i = 0; i < tokens.length; i++) {
                if (tokens[i].noteId === referencedNoteId) {
                    excerpts.push(buildChatExcerpt(tokens, i, referencedNoteId));
                }
            }
        }
    }
    return excerpts;
}

/**
 * A chat's text split into plain-text runs and `[[noteId]]` wiki-links, so an excerpt window
 * can truncate text freely but never cut through a link.
 */
interface ChatToken {
    /** The linked note's ID for a wiki-link token, undefined for a plain text run. */
    noteId?: string;
    text: string;
}

const WIKI_LINK_RE = /\[\[([a-zA-Z0-9_]+)\]\]/g;

function tokenizeChatText(text: string): ChatToken[] {
    const tokens: ChatToken[] = [];
    let lastIndex = 0;
    let match: RegExpExecArray | null;

    WIKI_LINK_RE.lastIndex = 0;
    while ((match = WIKI_LINK_RE.exec(text))) {
        if (match.index > lastIndex) {
            tokens.push({ text: text.substring(lastIndex, match.index) });
        }
        tokens.push({ noteId: match[1], text: match[0] });
        lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) {
        tokens.push({ text: text.substring(lastIndex) });
    }
    return tokens;
}

/** What the token contributes to the excerpt's visible length: links show their note's title. */
function chatTokenLength(token: ChatToken): number {
    return token.noteId ? chatLinkTitle(token.noteId).length : token.text.length;
}

function chatLinkTitle(noteId: string): string {
    return becca.notes[noteId]?.getTitleOrProtected() ?? noteId;
}

function renderChatToken(token: ChatToken, referencedNoteId: string): string {
    if (!token.noteId) {
        return escapeHtml(token.text);
    }
    const classes = token.noteId === referencedNoteId
        ? "reference-link backlink-link"
        : "reference-link";
    return `<a class="${classes}" href="#root/${token.noteId}">${escapeHtml(chatLinkTitle(token.noteId))}</a>`;
}

/**
 * Grows a window of tokens around the matched link until {@link EXCERPT_CHAR_LIMIT}, truncating
 * an overflowing text run with an ellipsis — the same expansion findExcerpts does over sibling
 * DOM nodes, over chat tokens instead.
 */
function buildChatExcerpt(tokens: ChatToken[], centerIndex: number, referencedNoteId: string): string {
    const parts: string[] = [renderChatToken(tokens[centerIndex], referencedNoteId)];
    let excerptLength = chatTokenLength(tokens[centerIndex]);
    let left = centerIndex - 1;
    let right = centerIndex + 1;

    while (excerptLength < EXCERPT_CHAR_LIMIT) {
        let added = false;

        if (left >= 0) {
            const token = tokens[left];
            const tokenLength = chatTokenLength(token);

            if (tokenLength + excerptLength > EXCERPT_CHAR_LIMIT) {
                if (!token.noteId) {
                    const prefix = token.text.substring(token.text.length - (EXCERPT_CHAR_LIMIT - excerptLength));
                    parts.unshift(`…${escapeHtml(prefix)}`);
                }
                break;
            }

            parts.unshift(renderChatToken(token, referencedNoteId));
            excerptLength += tokenLength;
            left--;
            added = true;
        }

        if (right < tokens.length) {
            const token = tokens[right];
            const tokenLength = chatTokenLength(token);

            if (tokenLength + excerptLength > EXCERPT_CHAR_LIMIT) {
                if (!token.noteId) {
                    const suffix = token.text.substring(0, EXCERPT_CHAR_LIMIT - excerptLength);
                    parts.push(`${escapeHtml(suffix)}…`);
                }
                break;
            }

            parts.push(renderChatToken(token, referencedNoteId));
            excerptLength += tokenLength;
            right++;
            added = true;
        }

        if (!added) {
            break;
        }
    }

    return `<div class="ck-content backlink-excerpt"><p>${parts.join("")}</p></div>`;
}
