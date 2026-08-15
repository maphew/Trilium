import type { AiCompletionUsage, AiQuickAction, AiQuickActionGroup, AiStreamFunction } from "@triliumnext/ckeditor5";
import type { LlmChatConfig, LlmMessage, LlmModelInfo, LlmUsage, ToMarkdownResponse } from "@triliumnext/commons";

import { t } from "../../../services/i18n.js";
import { streamChatCompletion } from "../../../services/llm_chat.js";
import options from "../../../services/options.js";
import { sanitizeNoteContentHtml } from "../../../services/sanitize_content.js";
import server from "../../../services/server.js";
import { getTaskStateDefinitions } from "../../../services/task_states.js";

/**
 * Builds the transport behind the editor's AI assistant (`config.aiAssistant.stream`): a
 * completion streamed from the user's default LLM provider through the existing
 * `/api/llm-chat/stream` endpoint, accumulated into the cumulative-HTML shape the plugin expects.
 *
 * **The model works in Markdown, not HTML.** The editor speaks HTML on both ends, so the context
 * is converted on the way in and every streamed chunk is rendered on the way out. That buys more
 * than cheaper tokens and a format the model is fluent in: admonitions, mermaid diagrams and task
 * lists come out of Trilium's own Markdown renderer, from syntax the model already knows, instead
 * of markup we would have to dictate in the system prompt and hope it reproduces byte for byte.
 *
 * Returns `undefined` when no LLM provider is configured, which disables the feature in the
 * editor. Like the snippet list, the provider set is read when the editor is built — configuring
 * a first provider shows the button after the editor is next rebuilt.
 */
export default function buildAiAssistantStream(): AiStreamFunction | undefined {
    if (!readProviderConfigs().length) {
        return undefined;
    }

    return async (request, onData, signal): Promise<AiCompletionUsage> => {
        // Both are needed before the first token and neither depends on the other.
        const [context, renderMarkdown] = await Promise.all([
            toMarkdown(request.context),
            loadMarkdownRenderer()
        ]);

        const messages: LlmMessage[] = [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content: context
                    ? `Content:\n${context}\n\nTask: ${request.query}`
                    : request.query
            }
        ];

        const config = pickDefaultModel();
        let cumulative = "";
        const usage = await new Promise<LlmUsage | null>((resolve, reject) => {
            let reported: LlmUsage | null = null;
            streamChatCompletion(messages, config, {
                onChunk: (text) => {
                    cumulative += text;
                    onData(renderMarkdown(cumulative));
                },
                onUsage: (chunk) => {
                    reported = chunk;
                },
                onError: (error) => reject(new Error(error)),
                onDone: () => resolve(reported)
            }, signal).then(
                // A stream that ends without a "done" event (connection dropped) still settles.
                () => resolve(reported),
                reject
            );
        });

        return {
            // The server reports the model's display name; fall back to the id we asked for.
            model: usage?.model ?? config.model,
            totalTokens: usage?.totalTokens,
            cost: usage?.cost
        };
    };
}

/**
 * The predefined instructions for the balloon's "Quick actions" dropdown, modelled on the premium
 * AI assistant's default command set. Labels are translated here (the plugin renders them as
 * given); prompts stay English — they are instructions to the model, not UI.
 */
