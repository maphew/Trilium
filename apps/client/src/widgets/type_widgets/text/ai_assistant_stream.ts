import type { AiCompletionUsage, AiStreamFunction } from "@triliumnext/ckeditor5";
import type { LlmChatConfig, LlmMessage, LlmModelInfo, LlmUsage } from "@triliumnext/commons";

import { streamChatCompletion } from "../../../services/llm_chat.js";
import options from "../../../services/options.js";

/**
 * Builds the transport behind the editor's AI assistant balloon (`config.aiAssistant.stream`):
 * a completion streamed from the user's default LLM provider through the existing
 * `/api/llm-chat/stream` endpoint, accumulated into the cumulative-HTML shape the plugin expects.
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
        const messages: LlmMessage[] = [
            { role: "system", content: SYSTEM_PROMPT },
            {
                role: "user",
                content: request.context
                    ? `Content:\n${request.context}\n\nTask: ${request.query}`
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
                    onData(cumulative);
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
 * The assistant works HTML-in/HTML-out: the context is the selection's HTML and the response is
 * committed through the editor's data pipeline, so anything but clean HTML (markdown, fences,
 * commentary) would end up as literal text in the note.
 */
const SYSTEM_PROMPT = `You are a writing assistant embedded in a rich text editor of a note-taking application.
The user gives you a task, usually together with the HTML of the content it applies to.

Rules:
- Respond ONLY with HTML. No markdown, no code fences, no explanations, no preamble.
- Use simple HTML: <p>, <strong>, <em>, <ul>, <ol>, <li>, <h2>-<h5>, <table>, <blockquote>, <code>, <a>.
- When rewriting content, preserve its structure and formatting unless the task says otherwise.
- Respond in the same language as the content, unless the task says otherwise.`;

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
 * The provider/model the assistant uses: the first configured provider's default model (or its
 * first model). The same resolution the LLM chat starts out with — a per-run model picker in the
 * balloon can come later.
 */
function pickDefaultModel(): LlmChatConfig {
    for (const config of readProviderConfigs()) {
        const model = config.selectedModels?.find((m) => m.isDefault) ?? config.selectedModels?.[0];
        if (model) {
            return { model: model.id, provider: config.provider, providerId: config.id };
        }
    }
    // No selected models anywhere: let the server resolve the provider's own default.
    return {};
}
