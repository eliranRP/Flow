import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAttentionRows } from "./project-attention";
import { ProjectUtilitiesScreen } from "./project-utilities-screen";
import { GEFEN, utilityRefundsSample } from "./utility-refunds-sample";
import { ToastProvider } from "../ui/toast";
import { refundCount } from "../utility-refund-view";

// FLOW-1135 (V3-Project-Utilities): who pays each utility, הוספת ספק, each with ביטול; the property page's row.
const db = vi.hoisted(() => ({
  rpcs: [] as Array<{ name: string; args: unknown }>,
  fail: false,
  hold: false,
}));

vi.mock("../utility-refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utility-refunds")>();
  const sample = await import("./utility-refunds-sample");
  return {
    ...actual,
    useUtilityPayersQuery: () => useQuery({ queryKey: ["utility-payers", "off", "p"], queryFn: () => Promise.resolve(sample.utilityPayersSample()) }),
    useUtilityRefundsQuery: () => useQuery({ queryKey: ["utility-refunds", "off", "p"], queryFn: () => Promise.resolve({ as_of: "2026-11-09", bills: sample.utilityRefundsSample() }) }),
  };
});

vi.mock("../recurring-schedule", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../recurring-schedule")>();
  const sample = await import("./utility-refunds-sample");
  return { ...actual, useRecurringScheduleQuery: () => useQuery({ queryKey: ["recurring-schedule"], queryFn: () => Promise.resolve(sample.utilityScheduleSample()) }) };
});

vi.mock("../use-is-viewer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-is-viewer")>()),
  useHoldWrites: () => db.hold,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: { p_payer?: string } | undefined) => {
      db.rpcs.push({ name, args });
      if (db.fail) return Promise.resolve({ data: null, error: { message: "refused" } });
      const prior = (args as { p_supplier_id?: string } | undefined)?.p_supplier_id === "s-Net Co" ? { payer: "company", added: false } : null;
      return Promise.resolve({ data: name === "set_utility_payer" ? { prior } : null, error: null });
    },
  }),
}));

afterEach(() => {
  db.rpcs = [];
  db.fail = false;
  db.hold = false;
});

function renderScreen() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/projects/${GEFEN}/utilities`]}>
        <ToastProvider>
          <Routes>
            <Route path="/projects/:projectId/utilities" element={<ProjectUtilitiesScreen />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const payerCalls = () => db.rpcs.filter((call) => call.name === "set_utility_payer").map((call) => call.args);

describe("the property page's row", () => {
  it("adds Home's row for the property's bills, opening the list on the property", () => {
    const rows = projectAttentionRows({
      projectId: GEFEN, pending: 0, late: [], changes: [], search: "?preview=1",
      utilities: refundCount(utilityRefundsSample().filter((bill) => bill.project_id === GEFEN)),
    });
    expect(rows.map((row) => [row.id, row.to, row.tag])).toEqual([["utility-refunds", `/utility-refunds?preview=1&project=${GEFEN}`, "$174.40"]]);
    expect(projectAttentionRows({ projectId: GEFEN, pending: 0, late: [], changes: [], search: "", utilities: refundCount([]) })).toEqual([]);
  });
});

describe("ProjectUtilitiesScreen", () => {
  it("lists each utility with its usual amount, and links the bills not refunded", async () => {
    renderScreen();
    expect(await screen.findByText("בדרך כלל $120")).toBeTruthy();
    expect(screen.getByText("נוסף ידנית · לא נבדק")).toBeTruthy();
    expect(screen.getByRole("link", { name: "2 לא הוחזרו" }).getAttribute("href")).toBe(`/utility-refunds?project=${GEFEN}`);
    const net = screen.getByRole("radiogroup", { name: "מי משלם: Net Co" });
    expect(within(net).getByRole("radio", { name: "חברה" }).getAttribute("aria-checked")).toBe("true");
  });

  it("חברה makes the utility company-paid and closes its bills; ביטול puts the tenant back", async () => {
    renderScreen();
    const group = await screen.findByRole("radiogroup", { name: "מי משלם: Power Co" });
    fireEvent.click(within(group).getByRole("radio", { name: "חברה" }));
    expect(await screen.findByText("Power Co · החברה משלמת · 1 נסגרו")).toBeTruthy();
    expect(payerCalls()).toEqual([{ p_project_id: GEFEN, p_supplier_id: "s-Power Co", p_currency: "USD", p_payer: "company", p_added: false }]);
    expect(screen.getByRole("link", { name: "1 לא הוחזרו" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(payerCalls()[1]).toEqual({ p_project_id: GEFEN, p_supplier_id: "s-Power Co", p_currency: "USD", p_payer: null, p_added: false }); });
    expect(await screen.findByRole("link", { name: "2 לא הוחזרו" })).toBeTruthy();
  });

  it("שוכר on a company-paid utility; ביטול puts the company back", async () => {
    renderScreen();
    const group = await screen.findByRole("radiogroup", { name: "מי משלם: Net Co" });
    fireEvent.click(within(group).getByRole("radio", { name: "שוכר" }));
    expect(await screen.findByText("Net Co · השוכר מחזיר")).toBeTruthy();
    expect(payerCalls()[0]).toEqual({ p_project_id: GEFEN, p_supplier_id: "s-Net Co", p_currency: "USD", p_payer: "tenant", p_added: true });
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(payerCalls()[1]).toEqual({ p_project_id: GEFEN, p_supplier_id: "s-Net Co", p_currency: "USD", p_payer: "company", p_added: false }); });
  });

  it("הוספת ספק adds one of the property's recurring expenses; ביטול removes it", async () => {
    renderScreen();
    fireEvent.click(await screen.findByRole("button", { name: /הוספת ספק/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).queryByRole("button", { name: /City Water/ })).toBeNull();
    fireEvent.click(await within(dialog).findByRole("button", { name: /Trash Co/ }));
    expect(await screen.findByText("Trash Co · נוסף")).toBeTruthy();
    expect(payerCalls()).toEqual([{ p_project_id: GEFEN, p_supplier_id: "s-Trash Co", p_currency: "USD", p_payer: "tenant", p_added: true }]);
    expect(screen.getByRole("radiogroup", { name: "מי משלם: Trash Co" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(payerCalls()[1]).toEqual({ p_project_id: GEFEN, p_supplier_id: "s-Trash Co", p_currency: "USD", p_payer: null, p_added: false }); });
    await waitFor(() => { expect(screen.queryByRole("radiogroup", { name: "מי משלם: Trash Co" })).toBeNull(); });
  });

  it("a failed write puts the payer back and says what failed", async () => {
    db.fail = true;
    renderScreen();
    const group = await screen.findByRole("radiogroup", { name: "מי משלם: Gas Co" });
    fireEvent.click(within(group).getByRole("radio", { name: "חברה" }));
    expect(await screen.findByText("השינוי של מי משלם לא נשמר. אפשר לנסות שוב.")).toBeTruthy();
    expect(within(group).getByRole("radio", { name: "שוכר" }).getAttribute("aria-checked")).toBe("true");
  });

  it("gives a viewer no changes", async () => {
    db.hold = true;
    renderScreen();
    await screen.findByText("בדרך כלל $120");
    expect(screen.queryByRole("button", { name: /הוספת ספק/ })).toBeNull();
    expect(within(screen.getByRole("radiogroup", { name: "מי משלם: Power Co" })).getByRole("radio", { name: "חברה" })).toHaveProperty("disabled", true);
  });
});

