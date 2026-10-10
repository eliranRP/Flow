import type { AcceptResult, InviteResult, MemberRole, MyCompanies, MyInvite, Team, TeamApi, TeamRole } from "../team-api";

/**
 * FLOW-601. An in-memory team for stories and the dev fixtures: the same calls as the live RPCs,
 * with the server's refusals ("invalid email", "already a member", …). Invented names and
 * example.com addresses only.
 */

export const SAMPLE_USER = "5a5a5a5a-0000-4000-8000-000000000001";
const COMPANY_MAIN = "5a5a5a5a-0000-4000-8000-0000000000c1";
const COMPANY_OTHER = "5a5a5a5a-0000-4000-8000-0000000000c2";

type Company = { id: string; name: string; role: TeamRole };

type SampleState = {
  companies: Company[];
  activeId: string | null;
  members: Team["members"];
  invites: Team["invites"];
  inbox: (MyInvite & { status: "pending" | "declined" })[];
};

export type SampleTeamOptions = {
  /** The signed-in user's role in the shown company. */
  role?: TeamRole;
  /** No company yet (mockup invite-3). */
  noCompany?: boolean;
  /** Only the owner on the team. */
  alone?: boolean;
  /** A pending invite on the team page (mockup invite-2). */
  pendingInvite?: boolean;
  /** Invites to the signed-in user: none, one (invite-4), or two (invite-3). */
  inbox?: 0 | 1 | 2;
  /** A second company in the switcher (a-3). */
  twoCompanies?: boolean;
  /** These calls fail with this server message. */
  fail?: Partial<Record<Exclude<keyof TeamApi, "ready" | "sampleUser">, string>>;
  /** These reads never answer (the loading state). */
  hold?: ("listTeam" | "listMyCompanies" | "myInvites")[];
  /** Milliseconds each call takes, so busy states show. */
  delayMs?: number;
};

function initialState(options: SampleTeamOptions): SampleState {
  const role = options.role ?? "owner";
  const companies: Company[] = options.noCompany
    ? []
    : [
      { id: COMPANY_MAIN, name: "חברה לדוגמה", role },
      ...(options.twoCompanies ? [{ id: COMPANY_OTHER, name: "נכסים לדוגמה בע״מ", role: "editor" as const }] : []),
    ];
  const members: Team["members"] = [
    { user_id: role === "owner" ? SAMPLE_USER : "5a5a5a5a-0000-4000-8000-0000000000a1", name: "דנה לוי", email: "dana@example.com", role: "owner", you: role === "owner" },
    ...(options.alone ? [] : [
      { user_id: "5a5a5a5a-0000-4000-8000-0000000000a2", name: "יוסי כהן", email: "yossi@example.com", role: "editor" as const, you: false },
      { user_id: "5a5a5a5a-0000-4000-8000-0000000000a3", name: "מיכל אברהם", email: "michal@example.com", role: "viewer" as const, you: false },
    ]),
  ];
  const invites: Team["invites"] = options.pendingInvite
    ? [{ id: "5a5a5a5a-0000-4000-8000-0000000000e1", email: "noa@example.com", role: "viewer", created_at: "2026-10-01T09:00:00Z" }]
    : [];
  const inboxAll: SampleState["inbox"] = [
    { id: "5a5a5a5a-0000-4000-8000-0000000000f2", company_id: COMPANY_OTHER, company_name: "נכסים לדוגמה בע״מ", role: "editor", invited_by_name: "יוסי כהן", created_at: "2026-10-02T09:00:00Z", status: "pending" },
    { id: "5a5a5a5a-0000-4000-8000-0000000000f1", company_id: COMPANY_MAIN, company_name: "חברה לדוגמה", role: "viewer", invited_by_name: "דנה לוי", created_at: "2026-10-01T09:00:00Z", status: "pending" },
  ];
  const count = options.inbox ?? 0;
  // invite-3 lists חברה לדוגמה first; invite-4 has the one from נכסים לדוגמה.
  const inbox = count === 2 ? [inboxAll[1], inboxAll[0]] : inboxAll.slice(0, count);
  return {
    companies,
    activeId: companies[0]?.id ?? null,
    members,
    invites,
    inbox: inbox.filter((row): row is SampleState["inbox"][number] => row != null),
  };
}

function refusal(message: string): Error {
  const error = new Error(message);
  if (message === "forbidden") Object.assign(error, { code: "42501" });
  return error;
}

