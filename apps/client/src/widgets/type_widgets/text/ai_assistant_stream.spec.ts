// @vitest-environment jsdom
// The pipeline ends in DOMPurify, which needs browser-faithful NodeIterator traversal; happy-dom
// mishandles it and drops the first node of every fragment. Same reason as sanitize_content.spec.
import type { LlmChatConfig } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Keys stand in for their translations; a key with interpolation renders as `key(name=value)`, so
// a composed label shows both the key it went through and what was substituted into it.
vi.mock("../../../services/i18n.js", () => ({
    t: (key: string, values?: Record<string, string>) => (values
        ? `${key}(${Object.entries(values).map(([name, value]) => `${name}=${value}`).join(",")})`
        : key)
}));
vi.mock("../../../services/options.js", () => ({
    default: { getJson: () => storedProviders }
}));
vi.mock("../../../services/llm_chat.js", () => ({
    streamChatCompletion: vi.fn(async (messages, config, callbacks) => {
        requestedConfigs.push(config);
        requestedMessages.push(messages);
        for (const chunk of responseChunks) {
            callbacks.onChunk(chunk);
        }
        callbacks.onDone();
    })
}));
// The context is converted by the server: turndown lives in core, which the client cannot import.
vi.mock("../../../services/server.js", () => ({
    default: { post: vi.fn(async (_url: string, data: { htmlContent: string }) => toMarkdownResult(data.htmlContent)) }
}));
vi.mock("../../../services/task_states.js", () => ({ getTaskStateDefinitions: async () => [] }));

import buildAiAssistantStream, { buildAiAssistantQuickActions, stripMarkdownFences } from "./ai_assistant_stream.js";

/** The `llmProviders` option as the mocked `options.getJson` will return it. */
let storedProviders: unknown = null;
/** The config each `streamChatCompletion` call was made with, in order. */
let requestedConfigs: LlmChatConfig[] = [];
/** The messages each `streamChatCompletion` call was made with, in order. */
let requestedMessages: Array<Array<{ role: string; content: string }>> = [];
/** What the mocked stream emits, one `onChunk` per entry. */
let responseChunks: string[] = ["done"];
/** Stands in for `POST other/to-markdown`; throws to exercise the fallback. */
let toMarkdownResult: (html: string) => { markdownContent: string } = () => ({ markdownContent: "teh" });

const PROVIDER = [{ id: "cfg-openai", provider: "openai", selectedModels: [{ id: "gpt-5", isDefault: true }] }];

beforeEach(() => {
    storedProviders = null;
    requestedConfigs = [];
    requestedMessages = [];
    responseChunks = ["done"];
    toMarkdownResult = () => ({ markdownContent: "teh" });
});

/** Runs one completion through the built stream, collecting everything handed to `onData`. */
async function run(context = "<p>teh</p>"): Promise<{ config: LlmChatConfig; prompt: string; rendered: string[] }> {
    const stream = buildAiAssistantStream();
    if (!stream) {
        throw new Error("expected the assistant to be enabled");
    }
    const rendered: string[] = [];
    await stream({ query: "Fix typos", context }, (html) => rendered.push(html), new AbortController().signal);
    return {
        config: requestedConfigs[0],
        prompt: requestedMessages[0]?.find((message) => message.role === "user")?.content ?? "",
        rendered
    };
}

/** Runs one completion and returns just the provider/model config it sent. */
async function runOnce(): Promise<LlmChatConfig> {
    return (await run()).config;
}

