import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetShownCompanyForTests, shownCompanyFor } from "../lib/company-header";
import { COMPANY_B, TEAM_USER, answer, companiesFor, renderTeam, resetTeamRpc, rpcCalls } from "../team-test-harness";
import { CompanySwitcher } from "./company-switcher";

vi.mock("../lib/supabase", async () => {
  const { teamClient } = await import("../team-test-client");
  return { getSupabase: () => teamClient };
});

// The disconnect store's chunk cannot load (offline before it is cached, a stale chunk after a deploy).
vi.mock("../connection-undo", () => {
  throw new Error("Failed to fetch dynamically imported module");
});

beforeEach(() => {
  localStorage.clear();
  resetShownCompanyForTests();
  resetTeamRpc();
});

describe("a company switch when the disconnect store cannot load (decision 0223)", () => {
  it("still opens the other company: a store that never loaded has nothing waiting", async () => {
    answer("list_my_companies", { data: companiesFor("owner", true) });
    renderTeam(<CompanySwitcher />, "/");
    fireEvent.click(await screen.findByRole("button", { name: "חברה: חברה לדוגמה" }));
    const dialog = await screen.findByRole("dialog", { name: "העסקים שלך" });
    answer("list_my_companies", { data: { ...companiesFor("owner", true), active_id: COMPANY_B } });
    fireEvent.click(within(dialog).getByRole("radio", { name: "נכסים לדוגמה בע״מ" }));
    await waitFor(() => { expect(rpcCalls("switch_company")).toEqual([{ p_company_id: COMPANY_B }]); });
    expect(shownCompanyFor(TEAM_USER)).toBe(COMPANY_B);
  });
});