export function buildAiAssistantQuickActions(): AiQuickActionGroup[] {
    return decorate([
        {
            id: "edit",
            label: t("ai_assistant.group_edit"),
            actions: [
                action("fixTypos", t("ai_assistant.action_fix_typos"),
                    "Fix all spelling, grammar and punctuation mistakes. Do not change the meaning, tone or formatting."),
                // Deliberately not "fix mistakes and tighten the phrasing": that made this the same
                // instruction as Fix typos and Make shorter, which are one click away either side.
                action("improveWriting", t("ai_assistant.action_improve_writing"),
                    "Improve the clarity, flow and word choice of this content, keeping its meaning and roughly its length.")
            ]
        },
        {
            id: "generate",
            label: t("ai_assistant.group_generate"),
            actions: [
                action("summarize", t("ai_assistant.action_summarize"),
                    "Summarize this content into one short paragraph containing only the key ideas and conclusions."),
                action("explain", t("ai_assistant.action_explain"),
                    "Explain this content in plain language: what it says, and what it means for someone unfamiliar with it. Keep the explanation brief."),
                action("continue", t("ai_assistant.action_continue"),
                    "Continue writing from the end of the provided content, staying on topic and matching its style. Keep the continuation brief.")
            ]
        },
        {
            // The three ways of saying the same thing differently, as against improving it
            // (Improve writing), replacing it (Summarize, Explain) or correcting it (Fix typos).
            id: "adjust",
            label: t("ai_assistant.group_adjust"),
            submenu: true,
            actions: [
                spelledOutAction("makeShorter", t("ai_assistant.adjust_shorter"), t("ai_assistant.command_make_shorter"),
                    "Shorten this content by removing repetition and non-essential details, without losing key information."),
                spelledOutAction("makeLonger", t("ai_assistant.adjust_longer"), t("ai_assistant.command_make_longer"),
                    "Expand this content with more detail and clearer explanations, keeping the original meaning."),
                spelledOutAction("simplify", t("ai_assistant.adjust_simpler"), t("ai_assistant.command_simplify"),
                    "Rewrite this content in simpler language so that it is easier to understand.")
            ]
        },
        {
            id: "tone",
            label: t("ai_assistant.group_tone"),
            submenu: true,
            actions: [
                toneAction("professional", t("ai_assistant.tone_professional"),
                    "Rewrite this content in a polished, formal, professional tone without changing the meaning."),
                toneAction("casual", t("ai_assistant.tone_casual"),
                    "Rewrite this content in a casual, conversational tone without changing the meaning."),
                // A tone, not a length: "keeping only the essential information" made this Make
                // shorter under another name.
                toneAction("direct", t("ai_assistant.tone_direct"),
                    "Rewrite this content in a direct tone: active voice, no hedging and no throat-clearing. Keep all of the information."),
                toneAction("friendly", t("ai_assistant.tone_friendly"),
                    "Rewrite this content in a warm, friendly tone without changing the meaning."),
                toneAction("confident", t("ai_assistant.tone_confident"),
                    "Rewrite this content in a confident, assertive tone without changing the meaning.")
            ]
        },
        {
            id: "reformat",
            label: t("ai_assistant.group_reformat"),
            submenu: true,
            actions: [
                spelledOutAction("bulletList", t("ai_assistant.reformat_bullet_list"), t("ai_assistant.command_bullet_list"),
                    "Rewrite this content as a bulleted list, one point per item, without losing information."),
                spelledOutAction("table", t("ai_assistant.reformat_table"), t("ai_assistant.command_table"),
                    "Reorganize this content into a table with a header row, choosing columns that fit what the content describes."),
                spelledOutAction("diagram", t("ai_assistant.reformat_diagram"), t("ai_assistant.command_diagram"),
                    "Express this content as a Mermaid diagram inside a `mermaid` code block — a flowchart unless another Mermaid diagram type fits the content better. Respond with the code block only."),
                spelledOutAction("callout", t("ai_assistant.reformat_callout"), t("ai_assistant.command_callout"),
                    "Turn this content into a single callout, opening with the marker that fits it best — `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!CAUTION]` or `> [!WARNING]` — and keeping the wording."),
                // The blank lines are not cosmetic: without them the content sits inside one HTML
                // block and its Markdown is never processed (verified against the renderer).
                spelledOutAction("collapsible", t("ai_assistant.reformat_collapsible"), t("ai_assistant.command_collapsible"),
                    "Wrap this content in a collapsible section: a line with <details>, then a <summary> line saying in a few words what it hides, then a blank line, then the content unchanged, then a blank line and </details>."),
                // A real task list rather than a plain one: `- [ ]` is Markdown the model already
                // writes, and the renderer turns it into the editor's `todo-list` markup.
                spelledOutAction("actionItems", t("ai_assistant.reformat_action_items"), t("ai_assistant.command_action_items"),
                    "Extract the action items from this content as an unchecked task list (`- [ ] …`), each one short and starting with a verb. Leave out anything that is not an action.")
            ]
        },
        {
            id: "translate",
            label: t("ai_assistant.group_translate"),
            submenu: true,
            actions: [
                translateAction("translateEnglish", t("ai_assistant.lang_english"), "Translate the content to English."),
                translateAction("translateGerman", t("ai_assistant.lang_german"), "Translate the content to German."),
                translateAction("translateSpanish", t("ai_assistant.lang_spanish"), "Translate the content to Spanish."),
                translateAction("translateFrench", t("ai_assistant.lang_french"), "Translate the content to French."),
                translateAction("translateRomanian", t("ai_assistant.lang_romanian"), "Translate the content to Romanian."),
                translateAction("translateChinese", t("ai_assistant.lang_chinese"), "Translate the content to Simplified Chinese.")
            ]
        }
    ]);
}

