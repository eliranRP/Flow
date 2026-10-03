/** The address the owner pastes into an AI client. */
export function flowMcpUrl(env: { mcp?: string; supabase?: string } = {
  mcp: import.meta.env.VITE_FLOW_MCP_URL,
  supabase: import.meta.env.VITE_SUPABASE_URL,
}): string {
  const explicit = env.mcp?.trim() ?? "";
  if (explicit !== "") return explicit.replace(/\/$/, "");
  const base = env.supabase?.trim() ?? "";
  if (base === "") return "";
  return `${base.replace(/\/$/, "")}/functions/v1/flow-mcp`;
}

/** One Claude Code command. The secret is the bearer, not a second code. */
export function claudeCodeCommand(url: string, secret: string): string {
  return `claude mcp add --scope user --transport http flow ${url} --header "Authorization: Bearer ${secret}"`;
}