let nextId = 100;
function sampleId(): string {
  nextId += 1;
  return `5a5a5a5a-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
}

export function createSampleTeamApi(options: SampleTeamOptions = {}): TeamApi {
  const state = initialState(options);
  const wait = async (name: keyof NonNullable<SampleTeamOptions["fail"]>) => {
    if (options.hold?.includes(name as "listTeam")) await new Promise<never>(() => undefined);
    if (options.delayMs) await new Promise((resolve) => { setTimeout(resolve, options.delayMs); });
    const failure = options.fail?.[name];
    if (failure) throw refusal(failure);
  };
  const activeRole = (): TeamRole | null => state.companies.find((company) => company.id === state.activeId)?.role ?? null;
  return {
    sampleUser: SAMPLE_USER,
    ready: () => true,
    listMyCompanies: async (): Promise<MyCompanies> => {
      await wait("listMyCompanies");
      return {
        active_id: state.activeId,
        role: activeRole(),
        companies: state.companies.map((company) => ({ ...company, is_demo: false, active: company.id === state.activeId })),
      };
    },
    switchCompany: async (companyId) => {
      await wait("switchCompany");
      if (!state.companies.some((company) => company.id === companyId)) throw refusal("forbidden");
      state.activeId = companyId;
    },
    listTeam: async (): Promise<Team> => {
      await wait("listTeam");
      const role = activeRole() ?? "owner";
      return {
        company_id: state.activeId ?? COMPANY_MAIN,
        role,
        can_manage: role === "owner",
        members: state.members.map((member) => ({ ...member })),
        invites: role === "owner" ? state.invites.map((invite) => ({ ...invite })) : [],
      };
    },
    inviteMember: async (email, role): Promise<InviteResult> => {
      await wait("inviteMember");
      const clean = email.trim().toLowerCase();
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(clean)) throw refusal("invalid email");
      if (state.members.some((member) => member.email === clean)) throw refusal("already a member");
      const found = state.invites.find((invite) => invite.email === clean);
      if (found) {
        found.role = role;
        return { id: found.id, email: clean, role, status: "pending", existing: true };
      }
      const id = sampleId();
      state.invites.push({ id, email: clean, role, created_at: "2026-10-09T09:00:00Z" });
      return { id, email: clean, role, status: "pending", existing: false };
    },
    cancelInvite: async (inviteId) => {
      await wait("cancelInvite");
      const before = state.invites.length;
      state.invites = state.invites.filter((invite) => invite.id !== inviteId);
      if (state.invites.length === before) throw refusal("invite not found");
    },
    setMemberRole: async (userId, role: MemberRole) => {
      await wait("setMemberRole");
      const member = state.members.find((row) => row.user_id === userId && row.role !== "owner");
      if (!member) throw refusal("member not found");
      member.role = role;
    },
    removeMember: async (userId) => {
      await wait("removeMember");
      const before = state.members.length;
      state.members = state.members.filter((row) => row.user_id !== userId || row.role === "owner");
      if (state.members.length === before) throw refusal("member not found");
    },
    myInvites: async () => {
      await wait("myInvites");
      return state.inbox
        .filter((invite) => invite.status === "pending")
        .map(({ status: _status, ...invite }) => invite);
    },
    acceptInvite: async (inviteId): Promise<AcceptResult> => {
      await wait("acceptInvite");
      const invite = state.inbox.find((row) => row.id === inviteId && row.status === "pending");
      if (!invite) throw refusal("invite is not pending");
      state.inbox = state.inbox.filter((row) => row.id !== inviteId);
      if (!state.companies.some((company) => company.id === invite.company_id)) {
        state.companies.push({ id: invite.company_id, name: invite.company_name, role: invite.role });
      }
      state.activeId = invite.company_id;
      return { id: invite.id, company_id: invite.company_id, name: invite.company_name, role: invite.role };
    },
    declineInvite: async (inviteId) => {
      await wait("declineInvite");
      const invite = state.inbox.find((row) => row.id === inviteId && row.status === "pending");
      if (!invite) throw refusal("invite is not pending");
      invite.status = "declined";
    },
    reopenInvite: async (inviteId) => {
      await wait("reopenInvite");
      const invite = state.inbox.find((row) => row.id === inviteId && row.status === "declined");
      if (!invite) throw refusal("invite is not declined");
      invite.status = "pending";
    },
  };
}
