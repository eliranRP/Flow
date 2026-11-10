import { onlineManager, QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { projectAttentionRows } from "./project-attention";
import { ProjectUtilitiesScreen } from "./project-utilities-screen";
import { GEFEN, utilityRefundsSample } from "./utility-refunds-sample";
import { ToastProvider } from "../ui/toast";
import { refundCount } from "../utility-refund-view";

// FLOW-1135 (V3-Project-Utilities): who pays each utility, הוספת ספק, each with ביטול; the property page's row.
type RefundsRead = "ok" | "pending" | "error";
const db = vi.hoisted((): { rpcs: Array<{ name: string; args: unknown }>; fail: boolean; hold: boolean; refunds: RefundsRead } => ({
  rpcs: [],
  fail: false,
  hold: false,
  /** How the bills read ends: with the sample, never (still loading), or failed. */
  refunds: "ok",
}));

vi.mock("../utility-refunds", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../utility-refunds")>();
  const sample = await import("./utility-refunds-sample");
  return {
    ...actual,
    useUtilityPayersQuery: () => useQuery({ queryKey: ["utility-payers", "off", "p"], queryFn: () => Promise.resolve(sample.utilityPayersSample()) }),
    useUtilityRefundsQuery: () => useQuery({
      queryKey: ["utility-refunds", "off", "p"],
      queryFn: () => (db.refunds === "pending" ? new Promise<never>(() => undefined)
        : db.refunds === "error" ? Promise.reject(new Error("refused"))
          : Promise.resolve({ as_of: "2026-11-09", bills: sample.utilityRefundsSample() })),
    }),
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
  db.refunds = "ok";
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
/** A utility's line under its name (FLOW-1153: whole parts, so its text spans the parts). */
const meta = (text: string) => (_: string, element: Element | null) => element?.className === "ui-utl-meta" && element.textContent === text;

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
    expect(await screen.findByText(meta("חשמל ומים · בדרך כלל $120"))).toBeTruthy();
    expect(screen.getByText(meta("גז · בדרך כלל $45"))).toBeTruthy();
    expect(screen.getByText(meta("אינטרנט · נוסף ידנית · לא נבדק"))).toBeTruthy();
    expect(screen.getByRole("link", { name: "2 לא הוחזרו" }).getAttribute("href")).toBe(`/utility-refunds?project=${GEFEN}`);
    const net = screen.getByRole("radiogroup", { name: "מי משלם: Net Co" });
    expect(within(net).getByRole("radio", { name: "חברה" }).getAttribute("aria-checked")).toBe("true");
  });

  it("draws a supplier's name in its own direction, wrapping and never marked as a designed cut (FLOW-1152)", async () => {
    renderScreen();
    const name = await screen.findByText("Power Co");
    expect(name.tagName).toBe("BDI");
    expect(name.parentElement?.className).toBe("ui-utl-name");
    expect(name.parentElement?.hasAttribute("data-clip-ok")).toBe(false);
  });

  it("offline, says from when the payers are shown (FLOW-1154)", async () => {
    renderScreen();
    await screen.findByText("Power Co");
    expect(screen.queryByText(/אין חיבור/)).toBeNull();
    act(() => { onlineManager.setOnline(false); });
    try {
      expect((await screen.findByText(/אין חיבור/)).closest(".ui-band-offline")?.textContent).toMatch(/^אין חיבור · מוצג המצב מ־\d\d:\d\d$/);
    } finally {
      act(() => { onlineManager.setOnline(true); });
    }
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

  it("never says הכול הוחזר before the bills are read, and offers a retry when they fail", async () => {
    db.refunds = "pending";
    renderScreen();
    expect(await screen.findByText("בודקים…")).toBeTruthy();
    expect(screen.queryByText("הכול הוחזר")).toBeNull();
    cleanup();
    db.refunds = "error";
    renderScreen();
    expect(await screen.findByRole("button", { name: "לא נטען · ניסיון חוזר" })).toBeTruthy();
    expect(screen.queryByText("הכול הוחזר")).toBeNull();
    db.refunds = "ok";
    fireEvent.click(screen.getByRole("button", { name: "לא נטען · ניסיון חוזר" }));
    expect(await screen.findByRole("link", { name: "2 לא הוחזרו" })).toBeTruthy();
  });

  it("says where Flow finds the suppliers, as the board does", async () => {
    renderScreen();
    expect(await screen.findByText(/מהשורות: קטגוריות החשבונות ושם הכרטיס/)).toBeTruthy();
  });

  it("gives a viewer no changes", async () => {
    db.hold = true;
    renderScreen();
    await screen.findByText(meta("חשמל ומים · בדרך כלל $120"));
    expect(screen.queryByRole("button", { name: /הוספת ספק/ })).toBeNull();
    expect(within(screen.getByRole("radiogroup", { name: "מי משלם: Power Co" })).getByRole("radio", { name: "חברה" })).toHaveProperty("disabled", true);
  });
});

