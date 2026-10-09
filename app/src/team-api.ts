import { createContext, createElement, useContext, type ReactNode } from "react";
import { getSupabase } from "./lib/supabase";
import { ROLE_CHOICE_LABEL } from "./ui/role-choice";
import { assertNoError, isTransientWriteError, type WriteFailure } from "./use-write";
import type { AcceptResult, InviteResult, MyCompanies, MyInvite, Team, TeamMember } from "./team-schemas";

/**
 * FLOW-601 (decision 0167): the team and company RPCs the app calls, their payloads, and the
 * words the app shows for each answer. Screens read the API from context, so a story or a dev
 * fixture can hand them an in-memory team without a backend.
 */

export type TeamRole = "owner" | "editor" | "viewer";
export type MemberRole = "editor" | "viewer";

export const ROLE_LABEL: Record<TeamRole, string> = { owner: "בעלים", ...ROLE_CHOICE_LABEL };

export type {
  AcceptResult,
  InviteResult,
  MyCompanies,
  MyCompany,
  MyInvite,
  Team,
  TeamInvite,
  TeamMember,
} from "./team-schemas";

/** FLOW-804: the schemas load with the first team call, not with Home's first paint. */
const loadSchemas = () => import("./team-schemas");

export type TeamApi = {
  /** False when there is no client to call, as in a story without a fake. */
  ready: () => boolean;
  /** An in-memory team (a story, a dev fixture) answers for this user without a session. */
  sampleUser?: string;
  listMyCompanies: () => Promise<MyCompanies>;
  switchCompany: (companyId: string) => Promise<void>;
  listTeam: () => Promise<Team>;
  inviteMember: (email: string, role: MemberRole) => Promise<InviteResult>;
  cancelInvite: (inviteId: string) => Promise<void>;
  setMemberRole: (userId: string, role: MemberRole) => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  myInvites: () => Promise<MyInvite[]>;
  acceptInvite: (inviteId: string) => Promise<AcceptResult>;
  declineInvite: (inviteId: string) => Promise<void>;
  reopenInvite: (inviteId: string) => Promise<void>;
};

function client() {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  return supabase;
}

/** The live API: one Postgres RPC per call (supabase/migrations/…_team_members.sql). */
export const liveTeamApi: TeamApi = {
  ready: () => {
    const supabase = getSupabase();
    return supabase != null && typeof supabase.rpc === "function";
  },
  listMyCompanies: async () => {
    const result = await client().rpc("list_my_companies");
    assertNoError(result);
    // A missing payload is a user with no company yet, as a missing company row was before.
    return (await loadSchemas()).myCompaniesSchema.parse(result.data ?? { active_id: null, role: null, companies: [] });
  },
  switchCompany: async (companyId) => {
    assertNoError(await client().rpc("switch_company", { p_company_id: companyId }));
  },
  listTeam: async () => {
    const result = await client().rpc("list_team");
    assertNoError(result);
    return (await loadSchemas()).teamSchema.parse(result.data);
  },
  inviteMember: async (email, role) => {
    const result = await client().rpc("invite_member", { p_email: email, p_role: role });
    assertNoError(result);
    return (await loadSchemas()).inviteResultSchema.parse(result.data);
  },
  cancelInvite: async (inviteId) => {
    assertNoError(await client().rpc("cancel_invite", { p_invite_id: inviteId }));
  },
  setMemberRole: async (userId, role) => {
    assertNoError(await client().rpc("set_member_role", { p_user_id: userId, p_role: role }));
  },
  removeMember: async (userId) => {
    assertNoError(await client().rpc("remove_member", { p_user_id: userId }));
  },
  myInvites: async () => {
    const result = await client().rpc("my_invites");
    assertNoError(result);
    return (await loadSchemas()).myInvitesSchema.parse(result.data ?? []);
  },
  acceptInvite: async (inviteId) => {
    const result = await client().rpc("accept_invite", { p_invite_id: inviteId });
    assertNoError(result);
    return (await loadSchemas()).acceptResultSchema.parse(result.data);
  },
  declineInvite: async (inviteId) => {
    assertNoError(await client().rpc("decline_invite", { p_invite_id: inviteId }));
  },
  reopenInvite: async (inviteId) => {
    assertNoError(await client().rpc("reopen_invite", { p_invite_id: inviteId }));
  },
};

