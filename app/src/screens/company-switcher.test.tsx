import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetShownCompanyForTests, shownCompanyFor } from "../lib/company-header";
import { INVITE_DECLINED, REOPEN_FAILED, SWITCH_FAILED } from "../team-api";
import {
  COMPANY_A,
  COMPANY_B,
  TEAM_USER,
  answer,
  companiesFor,
  refuse,
  renderTeam,
  resetTeamRpc,
  rpcCalls,
  sampleInvite,
} from "../team-test-harness";
import { CompanySwitcher } from "./company-switcher";

vi.mock("../lib/supabase", async () => {
  const { teamClient } = await import("../team-test-client");
  return { getSupabase: () => teamClient };
});

beforeEach(() => {
  localStorage.clear();
  resetShownCompanyForTests();
  resetTeamRpc();
});

async function openSheet(fallbackName?: string) {
  renderTeam(<CompanySwitcher fallbackName={fallbackName} />, "/");
  fireEvent.click(await screen.findByRole("button", { name: "חברה: חברה לדוגמה" }));
  return screen.findByRole("dialog", { name: "חברה" });
}

describe("company switcher (FLOW-601, mockup a-3)", () => {
  it("names the shown company on the band and lists every company with the shown one checked", async () => {
    answer("list_my_companies", { data: companiesFor("owner", true) });
    const dialog = await openSheet();
    expect(within(dialog).getByRole("radio", { name: "חברה לדוגמה" })).toHaveAttribute("aria-checked", "true");
    expect(within(dialog).getByRole("radio", { name: "נכסים לדוגמה בע״מ" })).toHaveAttribute("aria-checked", "false");
    expect(within(dialog).queryByRole("heading", { name: "הזמנות" })).toBeNull();
    expect(shownCompanyFor(TEAM_USER)).toBe(COMPANY_A);
  });

  it("opens another company: the header names it, the server saves it, and the reads start over", async () => {
    answer("list_my_companies", { data: companiesFor("owner", true) });
    const dialog = await openSheet();
    const reads = rpcCalls("list_my_companies").length;
    answer("list_my_companies", { data: { ...companiesFor("owner", true), active_id: COMPANY_B, role: "editor" } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "נכסים לדוגמה בע״מ" }));
    await waitFor(() => { expect(rpcCalls("switch_company")).toEqual([{ p_company_id: COMPANY_B }]); });
    expect(shownCompanyFor(TEAM_USER)).toBe(COMPANY_B);
    await waitFor(() => { expect(rpcCalls("list_my_companies").length).toBeGreaterThan(reads); });
    expect(await screen.findByRole("button", { name: "חברה: נכסים לדוגמה בע״מ" })).toBeInTheDocument();
    await waitFor(() => { expect(screen.queryByRole("dialog", { name: "חברה" })).toBeNull(); });
  });

  it("leaves out the old demo book, which a switch cannot open", async () => {
    const demo = { id: "ffffffff-ffff-4fff-8fff-ffffffffffff", name: "דמו לדוגמה", role: "viewer" as const, is_demo: true, active: false };
    const companies = companiesFor("owner", true);
    answer("list_my_companies", { data: { ...companies, companies: [...companies.companies, demo] } });
    const dialog = await openSheet();
    expect(within(dialog).getAllByRole("radio")).toHaveLength(2);
    expect(within(dialog).queryByRole("radio", { name: "דמו לדוגמה" })).toBeNull();
  });

  it("starts every read over when the server shows another company than the one sent", async () => {
    answer("list_my_companies", { data: companiesFor("owner", true) });
    const { client } = renderTeam(<CompanySwitcher />, "/");
    await screen.findByRole("button", { name: "חברה: חברה לדוגמה" });
    client.setQueryData(["projects"], ["a row of A"]);
    // This user left A elsewhere: the server answers with B.
    answer("list_my_companies", { data: { ...companiesFor("owner", true), active_id: COMPANY_B, role: "editor" } });
    await client.refetchQueries({ queryKey: ["my-companies"] });
    await waitFor(() => { expect(shownCompanyFor(TEAM_USER)).toBe(COMPANY_B); });
    await waitFor(() => { expect(client.getQueryData(["projects"])).toBeUndefined(); });
  });

  it("keeps the company shown before when the switch fails", async () => {
    answer("list_my_companies", { data: companiesFor("owner", true) });
    refuse("switch_company", "forbidden", "42501");
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("radio", { name: "נכסים לדוגמה בע״מ" }));
    expect(await screen.findByText(SWITCH_FAILED)).toBeInTheDocument();
    expect(shownCompanyFor(TEAM_USER)).toBe(COMPANY_A);
  });

  it("stands in Home's name while the list cannot be read, and offers a retry in the sheet", async () => {
    refuse("list_my_companies", "Failed to fetch");
    const dialog = await openSheet("חברה לדוגמה");
    const retry = await within(dialog).findByRole("button", { name: "ניסיון חוזר" });
    answer("list_my_companies", { data: companiesFor("owner") });
    fireEvent.click(retry);
    expect(await within(dialog).findByRole("radio", { name: "חברה לדוגמה" })).toBeInTheDocument();
  });

  it("goes to the company form for + חברה חדשה with no company named, and hides it from a viewer", async () => {
    const dialog = await openSheet();
    fireEvent.click(within(dialog).getByRole("button", { name: "חברה חדשה" }));
    await waitFor(() => { expect(screen.getByTestId("where")).toHaveTextContent("/onboarding"); });
    expect(shownCompanyFor(TEAM_USER)).toBeNull();
  });

  it("has no + חברה חדשה for a viewer", async () => {
    answer("list_my_companies", { data: companiesFor("viewer") });
    const dialog = await openSheet();
    await within(dialog).findByRole("radio", { name: "חברה לדוגמה" });
    expect(within(dialog).queryByRole("button", { name: "חברה חדשה" })).toBeNull();
  });
});