/**
 * The Boxicon each action and submenu shows in the menu — the icon pack the rest of the app draws
 * from, so no SVG is involved (the editor plugin renders the classes on a `<span>`, the same way
 * the template list renders a note's icon).
 *
 * Kept as one table keyed by id rather than threaded through the label helpers: those are about how
 * a label reads as a command, and one list is easier to keep complete than twenty-odd call sites.
 * The inlined groups are absent on purpose — without a heading there is nothing to put an icon on.
 */
const ICONS: Record<string, string> = {
    // Submenus.
    adjust: "bx bx-ruler",
    tone: "bx bx-palette",
    reformat: "bx bx-shape-square",
    translate: "bx bx-globe",

    // Edit or review.
    fixTypos: "bx bx-check-double",
    improveWriting: "bx bx-brush",

    // Generate.
    summarize: "bx bx-align-left",
    explain: "bx bx-bulb",
    continue: "bx bx-fast-forward",

    // Adjust.
    makeShorter: "bx bx-collapse-vertical",
    makeLonger: "bx bx-expand-vertical",
    simplify: "bx bx-leaf",

    // Change tone.
    professional: "bx bx-briefcase",
    casual: "bx bx-coffee",
    direct: "bx bx-target-lock",
    friendly: "bx bx-smile",
    confident: "bx bx-medal",

    // Reformat.
    bulletList: "bx bx-list-ul",
    table: "bx bx-table",
    diagram: "bx bx-network-chart",
    callout: "bx bx-info-circle",
    collapsible: "bx bx-chevrons-down",
    actionItems: "bx bx-task"

    // The languages are deliberately absent. The pack has no flags and nothing else tells German
    // from French, so the choice was one repeated glyph or none. `bx-empty` — Trilium's slot
    // reserver — is for an item sitting next to items that *do* have icons; the Translate submenu
    // is its own panel holding nothing but languages, so there is nothing to line up against.
};

/**
 * The actions whose answer replaces what it was given instead of editing it: a translation, a
 * summary, a diagram. Their review opens on the result — an inline diff of two texts with nothing
 * in common says nothing, however well it is rendered, and the answer is what wants reading.
 *
 * Only the outright replacements are listed. Everything else lets the run decide for itself, from
 * how much of the response the differ could align (see `diffAiResponse`) — which is also what
 * answers for a prompt the user typed, where there is no definition to go on.
 */
const REPLACEMENT_GROUPS = new Set(["translate"]);
const REPLACEMENT_ACTIONS = new Set(["summarize", "explain", "continue", "table", "diagram", "actionItems"]);

