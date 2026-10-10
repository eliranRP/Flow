import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetShownCompanyForTests } from "../lib/company-header";
import {
  INVITE_ALREADY_MEMBER,
  INVITE_CANCELLED,
  INVITE_EMAIL_INVALID,
  INVITE_EMAIL_MISSING,
  INVITE_SENT,
  INVITE_TOO_MANY,
  INVITE_UPDATED,
  MEMBER_REMOVED,
  OWNER_ONLY,
  ROLE_SAVED,
} from "../team-api";
import { answer, companiesFor, refuse, renderTeam, resetTeamRpc, rpcCalls, sampleTeam } from "../team-test-harness";
import { TeamScreen } from "./team-screen";

vi.mock("../lib/supabase", async () => {
  const { teamClient } = await import("../team-test-client");
  return { getSupabase: () => teamClient };
});

const YOSSI = sampleTeam.members[1]?.user_id ?? "";
const pending = { id: "ffffffff-ffff-4fff-8fff-fffffffffff1", email: "noa@example.com", role: "viewer" as const, created_at: "2026-10-01T09:00:00Z" };

beforeEach(() => {
  localStorage.clear();
  resetShownCompanyForTests();
  resetTeamRpc();
});

async function openInvite() {
  renderTeam(<TeamScreen />, "/settings/team");
  fireEvent.click(await screen.findByRole("button", { name: "הזמנה" }));
  return screen.findByRole("dialog", { name: "הזמנה" });
}

describe("team page (FLOW-601, mockup a-1)", () => {
  it("lists the owner first with each role, and only the others open a sheet", async () => {
    renderTeam(<TeamScreen />, "/settings/team");
    expect(await screen.findByText("דנה לוי")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "צוות" })).toBeInTheDocument();
    expect(screen.getByText("בעלים")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /דנה לוי/ })).toBeNull();
    expect(screen.getByRole("button", { name: "יוסי כהן, עורך" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "מיכל אברהם, צופה" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "הזמנה" })).toHaveLength(1);
  });

  it("shows a pending invite as its email with הוזמנה and the role (mockup invite-2)", async () => {
    answer("list_team", { data: { ...sampleTeam, invites: [pending] } });
    renderTeam(<TeamScreen />, "/settings/team");
    expect(await screen.findByRole("button", { name: "noa@example.com, הוזמנה · צופה" })).toBeInTheDocument();
  });

  it("says when the owner is alone", async () => {
    answer("list_team", { data: { ...sampleTeam, members: sampleTeam.members.slice(0, 1) } });
    renderTeam(<TeamScreen />, "/settings/team");
    expect(await screen.findByText("עוד אין אנשים בצוות")).toBeInTheDocument();
  });

  it("shows a failed read with a retry that reads again", async () => {
    refuse("list_team", "Failed to fetch");
    renderTeam(<TeamScreen />, "/settings/team");
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    answer("list_team", { data: sampleTeam });
    fireEvent.click(retry);
    expect(await screen.findByText("דנה לוי")).toBeInTheDocument();
  });

  it("lets an editor read the team, with nothing to change", async () => {
    answer("list_my_companies", { data: companiesFor("editor") });
    answer("list_team", { data: { ...sampleTeam, role: "editor", can_manage: false } });
    renderTeam(<TeamScreen />, "/settings/team");
    expect(await screen.findByText("יוסי כהן")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /יוסי כהן/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "הזמנה" })).toBeNull();
  });

  it("goes back to Settings with no company", async () => {
    answer("list_my_companies", { data: { active_id: null, role: null, companies: [] } });
    renderTeam(<TeamScreen />, "/settings/team");
    await waitFor(() => { expect(screen.getByTestId("where").textContent).toBe("/settings"); });
  });
});