describe("invites in the switcher (mockups invite-4, invite-5)", () => {
  beforeEach(() => {
    answer("my_invites", { data: [sampleInvite] });
  });

  it("lists an invite with its role and sender, and הצטרפות opens that company", async () => {
    answer("accept_invite", () => {
      // The server makes the joined company the last one opened.
      answer("list_my_companies", { data: { ...companiesFor("owner", true), active_id: COMPANY_B, role: "editor" } });
      return { data: { id: sampleInvite.id, company_id: COMPANY_B, name: sampleInvite.company_name, role: "editor" } };
    });
    const dialog = await openSheet();
    expect(await within(dialog).findByRole("heading", { name: "הזמנות" })).toBeInTheDocument();
    expect(within(dialog).getByText("עורך · מיוסי כהן")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: "הצטרפות לנכסים לדוגמה בע״מ" }));
    await waitFor(() => { expect(rpcCalls("accept_invite")).toEqual([{ p_invite_id: sampleInvite.id }]); });
    await waitFor(() => { expect(shownCompanyFor(TEAM_USER)).toBe(COMPANY_B); });
    // accept_invite already saved it as the last one opened.
    expect(rpcCalls("switch_company")).toHaveLength(0);
  });

  it("declines with ביטול on the toast, which reopens the invite", async () => {
    const dialog = await openSheet();
    fireEvent.click(await within(dialog).findByRole("button", { name: "דחייה של נכסים לדוגמה בע״מ" }));
    expect(await screen.findByText(INVITE_DECLINED)).toBeInTheDocument();
    expect(rpcCalls("decline_invite")).toEqual([{ p_invite_id: sampleInvite.id }]);
    // The open sheet hides the page from the tree in jsdom (vaul), as in the other sheet tests.
    fireEvent.click(screen.getByRole("button", { name: "ביטול", hidden: true }));
    await waitFor(() => { expect(rpcCalls("reopen_invite")).toEqual([{ p_invite_id: sampleInvite.id }]); });
  });

  it("says it is too late once the server keeps the decline", async () => {
    refuse("reopen_invite", "invite is not declined");
    const dialog = await openSheet();
    fireEvent.click(await within(dialog).findByRole("button", { name: "דחייה של נכסים לדוגמה בע״מ" }));
    fireEvent.click(await screen.findByRole("button", { name: "ביטול", hidden: true }));
    expect(await screen.findByText(REOPEN_FAILED)).toBeInTheDocument();
  });
});
