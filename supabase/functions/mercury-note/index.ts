import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../../packages/shared/src/database.types.ts";
import { MERCURY_KEK_REF } from "../_shared/connectors/mercury/capabilities.ts";
import { mercuryAdapter } from "../_shared/connectors/mercury/adapter.ts";
import { readConnectionScope } from "../_shared/connectors/mercury/scope.ts";
import { sendMercuryNote } from "../_shared/connectors/mercury/thread.ts";
import { decodeKek, envelopeFromRow, openApiKey } from "../_shared/envelope.ts";
import { empty, json } from "../_shared/http.ts";

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Promise<Response> | Response): void;
};

type Target = {
  note_id: string;
  company_id: string;
  external_id: string;
  account_id: string | null;
  body: string;
  updated_at: string;
};

/**
 * FLOW-957: sends a Mercury note edited in Flow back to Mercury, right after the edit.
 * POST { note_id } with the user's JWT. The database decides what may be sent
 * (mercury_note_push_target: a writer's own company's note that waits). The key is the connection
 * whose accounts hold the line. Answers { state: "sent" | "denied" | "waiting" | "nothing" }:
 * denied keeps the edit in Flow (the key may not write); waiting is sent by the next Mercury sync.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return empty();
  if (req.method !== "POST") return json({ error: "method" }, 405);
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const anon = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const kekSecret = Deno.env.get(MERCURY_KEK_REF) ?? "";
  if (!url || !anon || !service || !kekSecret) return json({ error: "server is missing a secret" }, 500);

  const body = (await req.json().catch(() => ({}))) as { note_id?: unknown };
  const noteId = typeof body.note_id === "string" && /^[0-9a-f-]{36}$/.test(body.note_id) ? body.note_id : null;
  if (!noteId) return json({ error: "note_id" }, 400);

  const userClient = createClient<Database>(url, anon, {
    global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const found = await userClient.rpc("mercury_note_push_target", { p_note_id: noteId });
  if (found.error) return json({ error: "unauthorized" }, 401);
  const target = found.data as unknown as Target | null;
  if (!target) return json({ state: "nothing" });

  const admin = createClient<Database>(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
  const rows = await admin.from("connector_connections").select("*")
    .eq("company_id", target.company_id).eq("provider", "mercury");
  if (rows.error || (rows.data ?? []).length === 0) return json({ state: "waiting" });
  const connections = (rows.data ?? []) as unknown as Record<string, unknown>[];
  const row = connections.find((candidate) => {
    const scope = readConnectionScope(candidate);
    return target.account_id != null && (scope.syncAccountIds ?? scope.accountIds).includes(target.account_id);
  }) ?? connections[0]!;

  let apiKey = "";
  try {
    apiKey = await openApiKey(envelopeFromRow(row), decodeKek(kekSecret), target.company_id, "mercury");
  } catch {
    return json({ state: "waiting" });
  }
  const outcome = await sendMercuryNote(mercuryAdapter.open(apiKey), target.external_id, target.body);
  if (outcome === "retry") return json({ state: "waiting" });
  const state = outcome === "sent" ? "sent" : "denied";
  await admin.rpc("mercury_note_pushed", {
    p_note_id: target.note_id,
    p_updated_at: target.updated_at,
    p_state: state,
  });
  return json({ state });
});