describe("buildAiAssistantStream", () => {
    it("stays disabled when no provider is configured", () => {
        expect(buildAiAssistantStream()).toBeUndefined();
        storedProviders = [];
        expect(buildAiAssistantStream()).toBeUndefined();
    });

    it("uses the first provider's default model, else its first", async () => {
        storedProviders = [{
            id: "cfg-openai",
            provider: "openai",
            selectedModels: [{ id: "gpt-5-mini" }, { id: "gpt-5", isDefault: true }]
        }];
        expect(await runOnce()).toEqual({ model: "gpt-5", provider: "openai", providerId: "cfg-openai" });

        requestedConfigs = [];
        storedProviders = [{ id: "cfg-openai", provider: "openai", selectedModels: [{ id: "gpt-5-mini" }] }];
        expect(await runOnce()).toEqual({ model: "gpt-5-mini", provider: "openai", providerId: "cfg-openai" });
    });

    it("skips providers without a selected model", async () => {
        storedProviders = [
            { id: "cfg-openai", provider: "openai" },
            { id: "cfg-ollama", provider: "ollama", selectedModels: [{ id: "llama4" }] }
        ];
        expect(await runOnce()).toEqual({ model: "llama4", provider: "ollama", providerId: "cfg-ollama" });
    });

    it("still names the provider when no provider has a selected model", async () => {
        // Without this the request names nothing and the server falls back to Anthropic, which
        // either fails outright or silently answers from the wrong provider.
        storedProviders = [
            { id: "cfg-openai", provider: "openai" },
            { id: "cfg-ollama", provider: "ollama", selectedModels: [] }
        ];
        expect(await runOnce()).toEqual({ provider: "openai", providerId: "cfg-openai" });
    });
});

describe("the Markdown pipeline", () => {
    beforeEach(() => {
        storedProviders = PROVIDER;
    });

    it("sends the context as Markdown, converted by the server", async () => {
        toMarkdownResult = (html) => ({ markdownContent: html + " as markdown" });

        const { prompt } = await run("<p>teh</p>");
        expect(prompt).toContain("<p>teh</p> as markdown");
        expect(prompt).toContain("Task: Fix typos");
    });

    it("sends no context at all when generating from scratch", async () => {
        const { prompt } = await run("");
        expect(prompt).toBe("Fix typos");
    });

    it("falls back to the HTML context when the conversion fails", async () => {
        // Losing the conversion is worth far less than losing the run.
        toMarkdownResult = () => { throw new Error("offline"); };
        vi.spyOn(console, "warn").mockImplementation(() => {});

        const { prompt } = await run("<p>teh</p>");
        expect(prompt).toContain("<p>teh</p>");
    });

    it("renders the cumulative Markdown to HTML on every chunk", async () => {
        responseChunks = ["# Ti", "tle\n\nsome ", "**bold** text"];

        const { rendered } = await run();
        expect(rendered).toHaveLength(3);
        // Each render is of the whole buffer, so a heading cut mid-word is still a heading —
        // demoted to <h2>, since in Trilium the note title is the document's <h1>.
        expect(rendered[0]).toContain("<h2");
        expect(rendered[2]).toContain("<strong>bold</strong>");
    });

    it("turns the Trilium syntaxes the prompt advertises into their markup", async () => {
        responseChunks = [
            "> [!TIP]\n> Watch out\n\n",
            "- [ ] ship it\n\n",
            "\u0060\u0060\u0060mermaid\nflowchart TD\n  a-->b\n\u0060\u0060\u0060\n"
        ];

        const [, , html] = (await run()).rendered;
        expect(html).toContain('<aside class="admonition tip">');
        expect(html).toContain('<ul class="todo-list">');
        expect(html).toContain("language-mermaid");
    });

    // Markdown has no collapsible syntax, so the model writes the HTML — which only keeps its
    // Markdown formatted when the blank lines separate it from the surrounding block.
    it("formats the content inside a collapsible, given the blank lines the prompt asks for", async () => {
        responseChunks = ["<details>\n<summary>More</summary>\n\n- one\n- two\n\n</details>"];

        const [html] = (await run()).rendered;
        expect(html).toContain("<summary>More</summary>");
        expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    });

    it("leaves a collapsible's content unformatted when the model omits them", async () => {
        // Documented so the prompt's insistence on blank lines is not mistaken for noise.
        responseChunks = ["<details><summary>More</summary>\n- one\n</details>"];

        const [html] = (await run()).rendered;
        expect(html).toContain("- one");
        expect(html).not.toContain("<li>one</li>");
    });

    // The Diagram action asks for the code block and nothing else, so the whole answer is a
    // fence — one the stripper must not mistake for a wrapper.
    it("keeps a diagram whose fence is the entire answer", async () => {
        responseChunks = ["```mermaid\nflowchart TD\n  a-->b\n```"];

        const [html] = (await run()).rendered;
        expect(html).toContain("language-mermaid");
        expect(html).toContain("flowchart TD");
    });

    it("strips a fence the model wrapped the whole answer in", async () => {
        responseChunks = ["\u0060\u0060\u0060markdown\n**bold**\n\u0060\u0060\u0060"];

        const [html] = (await run()).rendered;
        expect(html).toContain("<strong>bold</strong>");
        expect(html).not.toContain("\u0060\u0060\u0060");
    });
});

