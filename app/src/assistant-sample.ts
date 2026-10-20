import type { AssistantKey } from "./screens/assistant-keys";

/** A shown-once fixture. Not a live token. */
export const SAMPLE_ASSISTANT_SECRET = "flw_test_7f3c9a1e2b8046d5c0a91e44b7d2";

/** FLOW-939: the board's two keys (invented names and dates), for stories, the dev route and tests. */
export const SAMPLE_ASSISTANT_KEYS: AssistantKey[] = [
  {
    id: "mcp-key-1",
    name: "Claude Code · מחשב עבודה",
    client: "claude-code",
    scope: ["read", "write"],
    created_at: "2026-10-09T08:00:00.000Z",
    last_used_at: "2026-09-30T11:05:00.000Z",
    expires_at: "2027-01-07T08:00:00.000Z",
    expired: false,
  },
  {
    id: "mcp-key-2",
    name: "Claude.ai · טלפון",
    client: "claude-ai",
    scope: ["read"],
    created_at: "2026-09-14T08:00:00.000Z",
    last_used_at: null,
    expires_at: "2026-12-13T08:00:00.000Z",
    expired: false,
  },
];

/** A key made before FLOW-939 (no name, no assistant) that is past its 90 days. */
export const SAMPLE_EXPIRED_KEY: AssistantKey = {
  id: "mcp-key-old",
  name: null,
  client: null,
  scope: ["read"],
  created_at: "2026-04-01T08:00:00.000Z",
  last_used_at: "2026-06-20T07:30:00.000Z",
  expires_at: "2026-06-30T08:00:00.000Z",
  expired: true,
};
