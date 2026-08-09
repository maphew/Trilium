/**
 * LLM tools that wrap existing Trilium services.
 * These reuse the same logic as ETAPI without any HTTP overhead.
 */

export { attachmentTools } from "./attachment_tools.js";
export { attributeTools } from "./attribute_tools.js";
export { hierarchyTools } from "./hierarchy_tools.js";
export { iconTools } from "./icon_tools.js";
export { noteTools } from "./note_tools.js";
export type { ToolDefinition } from "./tool_registry.js";
export { ToolRegistry } from "./tool_registry.js";

import { attachmentTools } from "./attachment_tools.js";
import { attributeTools } from "./attribute_tools.js";
import { hierarchyTools } from "./hierarchy_tools.js";
import { iconTools } from "./icon_tools.js";
import { noteTools } from "./note_tools.js";
import type { ToolRegistry } from "./tool_registry.js";

/**
 * All tool registries, for consumers that need to iterate every tool (e.g. MCP).
 *
 * Registries whose tools depend on a runtime core cannot provide — currently
 * the help and skill tools, which read the User Guide and the skill sheets off
 * disk — are contributed by the host via {@link registerToolRegistry} rather
 * than listed here, so the browser-hosted build simply runs without them.
 */
export const allToolRegistries: ToolRegistry[] = [
    noteTools,
    attributeTools,
    attachmentTools,
    hierarchyTools,
    iconTools
];

/**
 * Add a host-provided tool registry. Must be called before the first chat turn
 * or MCP tool listing, both of which read {@link allToolRegistries} eagerly.
 * Registering the same registry twice is a no-op, so a host that initialises
 * more than once (tests, Electron reloads) does not duplicate its tools.
 */
export function registerToolRegistry(registry: ToolRegistry) {
    if (!allToolRegistries.includes(registry)) {
        allToolRegistries.push(registry);
    }
}
