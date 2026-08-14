import type { LlmChatConfig } from "@triliumnext/commons";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../services/i18n.js", () => ({ t: (key: string) => key }));
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

import buildAiAssistantStream from "./ai_assistant_stream.js";

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
