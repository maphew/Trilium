import { describe, expect, it } from "vitest";

import { buildNote } from "../test/becca_easy_mocking";
import { findLlmChatExcerpts } from "./llm_chat_excerpts";

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

        expect(excerpts).toEqual([
            `<div class="ck-content backlink-excerpt"><p>I found 1 &lt; 2 results in ` +
            `<a class="reference-link backlink-link" href="#root/excTarget">Chat target</a> next to ` +
            `<a class="reference-link" href="#root/excOther">Other &lt;note&gt;</a>.</p></div>`
        ]);
    });

    it("titles a link to an unknown note with the raw ID", () => {
        const excerpts = findLlmChatExcerpts(chatContent([
            { role: "assistant", content: [ { type: "text", content: "See [[excMissing]]." } ] }
        ]), "excMissing");

        expect(excerpts[0]).toContain(`>excMissing</a>`);
    });

    it("truncates long text runs with ellipses, one excerpt per mention", () => {
        buildNote({ id: "excLong", title: "Long target" });

        const excerpts = findLlmChatExcerpts(chatContent([
            {
                role: "assistant",
                content: [
                    { type: "text", content: `${"a".repeat(260)} [[excLong]] ${"b".repeat(260)}` },
                    { type: "text", content: "Also see [[excLong]]." }
                ]
            }
        ]), "excLong");

        expect(excerpts).toHaveLength(2);
        // Like findExcerpts for text notes, expansion stops at the first truncated run, so the
        // whole budget goes to the text preceding the link and none is left for the text after.
        expect(excerpts[0]).toMatch(/…a+ <a class="reference-link backlink-link"/);
        expect(excerpts[0]).not.toMatch(/b{3}/);
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
