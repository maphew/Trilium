/**
 * The server's entry point into the LLM stack.
 *
 * The stack itself lives in `@triliumnext/core` so the browser-hosted
 * (standalone) build can run it too. What stays here is everything that needs
 * Node: the Claude Agent provider, which spawns the Claude Code CLI, and the
 * two tool registries that read off disk (the User Guide and the skill sheets).
 * Importing this module contributes them to core; it is the only supported way
 * in, so nothing can reach a half-registered stack.
 */

import { registerClaudeAgentProvider } from "@triliumnext/core/src/services/llm/index.js";
import { registerDocNoteHtmlReader } from "@triliumnext/core/src/services/llm/tools/helpers.js";
import { registerToolRegistry } from "@triliumnext/core/src/services/llm/tools/index.js";

import { ClaudeAgentProvider } from "./providers/claude_agent.js";
import { skillTools } from "./skills/index.js";
import { getDocNoteHtml } from "./tools/doc_notes.js";
import { helpTools } from "./tools/help_tools.js";

export {
    clearProviderCache,
    getProvider,
    getProviderByType,
    getSelectedModel,
    hasConfiguredProviders,
    listProviderModels,
    type LlmProvider,
    type LlmProviderConfig,
    type LlmProviderSetup,
    type ModelInfo,
    type ModelPricing
} from "@triliumnext/core/src/services/llm/index.js";
export { allToolRegistries } from "@triliumnext/core/src/services/llm/tools/index.js";
export type { ToolDefinition } from "@triliumnext/core/src/services/llm/tools/tool_registry.js";

registerClaudeAgentProvider(() => new ClaudeAgentProvider());
registerDocNoteHtmlReader(getDocNoteHtml);
registerToolRegistry(helpTools);
registerToolRegistry(skillTools);