/**
 * Hangs {@link ICONS} and the review view on the definitions by id, leaving the ids that have
 * neither untouched. Kept out of the definitions themselves so that each stays about what it asks
 * the model for, and so that one list per concern can be read for completeness.
 */
function decorate(groups: AiQuickActionGroup[]): AiQuickActionGroup[] {
    return groups.map((group) => ({
        ...group,
        iconClass: ICONS[group.id],
        actions: group.actions.map((action) => ({
            ...action,
            iconClass: ICONS[action.id],
            reviewView: REPLACEMENT_GROUPS.has(group.id) || REPLACEMENT_ACTIONS.has(action.id)
                ? "result" as const
                : undefined
        }))
    }));
}

/** Shorthand for a quick-action entry; all defaults require content to work on. */
function action(id: string, label: string, prompt: string): AiQuickAction {
    return { id, label, prompt };
}

/**
 * A tone or a language reads as a command only together with what its group heading says: the menu
 * lists a bare "Direct" under "Change tone", while the `/` palette has to spell out "Change tone to
 * Direct". Composed here rather than in the editor so that a locale can reorder the two halves —
 * and pick the right preposition and case for the language name.
 */
function toneAction(id: string, tone: string, prompt: string): AiQuickAction {
    return { id, label: tone, commandLabel: t("ai_assistant.command_tone", { tone }), prompt };
}

/** The prompt stays English and spelled out: the label is translated, the instruction is not. */
function translateAction(id: string, language: string, prompt: string): AiQuickAction {
    return { id, label: language, commandLabel: t("ai_assistant.command_translate", { language }), prompt };
}

/**
 * An action that needs the two labels spelled out rather than composed. Adjust and Reformat both
 * read as a bare word under their heading ("Shorter", "Table") and so need the standalone wording
 * the `/` palette shows, but neither composes from a single phrase the way a tone or a language
 * does — "Make shorter" against "Simplify language", "Turn into a table" against "Extract action
 * items". So the pair is translated as a pair.
 */
function spelledOutAction(id: string, label: string, commandLabel: string, prompt: string): AiQuickAction {
    return { id, label, commandLabel, prompt };
}

/**
 * The assistant works Markdown-in/Markdown-out. Anything but the bare result — commentary, a
 * preamble, a fence around the whole answer — is committed into the note verbatim, so the prompt
 * is blunt about it.
 *
 * The syntaxes listed are the ones {@link loadMarkdownRenderer} turns into Trilium constructs, so
 * naming them is what makes callouts, diagrams and task lists reachable without describing any
 * markup: the model writes the Markdown it already knows and the renderer produces our HTML.
 */
const SYSTEM_PROMPT = `You are a writing assistant embedded in a rich text editor of a note-taking application.
The user gives you a task, usually together with the Markdown of the content it applies to.

Rules:
- Respond ONLY with the resulting Markdown. No explanations, no preamble, no code fence around the answer.
- GitHub-flavoured Markdown is supported: headings, tables, footnotes and task lists (\`- [ ]\`).
- \`> [!NOTE]\`, \`> [!TIP]\`, \`> [!IMPORTANT]\`, \`> [!CAUTION]\` and \`> [!WARNING]\` render as coloured callouts.
- A \`mermaid\` code block renders as a diagram.
- When rewriting content, preserve its structure and formatting unless the task says otherwise.
- Respond in the same language as the content, unless the task says otherwise.`;

/**
 * The selection, as Markdown for the model. The conversion is the server's: turndown and the rules
 * that keep admonitions, `<details>`, math and reference links intact live in `trilium-core`, which
 * the client cannot import — and unlike the response, the context is one string sent once, so a
 * round-trip before the stream costs a fraction of the completion that follows.
 *
 * A failed conversion falls back to the HTML. The model reads HTML perfectly well; losing the
 * conversion is worth far less than losing the run.
 */
