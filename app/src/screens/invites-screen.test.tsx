import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { INVITES_PATH, landingWithInvites } from "../invite-landing";
import { resetShownCompanyForTests, shownCompanyFor } from "../lib/company-header";
import { INVITE_DECLINED, INVITE_GONE, type MyInvite } from "../team-api";
import { COMPANY_A, COMPANY_B, TEAM_USER, answer, refuse, renderTeam, resetTeamRpc, rpcCalls, sampleInvite } from "../team-test-harness";
import { InvitesScreen } from "./invites-screen";

vi.mock("../lib/supabase", async () => {
  const { teamClient } = await import("../team-test-client");
  return { getSupabase: () => teamClient };
});

const first: MyInvite = {
  id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee2",
  company_id: COMPANY_A,
  company_name: "חברה לדוגמה",
  role: "viewer",
  invited_by_name: "דנה לוי",
  created_at: "2026-10-01T09:00:00Z",
};

beforeEach(() => {
  localStorage.clear();
  resetShownCompanyForTests();
  resetTeamRpc();
  answer("list_my_companies", { data: { active_id: null, role: null, companies: [] } });
  answer("my_invites", { data: [first, sampleInvite] });
});

describe("invites list after sign-in (FLOW-601, mockup invite-3)", () => {
  it("lists every invite with its role and sender, and אחר כך goes on to setup", async () => {
    renderTeam(<InvitesScreen />, "/invites");
    expect(await screen.findByRole("region", { name: "חברה לדוגמה" })).toBeInTheDocument();
    expect(screen.getByText("צופה · מדנה לוי")).toBeInTheDocument();
    expect(screen.getByText("עורך · מיוסי כהן")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("link", { name: "אחר כך" }));
    await waitFor(() => { expect(screen.getByTestId("where").textContent).toBe("/setup/0"); });
  });

  it("joins: the company opens on Home", async () => {
    answer("accept_invite", () => {
      answer("list_my_companies", { data: { active_id: COMPANY_B, role: "editor", companies: [{ id: COMPANY_B, name: sampleInvite.company_name, role: "editor", is_demo: false, active: true }] } });
      return { data: { id: sampleInvite.id, company_id: COMPANY_B, name: sampleInvite.company_name, role: "editor" } };
    });
    renderTeam(<InvitesScreen />, "/invites");
    fireEvent.click(await screen.findByRole("button", { name: "הצטרפות לנכסים לדוגמה בע״מ" }));
    await waitFor(() => { expect(screen.getByTestId("where").textContent).toBe("/"); });
    expect(rpcCalls("accept_invite")).toEqual([{ p_invite_id: sampleInvite.id }]);
    expect(shownCompanyFor(TEAM_USER)).toBe(COMPANY_B);
  });

  it("declines with ביטול, and says המשך once no invite is left", async () => {
    renderTeam(<InvitesScreen />, "/invites");
    const card = await screen.findByRole("region", { name: "חברה לדוגמה" });
    answer("my_invites", { data: [sampleInvite] });
    fireEvent.click(within(card).getByRole("button", { name: "דחייה של חברה לדוגמה" }));
    expect(await screen.findByText(INVITE_DECLINED)).toBeInTheDocument();
    expect(rpcCalls("decline_invite")).toEqual([{ p_invite_id: first.id }]);
    await waitFor(() => { expect(screen.queryByRole("region", { name: "חברה לדוגמה" })).toBeNull(); });
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(rpcCalls("reopen_invite")).toEqual([{ p_invite_id: first.id }]); });

    answer("my_invites", { data: [] });
    fireEvent.click(await screen.findByRole("button", { name: "דחייה של נכסים לדוגמה בע״מ" }));
    expect(await screen.findByText("אין הזמנות פתוחות")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "המשך" })).toHaveAttribute("href", "/setup/0");
  });

  it("says an invite is no longer open, and drops it", async () => {
    refuse("accept_invite", "invite is not pending");
    renderTeam(<InvitesScreen />, "/invites");
    const join = await screen.findByRole("button", { name: "הצטרפות לחברה לדוגמה" });
    answer("my_invites", { data: [sampleInvite] });
    fireEvent.click(join);
    expect(await screen.findByText(INVITE_GONE)).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole("region", { name: "חברה לדוגמה" })).toBeNull(); });
  });

  it("shows a failed read with a retry, and still lets them go on", async () => {
    refuse("my_invites", "Failed to fetch");
    renderTeam(<InvitesScreen />, "/invites");
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    expect(screen.getByRole("link", { name: "אחר כך" })).toBeInTheDocument();
    answer("my_invites", { data: [first] });
    fireEvent.click(retry);
    expect(await screen.findByRole("region", { name: "חברה לדוגמה" })).toBeInTheDocument();
  });
});

describe("landing after sign-in", () => {
  const client = (result: { data: unknown; error: { message: string } | null } | Error) => ({
    rpc: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))),
  });

  it("opens the invites for someone with no company and open invites", async () => {
    expect(await landingWithInvites(client({ data: [first], error: null }) as never, false, "/setup/0")).toBe(INVITES_PATH);
  });

  it("changes nothing with a company, no invites, or a failed read", async () => {
    const withInvites = client({ data: [first], error: null });
    expect(await landingWithInvites(withInvites as never, true, "/")).toBe("/");
    expect(withInvites.rpc).not.toHaveBeenCalled();
    expect(await landingWithInvites(client({ data: [], error: null }) as never, false, "/setup/0")).toBe("/setup/0");
    expect(await landingWithInvites(client({ data: null, error: { message: "denied" } }) as never, false, "/setup/0")).toBe("/setup/0");
    expect(await landingWithInvites(client(new Error("Failed to fetch")) as never, false, "/setup/0")).toBe("/setup/0");
  });
});