describe("invite sheet (mockup invite-1)", () => {
  it("starts on צופה with its hint, and checks the address before sending", async () => {
    const dialog = await openInvite();
    expect(within(dialog).getByRole("radio", { name: "צופה" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByText("צפייה בלבד")).toBeInTheDocument();
    expect(within(dialog).getByText("יכול לשייך ולשנות")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("אימייל")).toHaveAttribute("placeholder", "name@example.com");
    fireEvent.click(within(dialog).getByRole("button", { name: "שליחת הזמנה" }));
    expect(await within(dialog).findByText(INVITE_EMAIL_MISSING)).toBeInTheDocument();
    fireEvent.change(within(dialog).getByLabelText("אימייל"), { target: { value: "noa@" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שליחת הזמנה" }));
    expect(await within(dialog).findByText(INVITE_EMAIL_INVALID)).toBeInTheDocument();
    expect(rpcCalls("invite_member")).toHaveLength(0);
  });

  it("sends the email and role, and ביטול on the toast cancels the invite", async () => {
    answer("invite_member", { data: { id: pending.id, email: "noa@example.com", role: "editor", status: "pending", existing: false } });
    const dialog = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("אימייל"), { target: { value: " noa@example.com " } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "עורך" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "שליחת הזמנה" }));
    expect(await screen.findByText(INVITE_SENT)).toBeInTheDocument();
    expect(rpcCalls("invite_member")).toEqual([{ p_email: "noa@example.com", p_role: "editor" }]);
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "הזמנה" })).toBeNull(); });
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(rpcCalls("cancel_invite")).toEqual([{ p_invite_id: pending.id }]); });
    expect(await screen.findByText(INVITE_CANCELLED)).toBeInTheDocument();
  });

  it("keeps 'already a member' on the field, and the sheet open", async () => {
    refuse("invite_member", "already a member");
    const dialog = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("אימייל"), { target: { value: "yossi@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שליחת הזמנה" }));
    expect(await within(dialog).findByText(INVITE_ALREADY_MEMBER)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("אימייל")).toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByText(INVITE_SENT)).toBeNull();
  });

  it("puts the server's 'invalid email' on the field", async () => {
    refuse("invite_member", "invalid email");
    const dialog = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("אימייל"), { target: { value: "noa@example.c" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שליחת הזמנה" }));
    expect(await within(dialog).findByText(INVITE_EMAIL_INVALID)).toBeInTheDocument();
  });

  it("toasts 'too many invites' without a retry", async () => {
    refuse("invite_member", "too many invites");
    const dialog = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("אימייל"), { target: { value: "noa@example.com" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "שליחת הזמנה" }));
    expect(await screen.findByText(INVITE_TOO_MANY)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).toBeNull();
  });

  it("says when an invite already pending changed, and ביטול puts its role back", async () => {
    answer("list_team", { data: { ...sampleTeam, invites: [pending] } });
    answer("invite_member", { data: { id: pending.id, email: pending.email, role: "editor", status: "pending", existing: true } });
    const dialog = await openInvite();
    fireEvent.change(within(dialog).getByLabelText("אימייל"), { target: { value: "noa@example.com" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "עורך" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "שליחת הזמנה" }));
    expect(await screen.findByText(INVITE_UPDATED)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(rpcCalls("invite_member").at(-1)).toEqual({ p_email: "noa@example.com", p_role: "viewer" }); });
  });
});

describe("member sheet (mockup a-2)", () => {
  async function openYossi() {
    renderTeam(<TeamScreen />, "/settings/team");
    fireEvent.click(await screen.findByRole("button", { name: "יוסי כהן, עורך" }));
    return screen.findByRole("dialog", { name: "יוסי כהן" });
  }

  it("saves a role on tap, and ביטול on the toast puts the old one back", async () => {
    const dialog = await openYossi();
    expect(within(dialog).getByRole("radio", { name: "עורך" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(dialog).getByRole("radio", { name: "צופה" }));
    expect(await screen.findByText(ROLE_SAVED)).toBeInTheDocument();
    expect(rpcCalls("set_member_role")).toEqual([{ p_user_id: YOSSI, p_role: "viewer" }]);
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(rpcCalls("set_member_role").at(-1)).toEqual({ p_user_id: YOSSI, p_role: "editor" }); });
  });

  it("removes only after the confirm", async () => {
    const dialog = await openYossi();
    fireEvent.click(within(dialog).getByRole("button", { name: "הסרה מהצוות" }));
    const confirm = await screen.findByRole("dialog", { name: "להסיר מהצוות?" });
    expect(rpcCalls("remove_member")).toHaveLength(0);
    fireEvent.click(within(confirm).getByRole("button", { name: "הסרה" }));
    expect(await screen.findByText(MEMBER_REMOVED)).toBeInTheDocument();
    expect(rpcCalls("remove_member")).toEqual([{ p_user_id: YOSSI }]);
  });

  it("says only the owner can change the team when the server refuses", async () => {
    refuse("set_member_role", "forbidden", "42501");
    const dialog = await openYossi();
    fireEvent.click(within(dialog).getByRole("radio", { name: "צופה" }));
    expect(await screen.findByText(OWNER_ONLY)).toBeInTheDocument();
  });
});

describe("pending invite sheet (mockup invite-2)", () => {
  it("changes the role with invite_member, and cancels with ביטול to send it again", async () => {
    answer("list_team", { data: { ...sampleTeam, invites: [pending] } });
    answer("invite_member", { data: { id: pending.id, email: pending.email, role: "editor", status: "pending", existing: true } });
    renderTeam(<TeamScreen />, "/settings/team");
    fireEvent.click(await screen.findByRole("button", { name: "noa@example.com, הוזמנה · צופה" }));
    let dialog = await screen.findByRole("dialog", { name: "noa@example.com" });
    fireEvent.click(within(dialog).getByRole("radio", { name: "עורך" }));
    expect(await screen.findByText(INVITE_UPDATED)).toBeInTheDocument();
    expect(rpcCalls("invite_member")).toEqual([{ p_email: "noa@example.com", p_role: "editor" }]);
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "noa@example.com" })).toBeNull(); });

    fireEvent.click(screen.getByRole("button", { name: "noa@example.com, הוזמנה · צופה" }));
    dialog = await screen.findByRole("dialog", { name: "noa@example.com" });
    fireEvent.click(within(dialog).getByRole("button", { name: "ביטול ההזמנה" }));
    expect(await screen.findByText(INVITE_CANCELLED)).toBeInTheDocument();
    expect(rpcCalls("cancel_invite")).toEqual([{ p_invite_id: pending.id }]);
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(rpcCalls("invite_member").at(-1)).toEqual({ p_email: "noa@example.com", p_role: "viewer" }); });
  });
});
