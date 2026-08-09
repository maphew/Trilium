/**
 * The server's Node-only contributions to the LLM stack.
 *
 * The stack itself lives in `@triliumnext/core`, so the browser-hosted
 * (standalone) build can run it too. What could not follow it there is anything
 * that needs Node: the Claude Agent provider, which spawns the Claude Code CLI,
 * and the User Guide tools, which read pages off disk. Core exposes a seam for
 * each; this is where the server fills them in — including the skill sheets,
 * whose catalog is core's while the reading is per-runtime.
 */

import { registerClaudeAgentProvider } from "@triliumnext/core/src/services/llm/index.js";
import { registerSkillReader } from "@triliumnext/core/src/services/llm/skills.js";
import { registerDocNoteHtmlReader } from "@triliumnext/core/src/services/llm/tools/helpers.js";
import { registerToolRegistry } from "@triliumnext/core/src/services/llm/tools/index.js";

import { loadSkillSheet } from "../../core_assets.js";
import { ClaudeAgentProvider } from "./providers/claude_agent.js";
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
    registerSkillReader(loadSkillSheet);
    registerToolRegistry(helpTools);
}
