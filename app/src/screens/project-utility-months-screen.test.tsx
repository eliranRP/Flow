import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProjectUtilityMonthsScreen } from "./project-utility-months-screen";
import { GEFEN, storyUtilityClient, utilityMonthsSample } from "./utility-refunds-sample";
import type { RpcClient } from "../recurring-actions";
import { ToastProvider } from "../ui/toast";
import { UtilityClientProvider, type UtilityMonth } from "../utility-refunds";
import { utilityMonthLabel, utilityMonthStatus } from "../utility-refund-view";

// FLOW-1144 (V3-Project-UtilityMonths): a property's bills by month, with the rent that came in and a sheet per month.
vi.mock("../lib/supabase", () => ({ getSupabase: () => null }));

function renderScreen(client: RpcClient, query = "") {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/projects/${GEFEN}/utilities/months${query}`]}>
        <ToastProvider>
          <UtilityClientProvider client={client}>
            <Routes>
              <Route path="/projects/:projectId/utilities/months" element={<ProjectUtilityMonthsScreen />} />
            </Routes>
          </UtilityClientProvider>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const sample = (index: number) => utilityMonthsSample()[index] as UtilityMonth;

describe("a month's status", () => {
  it("is all back, missing the sum not refunded, or no rent", () => {
    expect(utilityMonthStatus(sample(0), "USD")).toEqual({ ok: true, text: "כל החשבונות הוחזרו" });
    expect(utilityMonthStatus(sample(1), "USD")).toEqual({ ok: false, text: "חסר $80.36" });
    expect(utilityMonthStatus(sample(3), "USD")).toEqual({ ok: false, text: "לא נכנסה שכירות" });
    // A month whose open bill the owner closed with ראיתי: checked, not refunded.
    const seen = { ...sample(0), not_refunded: 0n, bills: sample(0).bills.map((bill, index) => (index === 0 ? { ...bill, state: "seen" as const } : bill)) };
    expect(utilityMonthStatus(seen, "USD")).toEqual({ ok: true, text: "כל החשבונות נבדקו" });
    // A month with rent and no tenant-paid bill: nothing to refund.
    expect(utilityMonthStatus({ ...sample(0), bills: [], bills_paid: 0n, not_refunded: 0n }, "USD")).toEqual({ ok: true, text: "לא שולמו חשבונות" });
    expect(utilityMonthLabel("2026-10-01")).toBe("אוקטובר 2026");
  });
});

describe("ProjectUtilityMonthsScreen", () => {
  it("lists the months newest first, each with the rent, the bills and its status", async () => {
    const client = storyUtilityClient(undefined, undefined, [...utilityMonthsSample()].reverse());
    const rpc = vi.spyOn(client, "rpc");
    renderScreen(client);
    const rows = await screen.findAllByRole("button", { name: /2026/ });
    expect(rows.map((row) => row.textContent.split("שכירות")[0])).toEqual(["נובמבר 2026", "אוקטובר 2026", "ספטמבר 2026", "יולי 2026"]);
    expect(rows[1]?.textContent).toContain("שכירות $2,054.86 · חשבונות $304.86");
    expect(rows[1]?.textContent).toContain("חסר $80.36");
    expect(rows[0]?.textContent).toContain("כל החשבונות הוחזרו");
    expect(rows[3]?.textContent).toContain("שכירות — · חשבונות $61");
    expect(rows[3]?.textContent).toContain("לא נכנסה שכירות");
    expect(rpc).toHaveBeenCalledWith("list_utility_months", { p_project: GEFEN });
  });

  it("opens a month's sheet: its status, the rent and the bills with their totals, each line a link to its transaction", async () => {
    renderScreen(storyUtilityClient());
    fireEvent.click(await screen.findByRole("button", { name: /^אוקטובר 2026/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("חסר $80.36")).toBeTruthy();
    expect(within(dialog).getByText("נכנס מהשוכר")).toBeTruthy();
    expect(within(dialog).getByText("חשבונות ששולמו")).toBeTruthy();
    expect(within(dialog).getByText("$2,054.86")).toBeTruthy();
    expect(within(dialog).getByText("$304.86")).toBeTruthy();
    const links = within(dialog).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/transactions/m-rent-10", "/transactions/m-water-10", "/transactions/m-gas-10"]);
    expect(within(dialog).getByText("חשמל ומים · 04/10/26 · הוחזר")).toBeTruthy();
    expect(within(dialog).getByText("גז · 03/10/26 · לא הוחזר")).toBeTruthy();
  });

  it("shows a split rent line's parts: the rent and the bill the tenant paid with it (FLOW-1146)", async () => {
    renderScreen(storyUtilityClient());
    fireEvent.click(await screen.findByRole("button", { name: /^נובמבר 2026/ }));
    const dialog = await screen.findByRole("dialog");
    const rent = (await within(dialog).findByText("RentRedi")).closest("a");
    expect(rent?.textContent).toContain("הכנסות שכירות $1,750 · מים וביוב $86.60 · 06/11/26");
  });

  it("says no payment came in, in a month with no rent", async () => {
    renderScreen(storyUtilityClient());
    fireEvent.click(await screen.findByRole("button", { name: /^יולי 2026/ }));
    const dialog = await screen.findByRole("dialog");
    expect(await within(dialog).findByText("לא נכנס תשלום החודש")).toBeTruthy();
    expect(within(dialog).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(["/transactions/m-water-07"]);
  });

  it("has an empty state", async () => {
    renderScreen(storyUtilityClient(undefined, undefined, []));
    expect(await screen.findByText("אין עדיין חשבונות בנכס")).toBeTruthy();
  });

  it("shows no month and no empty state while the read is out", () => {
    renderScreen({ rpc: () => new Promise(() => undefined) } as unknown as RpcClient);
    expect(screen.queryByRole("button", { name: /2026/ })).toBeNull();
    expect(screen.queryByText("אין עדיין חשבונות בנכס")).toBeNull();
    screen.getByRole("heading", { name: "לפי חודש" });
  });

  it("offers a retry when the read failed", async () => {
    renderScreen({ rpc: () => Promise.resolve({ data: null, error: { message: "project not found" } }) } as unknown as RpcClient);
    expect(await screen.findByText("החודשים לא נטענו")).toBeTruthy();
    expect(screen.getByRole("button", { name: /ניסיון חוזר|נסו שוב/ })).toBeTruthy();
  });

  it("is linked from the property's חשבונות · מי משלם page", async () => {
    const { ProjectUtilitiesScreen } = await import("./project-utilities-screen");
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[`/projects/${GEFEN}/utilities`]}>
          <ToastProvider>
            <UtilityClientProvider client={storyUtilityClient()}>
              <Routes>
                <Route path="/projects/:projectId/utilities" element={<ProjectUtilitiesScreen />} />
              </Routes>
            </UtilityClientProvider>
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    expect((await screen.findByRole("link", { name: /^לפי חודש/ })).getAttribute("href")).toBe(`/projects/${GEFEN}/utilities/months`);
  });
});
