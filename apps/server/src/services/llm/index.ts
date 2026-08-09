/**
 * The server's Node-only contributions to the LLM stack.
 *
 * The stack itself lives in `@triliumnext/core`, so the browser-hosted
 * (standalone) build can run it too. What could not follow it there is anything
 * that needs Node: the Claude Agent provider, which spawns the Claude Code CLI,
 * and the two tool registries that read off disk (the User Guide and the skill
 * sheets). Core exposes a seam for each; this is where the server fills them in.
 */

import { registerClaudeAgentProvider } from "@triliumnext/core/src/services/llm/index.js";
import { registerDocNoteHtmlReader } from "@triliumnext/core/src/services/llm/tools/helpers.js";
import { registerToolRegistry } from "@triliumnext/core/src/services/llm/tools/index.js";

import { ClaudeAgentProvider } from "./providers/claude_agent.js";
import { skillTools } from "./skills/index.js";
import { getDocNoteHtml } from "./tools/doc_notes.js";
import { helpTools } from "./tools/help_tools.js";

/**
 * Contribute those pieces to core. Called once from startup, beside the other
 * registrations there, rather than run as an import side effect: core's own LLM
 * routes reach the stack directly, so what a chat can use must not depend on
 * whether some module that happens to import this one was loaded first.
 */
export function registerServerLlmExtensions() {
    registerClaudeAgentProvider(() => new ClaudeAgentProvider());
    registerDocNoteHtmlReader(getDocNoteHtml);
    registerToolRegistry(helpTools);
    registerToolRegistry(skillTools);
}