const TeamApiContext = createContext<TeamApi>(liveTeamApi);

/** Hands the team screens another API: an in-memory team for a story or a dev fixture. */
export function TeamApiProvider({ api, children }: { api: TeamApi; children: ReactNode }) {
  return createElement(TeamApiContext.Provider, { value: api }, children);
}

export function useTeamApi(): TeamApi {
  return useContext(TeamApiContext);
}

// Words. Short, gender-neutral (DESIGN-RULES §3.6).
export const INVITE_SENT = "ההזמנה נשלחה";
export const INVITE_UPDATED = "ההזמנה עודכנה";
export const INVITE_CANCELLED = "ההזמנה בוטלה";
export const INVITE_FAILED = "ההזמנה לא נשלחה.";
export const INVITE_EMAIL_MISSING = "כתבו אימייל.";
export const INVITE_EMAIL_INVALID = "כתבו אימייל תקין.";
export const INVITE_ALREADY_MEMBER = "כבר בצוות.";
export const INVITE_TOO_MANY = "יש יותר מדי הזמנות פתוחות. בטלו אחת ונסו שוב.";
export const OWNER_ONLY = "רק בעל העסק יכול לשנות את הצוות.";
export const ROLE_SAVED = "התפקיד עודכן";
export const ROLE_FAILED = "התפקיד לא עודכן.";
export const MEMBER_REMOVED = "הגישה לעסק הוסרה";
export const REMOVE_FAILED = "לא הצלחנו להסיר מהצוות.";
export const CANCEL_FAILED = "לא הצלחנו לבטל את ההזמנה.";
export const JOIN_FAILED = "לא הצלחנו להצטרף.";
export const INVITE_DECLINED = "ההזמנה נדחתה";
export const DECLINE_FAILED = "לא הצלחנו לדחות את ההזמנה.";
export const REOPEN_FAILED = "כבר אי אפשר לבטל את הדחייה.";
export const INVITE_GONE = "ההזמנה כבר לא פתוחה.";
export const MEMBER_GONE = "כבר לא בצוות.";
export const SWITCH_FAILED = "לא הצלחנו לעבור לחברה.";

/** A simple shape check before the request; the server has the last word (`invalid email`). */
export function inviteEmailError(value: string): string | undefined {
  const clean = value.trim();
  if (clean === "") return INVITE_EMAIL_MISSING;
  if (clean.length < 3 || clean.length > 254 || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) return INVITE_EMAIL_INVALID;
  return undefined;
}

function refusedByRole(error: Error): boolean {
  const code = (error as Error & { code?: string }).code;
  return code === "42501" || error.message === "forbidden";
}

/** Where an invite refusal shows: on the email field, or as a toast. */
export function inviteRefusal(error: Error): { field: string } | { toast: WriteFailure } {
  if (error.message === "invalid email") return { field: INVITE_EMAIL_INVALID };
  if (error.message === "already a member") return { field: INVITE_ALREADY_MEMBER };
  if (error.message === "too many invites") return { toast: { message: INVITE_TOO_MANY, retry: false } };
  if (refusedByRole(error)) return { toast: { message: OWNER_ONLY, retry: false } };
  return { toast: { message: INVITE_FAILED, retry: isTransientWriteError(error) } };
}

/** A team write the server refused for the role says so; anything else keeps its own words. */
export function teamFailure(words: string): (error: Error) => WriteFailure {
  return (error) => {
    if (refusedByRole(error)) return { message: OWNER_ONLY, retry: false };
    if (error.message === "member not found") return { message: MEMBER_GONE, retry: false };
    if (/invite not found|not pending|not declined/.test(error.message)) return { message: INVITE_GONE, retry: false };
    return words;
  };
}

/** "עורך · מיוסי כהן": the role, then who sent it when the server knows. */
export function inviteLine(invite: Pick<MyInvite, "role" | "invited_by_name">): string {
  const from = invite.invited_by_name?.trim();
  return from ? `${ROLE_LABEL[invite.role]} · מ${from}` : ROLE_LABEL[invite.role];
}

/** The name a member row shows: the Google name, else the email. */
export function memberName(member: Pick<TeamMember, "name" | "email">): string {
  return member.name?.trim() || member.email?.trim() || "—";
}
