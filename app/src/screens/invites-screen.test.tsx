import { fireEvent, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVITES_PATH, landingWithInvites } from "../invite-landing";
import { resetShownCompanyForTests, shownCompanyFor } from "../lib/company-header";
import { INVITE_GONE, REOPEN_FAILED, type MyInvite } from "../team-api";
import { COMPANY_A, COMPANY_B, TEAM_USER, answer, refuse, renderTeam, resetTeamRpc, rpcCalls } from "../team-test-harness";
import { InvitesScreen } from "./invites-screen";

const OWN = { active_id: COMPANY_A, role: "owner", companies: [{ id: COMPANY_A, name: "בנייני הים", role: "owner", is_demo: false, active: true }] };

vi.mock("../lib/supabase", async () => {
  const { teamClient } = await import("../team-test-client");
  return { getSupabase: () => teamClient };
});

const first: MyInvite = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
  company_id: COMPANY_B,
  company_name: "נכסי הגפן בע״מ",
  role: "viewer",
  invited_by_name: "יוסי כהן",
  invited_by_role: "owner",
  email: "you@example.com",
  status: "pending",
  expires_at: "2026-10-23T12:00:00Z",
  seen_at: null,
  created_at: "2026-10-01T09:00:00Z",
};
const editor: MyInvite = { ...first, id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee3", role: "editor" };
const expired: MyInvite = { ...first, status: "expired", expires_at: "2026-10-09T12:00:00Z" };

function own(has: boolean) {
  answer("list_my_companies", { data: has ? OWN : { active_id: null, role: null, companies: [] } });
}

beforeEach(() => {
  localStorage.clear();
  resetShownCompanyForTests();
  resetTeamRpc();
  own(true);
  answer("my_invites", { data: [first] });
  answer("mark_invite_seen", { data: { id: first.id, seen_at: "2026-10-17T09:00:00Z" } });
});

describe("the invitation screen (FLOW-513, board Invite)", () => {
  it("shows a viewer invite: role card, facts, own business note and the viewer CTA", async () => {
    renderTeam(<InvitesScreen />, "/invites");
    expect(await screen.findByRole("heading", { name: "נכסי הגפן בע״מ" })).toBeInTheDocument();
    expect(screen.getByText("יוסי כהן מזמין אותך לראות את הספרים של העסק ב־Flow.")).toBeInTheDocument();
    expect(screen.getByText("לא מאשר, לא משייך ולא משנה כלום")).toBeInTheDocument();
    expect(screen.getByText("יוסי כהן · בעלים")).toBeInTheDocument();
    expect(screen.getByText("you@example.com")).toBeInTheDocument();
    expect(screen.getByText("23/10/2026")).toBeInTheDocument();
    expect(await screen.findByText("העסק שלך, בנייני הים, נשאר כמו שהוא. אפשר לעבור בין העסקים מההגדרות.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הצטרפות כצופה" })).toBeInTheDocument();
  });

  it("shows an editor invite with the editor lines and CTA", async () => {
    answer("my_invites", { data: [editor] });
    renderTeam(<InvitesScreen />, "/invites");
    expect(await screen.findByText("יוסי כהן מזמין אותך לראות את הספרים של העסק ב־Flow ולעבוד עליהם.")).toBeInTheDocument();
    expect(screen.getByText("מאשר תנועות, משייך לפרויקטים ולקטגוריות")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "הצטרפות כעורך" })).toBeInTheDocument();
  });

  it("says a new user may open their own business when they decline", async () => {
    own(false);
    renderTeam(<InvitesScreen />, "/invites");
    expect(await screen.findByText("אם תדחו, אפשר לפתוח עסק משלכם ב־Flow.")).toBeInTheDocument();
  });

  it("shows an expired invite with no join button and המשך ל־Flow", async () => {
    answer("my_invites", { data: [expired] });
    renderTeam(<InvitesScreen />, "/invites");
    expect(await screen.findByText("ההזמנה פגה")).toBeInTheDocument();
    expect(screen.getByText(/ההזמנה הייתה בתוקף עד 09\/10\./)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /הצטרפות/ })).toBeNull();
    expect(screen.getByRole("link", { name: "המשך ל־Flow" })).toHaveAttribute("href", "/");
  });

  it("prefers the newest unseen pending invite, then a pending one, then an expired one", async () => {
    const seen = { ...editor, seen_at: "2026-10-10T09:00:00Z", created_at: "2026-10-05T09:00:00Z" };
    answer("my_invites", { data: [seen, first] });
    const view = renderTeam(<InvitesScreen />, "/invites");
    expect(await screen.findByRole("button", { name: "הצטרפות כצופה" })).toBeInTheDocument();
    view.unmount();
    answer("my_invites", { data: [expired, { ...seen }] });
    renderTeam(<InvitesScreen />, "/invites");
    expect(await screen.findByRole("button", { name: "הצטרפות כעורך" })).toBeInTheDocument();
  });

  it("joins: the joined state names the own business, and פתיחת goes Home", async () => {
    answer("accept_invite", () => {
      answer("list_my_companies", { data: { active_id: COMPANY_B, role: "viewer", companies: [{ id: COMPANY_B, name: first.company_name, role: "viewer", is_demo: false, active: true }] } });
      return { data: { id: first.id, company_id: COMPANY_B, name: first.company_name, role: "viewer" } };
    });
    renderTeam(<InvitesScreen />, "/invites");
    const join = await screen.findByRole("button", { name: "הצטרפות כצופה" });
    await screen.findByText(/העסק שלך, בנייני הים/);
    fireEvent.click(join);
    expect(await screen.findByRole("heading", { name: "הצטרפת ל־נכסי הגפן בע״מ" })).toBeInTheDocument();
    expect(rpcCalls("accept_invite")).toEqual([{ p_invite_id: first.id }]);
    expect(shownCompanyFor(TEAM_USER)).toBe(COMPANY_B);
    expect(screen.getByText("הוא מופיע עכשיו בהחלפת עסק, ליד בנייני הים. Flow זוכר את העסק האחרון שפתחת.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "פתיחת נכסי הגפן בע״מ" }));
    await waitFor(() => { expect(screen.getByTestId("where").textContent).toBe("/"); });
  });

  it("names the first business when there was no own one", async () => {
    own(false);
    answer("accept_invite", () => {
      answer("list_my_companies", { data: { active_id: COMPANY_B, role: "viewer", companies: [{ id: COMPANY_B, name: first.company_name, role: "viewer", is_demo: false, active: true }] } });
      return { data: { id: first.id, company_id: COMPANY_B, name: first.company_name, role: "viewer" } };
    });
    renderTeam(<InvitesScreen />, "/invites");
    fireEvent.click(await screen.findByRole("button", { name: "הצטרפות כצופה" }));
    expect(await screen.findByText("זה העסק הראשון שלך ב־Flow. הכל כבר מחובר ומוכן.")).toBeInTheDocument();
  });

  it("declines to the declined state, ביטול הדחייה opens it again, and a late reopen toasts", async () => {
    renderTeam(<InvitesScreen />, "/invites");
    fireEvent.click(await screen.findByRole("button", { name: "דחיית ההזמנה" }));
    expect(await screen.findByRole("heading", { name: "ההזמנה נדחתה" })).toBeInTheDocument();
    expect(rpcCalls("decline_invite")).toEqual([{ p_invite_id: first.id }]);
    expect(screen.getByRole("link", { name: "המשך ל־Flow" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול הדחייה" }));
    expect(await screen.findByRole("button", { name: "הצטרפות כצופה" })).toBeInTheDocument();
    expect(rpcCalls("reopen_invite")).toEqual([{ p_invite_id: first.id }]);

    refuse("reopen_invite", "invite is not declined");
    fireEvent.click(screen.getByRole("button", { name: "דחיית ההזמנה" }));
    fireEvent.click(await screen.findByRole("button", { name: "ביטול הדחייה" }));
    expect(await screen.findByText(REOPEN_FAILED)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "ההזמנה נדחתה" })).toBeInTheDocument();
  });

  it("says an invite is no longer open, and drops it", async () => {
    refuse("accept_invite", "invite is not pending");
    renderTeam(<InvitesScreen />, "/invites");
    const join = await screen.findByRole("button", { name: "הצטרפות כצופה" });
    answer("my_invites", { data: [] });
    fireEvent.click(join);
    expect(await screen.findByText(INVITE_GONE)).toBeInTheDocument();
    expect(await screen.findByText("אין הזמנות פתוחות")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "המשך" })).toHaveAttribute("href", "/");
  });

  it("אחר כך goes Home with a business, or to setup with none, and leaves the invite pending", async () => {
    const view = renderTeam(<InvitesScreen />, "/invites");
    fireEvent.click(await screen.findByRole("link", { name: "אחר כך" }));
    await waitFor(() => { expect(screen.getByTestId("where").textContent).toBe("/"); });
    expect(rpcCalls("accept_invite")).toHaveLength(0);
    expect(rpcCalls("decline_invite")).toHaveLength(0);
    view.unmount();
    own(false);
    renderTeam(<InvitesScreen />, "/invites");
    fireEvent.click(await screen.findByRole("link", { name: "אחר כך" }));
    await waitFor(() => { expect(screen.getByTestId("where").textContent).toBe("/setup/welcome"); });
  });

  it("shows a failed read with a retry, and still lets them go on", async () => {
    refuse("my_invites", "Failed to fetch");
    renderTeam(<InvitesScreen />, "/invites");
    const retry = await screen.findByRole("button", { name: "נסו שוב" });
    expect(screen.getByRole("link", { name: "אחר כך" })).toBeInTheDocument();
    answer("my_invites", { data: [first] });
    fireEvent.click(retry);
    expect(await screen.findByRole("heading", { name: "נכסי הגפן בע״מ" })).toBeInTheDocument();
  });

  it("says המשך when no invite is left", async () => {
    answer("my_invites", { data: [] });
    own(false);
    renderTeam(<InvitesScreen />, "/invites");
    expect(await screen.findByText("אין הזמנות פתוחות")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "המשך" })).toHaveAttribute("href", "/setup/welcome");
  });
});

