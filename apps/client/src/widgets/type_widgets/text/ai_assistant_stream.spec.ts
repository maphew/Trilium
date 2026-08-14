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
    streamChatCompletion: vi.fn(async (_messages, config, callbacks) => {
        requestedConfigs.push(config);
        callbacks.onChunk("<p>hi</p>");
        callbacks.onDone();
    })
}));

import buildAiAssistantStream, { buildAiAssistantQuickActions } from "./ai_assistant_stream.js";

/** The `llmProviders` option as the mocked `options.getJson` will return it. */
let storedProviders: unknown = null;
/** The config each `streamChatCompletion` call was made with, in order. */
let requestedConfigs: LlmChatConfig[] = [];

beforeEach(() => {
    storedProviders = null;
    requestedConfigs = [];
});

/** Runs one completion through the built stream and returns the config it sent. */
async function runOnce(): Promise<LlmChatConfig> {
    const stream = buildAiAssistantStream();
    if (!stream) {
        throw new Error("expected the assistant to be enabled");
    }
    await stream({ query: "Fix typos", context: "<p>teh</p>" }, () => {}, new AbortController().signal);
    const [config] = requestedConfigs;
    return config;
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

    it("leaves the labels that already read as commands alone", () => {
        for (const action of [ ...actions("edit"), ...actions("generate") ]) {
            expect(action.commandLabel).toBeUndefined();
        }
    });
});