async function toMarkdown(html: string): Promise<string> {
    if (!html.trim()) {
        return "";
    }
    try {
        const { markdownContent } = await server.post<ToMarkdownResponse>("other/to-markdown", { htmlContent: html });
        return markdownContent;
    } catch (error) {
        console.warn("AI assistant: could not convert the context to Markdown, sending HTML", error);
        return html;
    }
}

/**
 * The Markdown → HTML pass applied to the cumulative response on every chunk — the same shape the
 * LLM chat renders streamed replies with, re-rendering the whole buffer rather than appending to
 * it, which is what keeps a half-written table or fence from rendering as garbage.
 *
 * `marked` is a heavy import, so it is pulled in only once the assistant actually runs.
 */
async function loadMarkdownRenderer(): Promise<(markdown: string) => string> {
    const [{ renderToHtml }, taskStates] = await Promise.all([
        import("@triliumnext/commons/src/lib/markdown_renderer"),
        getTaskStateDefinitions()
    ]);

    return (markdown) => renderToHtml(stripMarkdownFences(markdown), "", {
        sanitize: sanitizeNoteContentHtml,
        taskStates,
        wikiLink: { formatHref: (id) => `#root/${id}` }
    });
}

/**
 * Info strings that mean "here is my answer" rather than naming content. A fence carrying any
 * other language is part of the response: a `mermaid` block is the whole point of the Diagram
 * action, and unwrapping it leaves the diagram source rendering as a paragraph of text.
 */
const WRAPPER_FENCE_LANGUAGES = new Set(["", "markdown", "md", "html"]);

/**
 * Removes the code fence a model wrapped its whole answer in, closing half included when it has
 * arrived. Models add these despite instructions not to; the stripper runs against the cumulative
 * stream, so it also has to handle a fence whose closing half has not streamed in yet.
 *
 * A bare ``` is treated as a wrapper, which is what it almost always is. The cost is that an
 * answer that is nothing but an unlabelled code block loses its fence — cheap next to leaving
 * every wrapped answer rendering as source.
 */
export function stripMarkdownFences(cumulative: string): string {
    const opening = /^\s*```([a-z]*)\s*\n?/i.exec(cumulative);
    if (!opening || !WRAPPER_FENCE_LANGUAGES.has(opening[1].toLowerCase())) {
        return cumulative;
    }

    let body = cumulative.slice(opening[0].length);
    const closingIndex = body.lastIndexOf("```");
    if (closingIndex !== -1 && body.slice(closingIndex + 3).trim() === "") {
        body = body.slice(0, closingIndex);
    }
    return body;
}

/** The subset of a stored `llmProviders` entry this module reads. */
interface StoredProviderConfig {
    id: string;
    provider: string;
    selectedModels?: LlmModelInfo[];
}

function readProviderConfigs(): StoredProviderConfig[] {
    return (options.getJson("llmProviders") as StoredProviderConfig[] | null) ?? [];
}

/**
 * The provider/model the assistant uses: the first configured provider that has a model selected,
 * preferring its default. The same resolution the LLM chat starts out with — a per-run model
 * picker in the balloon can come later.
 *
 * The provider is always named, even when no model can be: the server falls back to
 * `getProviderByType("anthropic")` for a request that names none (`runChat` in
 * `packages/trilium-core/src/services/llm/chat.ts`), which would fail outright for an
 * OpenAI-only setup and silently use the wrong provider for a mixed one. Naming the provider
 * without a model instead lets the server resolve that provider's own default.
 */
function pickDefaultModel(): LlmChatConfig {
    const configs = readProviderConfigs();
    for (const config of configs) {
        const model = config.selectedModels?.find((m) => m.isDefault) ?? config.selectedModels?.[0];
        if (model) {
            return { model: model.id, provider: config.provider, providerId: config.id };
        }
    }

    const [first] = configs;
    return first ? { provider: first.provider, providerId: first.id } : {};
}
