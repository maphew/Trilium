import { describe, expect, it } from "vitest";

import { buildNote } from "../test/becca_easy_mocking";
import { findLlmChatExcerpts } from "./backlink_excerpts";

function chatContent(messages: unknown[]) {
    return JSON.stringify({ messages });
}

describe("findLlmChatExcerpts", () => {
    it("quotes the assistant prose around the wiki-link, links titled and text escaped", () => {
        buildNote({ id: "excTarget", title: "Chat target" });
        buildNote({ id: "excOther", title: "Other <note>" });

        const excerpts = findLlmChatExcerpts(chatContent([
            { role: "user", content: "where is [[excTarget]] mentioned?" },
            {
                role: "assistant",
                content: [
                    { type: "text", content: "I found 1 < 2 results in [[excTarget]] next to [[excOther]]." }
                ]
            }
        ]), "excTarget");

        expect(excerpts).toHaveLength(1);
        expect(excerpts[0]).toMatch(/^<div class="ck-content backlink-excerpt">/);
        expect(excerpts[0]).toContain("I found 1 &lt; 2 results in");
        expect(excerpts[0]).toContain(`<a class="reference-link backlink-link" href="#root/excTarget">Chat target</a>`);
        expect(excerpts[0]).toContain(`<a class="reference-link" href="#root/excOther">Other &lt;note&gt;</a>`);
    });

    it("renders the markdown instead of quoting it verbatim", () => {
        buildNote({ id: "excMd", title: "Md target" });

        const excerpts = findLlmChatExcerpts(chatContent([
            {
                role: "assistant",
                content: [
                    { type: "text", content: "It is **very** relevant to [[excMd]]:\n\n- one\n- two" }
                ]
            }
        ]), "excMd");

        expect(excerpts[0]).toContain("<strong>very</strong>");
        expect(excerpts[0]).toContain("<li>one</li>");
        expect(excerpts[0]).not.toContain("**");
    });

    it("keeps a regular markdown link's own text and titles a link to an unknown note with the raw ID", () => {
        const excerpts = findLlmChatExcerpts(chatContent([
            {
                role: "assistant",
                content: [
                    { type: "text", content: "See [my name](#root/excMissing) and [[excMissing]]." }
                ]
            }
        ]), "excMissing");

        expect(excerpts).toHaveLength(2);
        expect(excerpts[0]).toContain(">my name</a>");
        expect(excerpts[1]).toContain(">excMissing</a>");
    });

    it("truncates long neighboring paragraphs with ellipses, one excerpt per mention", () => {
        buildNote({ id: "excLong", title: "Long target" });

        const excerpts = findLlmChatExcerpts(chatContent([
            {
                role: "assistant",
                content: [
                    { type: "text", content: `${"a".repeat(260)}\n\nHere: [[excLong]]\n\n${"b".repeat(260)}` },
                    { type: "text", content: "Also see [[excLong]]." }
                ]
            }
        ]), "excLong");

        expect(excerpts).toHaveLength(2);
        // Like text-note excerpts, expansion stops at the first truncated paragraph, so the
        // budget goes to the text preceding the link.
        expect(excerpts[0]).toMatch(/…a+/);
        expect(excerpts[0]).toContain(`<a class="reference-link backlink-link" href="#root/excLong">Long target</a>`);
        expect(excerpts[1]).toContain("Also see <a");
    });

    it("quotes nothing from tool calls, thinking blocks, user prose, or broken content", () => {
        const quiet = chatContent([
            {
                role: "assistant",
                content: [
                    { type: "tool_call", toolCall: { input: { noteId: "excQuiet" } } },
                    { type: "thinking", content: "peeking at [[excQuiet]]" }
                ]
            },
            { role: "user", content: "the [[excQuiet]] wiki-link in user prose creates no relation" }
        ]);

        expect(findLlmChatExcerpts(quiet, "excQuiet")).toEqual([]);
        expect(findLlmChatExcerpts("not JSON at all", "excQuiet")).toEqual([]);
        expect(findLlmChatExcerpts(`{"messages": "not an array"}`, "excQuiet")).toEqual([]);
    });
});
