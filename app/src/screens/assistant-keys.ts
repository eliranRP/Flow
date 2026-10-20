import { useQuery } from "@tanstack/react-query";
import { getSupabase } from "../lib/supabase";

/**
 * FLOW-939: the owner's AI (MCP) keys, one per assistant and device. flow-mcp's status route lists
 * the keys for the company the app shows; mint adds one (shown once), revoke stops one, restore is
 * the revoke toast's undo. Only the hash is stored; a secret lives in this page's memory only.
 */

export type AssistantScope = "read" | "read_write";
export type AssistantClient = "claude-code" | "claude-ai" | "chatgpt" | "other";

/** One key as the list and the key page show it. No hash and no secret. */
export type AssistantKey = {
  id: string;
  /** Null on a key made before FLOW-939. */
  name: string | null;
  client: AssistantClient | null;
  scope: string[];
  created_at: string;
  last_used_at: string | null;
  expires_at: string;
  expired: boolean;
};

export type AssistantStatus = {
  state: "empty" | "connected" | "expired";
  keys?: AssistantKey[];
};

export type AssistantSample = {
  state: "empty" | "loading" | "connected" | "expired" | "no-company" | "error";
  keys?: AssistantKey[];
  error?: boolean;
};

export type Minted = { id: string; secret: string; scope: string[] };

/** The assistant choices, in the board's order. */
export const CLIENTS: Array<{ value: AssistantClient; label: string }> = [
  { value: "claude-code", label: "Claude Code" },
  { value: "claude-ai", label: "Claude.ai" },
  { value: "chatgpt", label: "ChatGPT" },
  { value: "other", label: "אחר" },
];

/** How often the page asks the server while the code is on screen, so the first call turns it to the list. */
export const POLL_MS = 5000;

/** The name a key made before FLOW-939 shows: it was made without one. */
export const UNNAMED_KEY = "מפתח AI";

export function clientLabel(client: AssistantClient | null | undefined): string | null {
  return CLIENTS.find((item) => item.value === client)?.label ?? null;
}

export function scopeChoice(scope: readonly string[] | undefined): AssistantScope {
  return scope?.includes("write") ? "read_write" : "read";
}

export function scopeLabel(scope: AssistantScope): string {
  return scope === "read" ? "קריאה בלבד" : "קריאה וכתיבה";
}

export function keyName(key: Pick<AssistantKey, "name">): string {
  return key.name ?? UNNAMED_KEY;
}

/** The note's default when the name field is left empty: "<assistant> · מפתח N", N the key's place in the list. */
export function defaultKeyName(client: AssistantClient, listed: number): string {
  return `${clientLabel(client) ?? "אחר"} · מפתח ${String(listed + 1)}`;
}

/** The toast when a key joins the list. */
export function addedToast(active: number): string {
  return active === 1 ? "המפתח נוסף · מפתח פעיל אחד" : `המפתח נוסף · ${String(active)} מפתחות פעילים`;
}

/** A date in the board's dd/MM/yyyy, read in Israel time. */
export function keyDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Jerusalem" }).format(date);
}

/** Keys that still work, and those past their 90 days. */
export function activeKeys(keys: readonly AssistantKey[]): AssistantKey[] {
  return keys.filter((key) => !key.expired);
}

function keysOf(value: unknown): AssistantKey[] {
  return Array.isArray(value) ? value.filter((item): item is AssistantKey => item != null && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") : [];
}

async function readStatus(): Promise<AssistantStatus> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke<AssistantStatus>("flow-mcp/status", { body: {} });
  if (response.error || response.data == null) throw new Error("status");
  return { state: response.data.state, keys: keysOf(response.data.keys) };
}

/** The keys and their overall state, shared by the AI page, the Connections page and the Settings חיבורים row (FLOW-501). */
export function useAssistantStatusQuery(enabled: boolean, poll = false) {
  return useQuery({
    queryKey: ["mcp-status"],
    enabled,
    queryFn: readStatus,
    refetchInterval: poll ? POLL_MS : false,
  });
}

/** Thrown when the company already has 20 active keys. */
export class TooManyKeys extends Error {}

export async function mintKey(input: { scope: AssistantScope; name: string; client: AssistantClient }): Promise<Minted> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke<Minted>("flow-mcp/mint", { body: input });
  if (response.error) {
    const context = (response.error as { context?: unknown }).context;
    if (context instanceof Response && context.status === 409) throw new TooManyKeys("too_many");
    throw new Error("mint");
  }
  if (response.data == null) throw new Error("mint");
  return response.data;
}

async function changeKey(route: "revoke" | "restore", id: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const response = await supabase.functions.invoke(`flow-mcp/${route}`, { body: { id } });
  if (response.error) throw new Error(route);
}

export function revokeKey(id: string): Promise<void> {
  return changeKey("revoke", id);
}

/** The revoke toast's undo. The server allows it for 10 minutes. */
export function restoreKey(id: string): Promise<void> {
  return changeKey("restore", id);
}
