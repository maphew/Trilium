import { describe, expect, it, vi } from "vitest";

const registrations = vi.hoisted(() => ({
    claudeAgentFactory: undefined as (() => unknown) | undefined,
    docNoteReader: undefined as ((note: unknown) => string | null) | undefined,
    skillReader: undefined as ((file: string) => string | null) | undefined,
    toolRegistries: [] as unknown[]
}));

vi.mock("@triliumnext/core/src/services/llm/index.js", () => ({
    registerClaudeAgentProvider: (factory: () => unknown) => { registrations.claudeAgentFactory = factory; }
}));
vi.mock("@triliumnext/core/src/services/llm/skills.js", () => ({
    registerSkillReader: (reader: (file: string) => string | null) => { registrations.skillReader = reader; }
}));
vi.mock("@triliumnext/core/src/services/llm/tools/helpers.js", () => ({
    registerDocNoteHtmlReader: (reader: (note: unknown) => string | null) => { registrations.docNoteReader = reader; }
}));
vi.mock("@triliumnext/core/src/services/llm/tools/index.js", () => ({
    registerToolRegistry: (registry: unknown) => { registrations.toolRegistries.push(registry); }
}));

import { registerServerLlmExtensions } from "./index.js";
import { ClaudeAgentProvider } from "./providers/claude_agent.js";
import { helpTools } from "./tools/help_tools.js";

describe("registerServerLlmExtensions", () => {
    it("hands core every piece of the stack that needs Node", () => {
        registerServerLlmExtensions();

        // The subscription provider, which shells out to the Claude Code CLI.
        // Registered as a factory, so nothing is constructed until a chat asks for it.
        expect(registrations.claudeAgentFactory?.()).toBeInstanceOf(ClaudeAgentProvider);
        // The User Guide reader, which core's note-content helper calls for doc notes.
        expect(registrations.docNoteReader).toBeTypeOf("function");
        // The skill sheets: core owns the catalog and the tool, the server only
        // knows how to get a sheet off disk.
        expect(registrations.skillReader?.("search_syntax.md")).toContain("#");
        // The one registry still backed by files this build alone carries.
        expect(registrations.toolRegistries).toEqual([helpTools]);
    });
});
