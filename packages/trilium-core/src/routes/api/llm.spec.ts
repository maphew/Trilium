import { afterEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
    models: [] as unknown[],
    /** Records the credentials the route passed to listProviderModels. */
    args: undefined as unknown[] | undefined,
    /** When set, listProviderModels rejects with this (simulates a bad key). */
    throws: undefined as unknown
}));

// The route reaches the provider registry through a dynamic import, so that the
// AI SDK stays out of the startup chunk; mocking the module id covers it either way.
vi.mock("../../services/llm/index.js", () => ({
    listProviderModels: async (...args: unknown[]) => {
        state.args = args;
        if (state.throws !== undefined) throw state.throws;
        return state.models;
    }
}));

import { getProviderModels } from "./llm.js";

describe("getProviderModels", () => {
    afterEach(() => {
        state.models = [];
        state.args = undefined;
        state.throws = undefined;
    });

    it("lists models for the credentials in the request body, defaulting a missing key to an empty string", async () => {
        state.models = [{ id: "m1" }];
        await expect(getProviderModels({ body: { provider: "openai", apiKey: "sk-test", baseURL: "http://localhost:11434/v1" } }))
            .resolves.toEqual({ models: [{ id: "m1" }] });
        expect(state.args).toEqual(["openai", "sk-test", "http://localhost:11434/v1"]);

        // The subscription provider carries no key of its own — auth is Claude Code's.
        await getProviderModels({ body: { provider: "claude-agent" } });
        expect(state.args).toEqual(["claude-agent", "", undefined]);
    });

    it("throws when no provider is given", async () => {
        await expect(getProviderModels({ body: {} as never })).rejects.toThrow(/provider is required/);
    });

    it("surfaces a listing failure instead of masking it, whether or not it is an Error", async () => {
        state.throws = new Error("Authentication failed (HTTP 401) — check the API key.");
        await expect(getProviderModels({ body: { provider: "openai", apiKey: "bad-key" } }))
            .rejects.toThrow(/Authentication failed \(HTTP 401\)/);

        state.throws = "socket hang up";
        await expect(getProviderModels({ body: { provider: "openai", apiKey: "k" } }))
            .rejects.toThrow("socket hang up");
    });
});