describe("stripMarkdownFences", () => {
    const fence = "\u0060\u0060\u0060";

    it("returns unfenced content unchanged", () => {
        expect(stripMarkdownFences("plain")).toBe("plain");
    });

    it("strips a complete fence pair", () => {
        expect(stripMarkdownFences(fence + "markdown\nhi\n" + fence)).toBe("hi\n");
        expect(stripMarkdownFences(fence + "\nhi\n" + fence + "\n")).toBe("hi\n");
    });

    it("strips an opening fence whose closing half has not streamed in yet", () => {
        expect(stripMarkdownFences(fence + "markdown\nst")).toBe("st");
    });

    it("leaves a fence that names content alone", () => {
        expect(stripMarkdownFences(fence + "mermaid\nflowchart TD\n" + fence))
            .toBe(fence + "mermaid\nflowchart TD\n" + fence);
        expect(stripMarkdownFences(fence + "js\nconst a = 1;\n" + fence))
            .toBe(fence + "js\nconst a = 1;\n" + fence);
    });

    it("does not treat a fence inside the content as a closing one", () => {
        expect(stripMarkdownFences(fence + "markdown\nuse " + fence + " for fences\nmore"))
            .toBe("use " + fence + " for fences\nmore");
    });
});

describe("buildAiAssistantQuickActions", () => {
    function actions(groupId: string) {
        const group = buildAiAssistantQuickActions().find((candidate) => candidate.id === groupId);
        if (!group) {
            throw new Error(`no quick-action group with id "${groupId}"`);
        }
        return group.actions;
    }

    // A tone or a language means nothing on its own once it is away from its group heading, which
    // is where the `/` palette shows it.
    it("composes a standalone command label for the tones and the languages", () => {
        const direct = actions("tone").find((action) => action.id === "direct");
        expect(direct?.label).toBe("ai_assistant.tone_direct");
        expect(direct?.commandLabel).toBe("ai_assistant.command_tone(tone=ai_assistant.tone_direct)");

        const romanian = actions("translate").find((action) => action.id === "translateRomanian");
        expect(romanian?.label).toBe("ai_assistant.lang_romanian");
        expect(romanian?.commandLabel).toBe("ai_assistant.command_translate(language=ai_assistant.lang_romanian)");
        // The instruction is not translated: it is addressed to the model, not to the user.
        expect(romanian?.prompt).toBe("Translate the content to Romanian.");
    });

    // "Make shorter" against "Simplify language", "Turn into a table" against "Extract action
    // items": no single phrase composes either pair, so both labels are translated as a pair.
    it("spells out both labels for the adjustments and the reformats", () => {
        expect(actions("adjust").map((action) => [action.label, action.commandLabel])).toEqual([
            ["ai_assistant.adjust_shorter", "ai_assistant.command_make_shorter"],
            ["ai_assistant.adjust_longer", "ai_assistant.command_make_longer"],
            ["ai_assistant.adjust_simpler", "ai_assistant.command_simplify"]
        ]);
        expect(actions("reformat").map((action) => [action.label, action.commandLabel])).toEqual([
            ["ai_assistant.reformat_bullet_list", "ai_assistant.command_bullet_list"],
            ["ai_assistant.reformat_table", "ai_assistant.command_table"],
            ["ai_assistant.reformat_diagram", "ai_assistant.command_diagram"],
            ["ai_assistant.reformat_callout", "ai_assistant.command_callout"],
            ["ai_assistant.reformat_collapsible", "ai_assistant.command_collapsible"],
            ["ai_assistant.reformat_action_items", "ai_assistant.command_action_items"]
        ]);
    });

    // Two entries one click apart must not carry the same instruction, or the menu offers the same
    // rewrite twice under different names.
    it("keeps the length actions and the tones from asking for the same thing", () => {
        const promptOf = (groupId: string, id: string) =>
            actions(groupId).find((action) => action.id === id)?.prompt ?? "";

        // The direct tone is about voice, not length — length belongs to Make shorter.
        expect(promptOf("tone", "direct")).toContain("active voice");
        expect(promptOf("tone", "direct")).not.toMatch(/shorten|essential information|non-essential/i);

        // Improve writing leaves the mechanics to Fix typos and the length to Make shorter.
        expect(promptOf("edit", "improveWriting")).not.toMatch(/mistakes|tighten/i);
        expect(promptOf("adjust", "makeShorter")).toMatch(/shorten/i);
        expect(promptOf("edit", "fixTypos")).toMatch(/spelling, grammar and punctuation/i);
    });

    it("inlines the groups whose actions already read as commands", () => {
        const groups = buildAiAssistantQuickActions();
        expect(groups.filter((group) => group.submenu).map((group) => group.id))
            .toEqual(["adjust", "tone", "reformat", "translate"]);
        expect(groups.filter((group) => !group.submenu).map((group) => group.id))
            .toEqual(["edit", "generate"]);
    });

    // A new action reaching the menu without an icon should fail here rather than ship a gap in
    // the column. Two exemptions, both pinned so they read as decisions: an inlined group has no
    // heading to put an icon on, and the languages share a panel with nothing that has one.
    it("gives every action, and every submenu, an icon from the pack", () => {
        for (const group of buildAiAssistantQuickActions()) {
            if (group.submenu) {
                expect(group.iconClass, group.id).toMatch(/^bx bx-[a-z-]+$/);
            } else {
                expect(group.iconClass, group.id).toBeUndefined();
            }
            for (const action of group.actions) {
                if (group.id === "translate") {
                    expect(action.iconClass, action.id).toBeUndefined();
                } else {
                    expect(action.iconClass, action.id).toMatch(/^bx bx-[a-z-]+$/);
                }
            }
        }
    });

    it("leaves the labels that already read as commands alone", () => {
        for (const action of [ ...actions("edit"), ...actions("generate") ]) {
            expect(action.commandLabel).toBeUndefined();
        }
    });

    // The actions that answer with a replacement rather than an edit open their review on the
    // result; everything else lets the diff of the run decide, which is what an unset view means.
    it("sends the replacements to the result view and leaves the edits to the diff", () => {
        const reviewViews = new Map(buildAiAssistantQuickActions()
            .flatMap((group) => group.actions)
            .map((action) => [action.id, action.reviewView]));

        expect([ ...reviewViews ].filter(([, view]) => view === "result").map(([id]) => id))
            .toEqual([
                "summarize", "explain", "continue", "table", "diagram", "actionItems",
                "translateEnglish", "translateGerman", "translateSpanish", "translateFrench",
                "translateRomanian", "translateChinese"
            ]);
        for (const id of ["fixTypos", "improveWriting", "makeShorter", "professional", "callout"]) {
            expect(reviewViews.get(id), id).toBeUndefined();
        }
    });
});
