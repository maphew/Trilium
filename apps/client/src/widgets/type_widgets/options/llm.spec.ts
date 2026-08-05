import { describe, expect, it } from "vitest";

import { buildMcpClientConfig, buildMcpClientCommand } from "./llm";

const URL = "http://192.168.1.10:8080/mcp";
const TOKEN = "your-etapi-token";

describe("MCP client configuration samples", () => {
    it("emits a config clients can paste verbatim", () => {
        const parsed = JSON.parse(buildMcpClientConfig(URL, TOKEN));

        expect(parsed).toEqual({
            mcpServers: {
                trilium: {
                    // `http` rather than the spec's `streamable-http`: Claude Code accepts
                    // both, but Cursor/VS Code only understand `http`.
                    type: "http",
                    url: URL,
                    headers: { Authorization: `Bearer ${TOKEN}` }
                }
            }
        });
        // Two-space indented so it reads as a config file rather than one long line.
        expect(buildMcpClientConfig(URL, TOKEN)).toContain('\n  "mcpServers"');
    });

    it("emits a CLI command carrying the same endpoint and header", () => {
        const command = buildMcpClientCommand(URL, TOKEN);

        expect(command).toContain(`--transport http trilium ${URL}`);
        expect(command).toContain(`--header "Authorization: Bearer ${TOKEN}"`);
        // Backslash-continued so it survives being copied into a shell as one command.
        expect(command).toContain("\\\n");
    });
});
