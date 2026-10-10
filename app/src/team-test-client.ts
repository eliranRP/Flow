import type { Session } from "@supabase/supabase-js";
import { vi } from "vitest";
import type { MyCompanies, MyInvite, Team } from "./team-api";

/**
 * FLOW-601 test client: a signed-in session and a mocked `rpc`, so the team screens run through
 * the live API (its RPC names and arguments) without a server. A test file mocks `./lib/supabase`
 * with `teamClient`; this module imports nothing that reads that module, so the mock can load it.
 * Invented ids and example.com only.
 */

export const TEAM_USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const COMPANY_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
export const COMPANY_B = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function session(): Session {
  return {
    access_token: "test",
    refresh_token: "test",
    expires_in: 3600,
    token_type: "bearer",
    user: { id: TEAM_USER, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-01-01T00:00:00Z" },
  };
}

type Answer = { data?: unknown; error?: { message: string; code?: string } | null };
type Handler = (args: Record<string, unknown> | undefined) => Answer | Promise<Answer>;

/** Each RPC's answer by name; a test replaces the ones it needs. Anything else answers null. */
export const rpcAnswers = new Map<string, Handler>();

export const teamRpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
  const handler = rpcAnswers.get(name);
  const answer = handler ? await handler(args) : { data: null };
  return { data: answer.data ?? null, error: answer.error ?? null };
});

export const teamClient = {
  auth: {
    onAuthStateChange: (callback: (event: string, value: Session | null) => void) => {
      callback("INITIAL_SESSION", session());
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
  },
  rpc: teamRpc,
};

export function rpcCalls(name: string): (Record<string, unknown> | undefined)[] {
  return teamRpc.mock.calls.filter(([called]) => called === name).map(([, args]) => args);
}

export function answer(name: string, handler: Handler | Answer): void {
  rpcAnswers.set(name, typeof handler === "function" ? handler : () => handler);
}

export function refuse(name: string, message: string, code?: string): void {
  answer(name, { error: { message, ...(code ? { code } : {}) } });
}

export const sampleTeam: Team = {
  company_id: COMPANY_A,
  role: "owner",
  can_manage: true,
  members: [
    { user_id: TEAM_USER, name: "דנה לוי", email: "dana@example.com", role: "owner", you: true },
    { user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2", name: "יוסי כהן", email: "yossi@example.com", role: "editor", you: false },
    { user_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb3", name: "מיכל אברהם", email: "michal@example.com", role: "viewer", you: false },
  ],
  invites: [],
};

export function companiesFor(role: "owner" | "editor" | "viewer", two = false): MyCompanies {
  return {
    active_id: COMPANY_A,
    role,
    companies: [
      { id: COMPANY_A, name: "חברה לדוגמה", role, is_demo: false, active: true },
      ...(two ? [{ id: COMPANY_B, name: "נכסים לדוגמה בע״מ", role: "editor" as const, is_demo: false, active: false }] : []),
    ],
  };
}

export const sampleInvite: MyInvite = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1",
  company_id: COMPANY_B,
  company_name: "נכסים לדוגמה בע״מ",
  role: "editor",
  invited_by_name: "יוסי כהן",
  created_at: "2026-10-02T09:00:00Z",
};

/** Resets the answers to an owner of one company with the sample team and no invites. */
export function resetTeamRpc(): void {
  teamRpc.mockClear();
  rpcAnswers.clear();
  answer("list_my_companies", { data: companiesFor("owner") });
  answer("list_team", { data: sampleTeam });
  answer("my_invites", { data: [] });
}