describe("marking an invite seen", () => {
  it("marks an unseen invite once, expired ones too (so the landing stops), and never a seen or sample one", async () => {
    const view = renderTeam(<InvitesScreen />, "/invites");
    await screen.findByRole("heading", { name: "נכסי הגפן בע״מ" });
    await waitFor(() => { expect(rpcCalls("mark_invite_seen")).toEqual([{ p_invite_id: first.id }]); });
    view.unmount();

    resetTeamRpc();
    own(true);
    answer("my_invites", { data: [{ ...first, seen_at: "2026-10-10T09:00:00Z" }] });
    const seenView = renderTeam(<InvitesScreen />, "/invites");
    await screen.findByRole("heading", { name: "נכסי הגפן בע״מ" });
    expect(rpcCalls("mark_invite_seen")).toHaveLength(0);
    seenView.unmount();

    answer("my_invites", { data: [first] });
    const sampleView = renderTeam(<InvitesScreen sample={{ state: "open" }} />, "/invites");
    await screen.findByRole("heading", { name: "נכסי הגפן בע״מ" });
    expect(rpcCalls("mark_invite_seen")).toHaveLength(0);
    sampleView.unmount();

    answer("my_invites", { data: [expired] });
    renderTeam(<InvitesScreen />, "/invites");
    await screen.findByText("ההזמנה פגה");
    await waitFor(() => { expect(rpcCalls("mark_invite_seen")).toEqual([{ p_invite_id: first.id }]); });
  });

  it("stays silent when marking fails", async () => {
    refuse("mark_invite_seen", "Failed to fetch");
    renderTeam(<InvitesScreen />, "/invites");
    expect(await screen.findByRole("heading", { name: "נכסי הגפן בע״מ" })).toBeInTheDocument();
    await waitFor(() => { expect(rpcCalls("mark_invite_seen")).toHaveLength(1); });
    expect(screen.queryByText(/לא הצלחנו/)).toBeNull();
  });
});

