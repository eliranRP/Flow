// @vitest-environment node
import { describe, expect, it } from "vitest";
import { claudeCodeCommand, flowMcpUrl } from "./mcp-address";

describe("flow MCP address", () => {
  it("prefers the explicit address and otherwise derives it from Supabase", () => {
    expect(flowMcpUrl({ mcp: "https://mcp.example/", supabase: "https://db.example" })).toBe("https://mcp.example");
    expect(flowMcpUrl({ supabase: "https://db.example/" })).toBe("https://db.example/functions/v1/flow-mcp");
    expect(flowMcpUrl({ mcp: "  ", supabase: "" })).toBe("");
  });

  it("builds one user-scoped Claude Code command", () => {
    const command = claudeCodeCommand("https://mcp.example", "secret-once");
    expect(command).toContain("--scope user");
    expect(command).toContain('flow "https://mcp.example"');
    expect(command).toContain("Authorization: Bearer secret-once");
    expect(command.startsWith("claude mcp add ")).toBe(true);
  });
});