describe("landing after sign-in", () => {
  const client = (result: { data: unknown; error: { message: string } | null } | Error) => ({
    rpc: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
  });

  it("opens the invites for someone with no company and open invites", async () => {
    expect(await landingWithInvites(client({ data: [first], error: null }) as never, false, "/setup/welcome")).toBe(INVITES_PATH);
    expect(await landingWithInvites(client({ data: [{ ...first, seen_at: "2026-10-10T09:00:00Z" }], error: null }) as never, false, "/setup/welcome")).toBe(INVITES_PATH);
  });

  it("opens them once for someone with a company: only while an invite is unseen", async () => {
    expect(await landingWithInvites(client({ data: [first], error: null }) as never, true, "/")).toBe(INVITES_PATH);
    expect(await landingWithInvites(client({ data: [expired], error: null }) as never, true, "/")).toBe(INVITES_PATH);
    expect(await landingWithInvites(client({ data: [{ ...first, seen_at: "2026-10-10T09:00:00Z" }], error: null }) as never, true, "/")).toBe("/");
  });

  it("changes nothing with no invites or a failed read", async () => {
    expect(await landingWithInvites(client({ data: [], error: null }) as never, false, "/setup/welcome")).toBe("/setup/welcome");
    expect(await landingWithInvites(client({ data: [], error: null }) as never, true, "/")).toBe("/");
    expect(await landingWithInvites(client({ data: null, error: { message: "denied" } }) as never, false, "/setup/welcome")).toBe("/setup/welcome");
    expect(await landingWithInvites(client(new Error("Failed to fetch")) as never, true, "/")).toBe("/");
  });
});
