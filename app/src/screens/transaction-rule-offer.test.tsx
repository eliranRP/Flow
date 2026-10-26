// FLOW-965 (decision 0216): on the transaction page a category change offers the supplier's next lines,
// the page's toasts hang under the header with a 5s ביטול, and a photographed invoice opens full screen.
// Invented names and figures only.
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { TransactionScreen } from "./flow-screens";
import { renderWithProviders } from "../test-render";
import { ruleOfferText, ruleSavedText } from "./transaction-rule-offer";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: { onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }), signOut: () => Promise.resolve({ error: null }) },
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  }),
}));

const line = {
  id: "tx",
  description: "Home Depot purchase",
  direction: "expense",
  doc_date: "2026-09-12",
  amount_gross: -118_000,
  amount_net: -100_000,
  vat_amount: -18_000,
  vat_status: "assumed",
  source: "mercury",
  pnl_role: "project",
  project_id: "p1",
  project_name: "Cedar St",
  category_id: "c1",
  category_name: "חומרים",
  supplier_name: "Example Depot",
  customer_name: null,
};

function project(id: string, name: string) {
  return { id, name, status: "active" as const, state_label: "פעיל", budget_agorot: null, income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 };
}

function mount(extra: Record<string, unknown> = {}) {
  rpc.calls.length = 0;
  rpc.impl = (name) => {
    if (name === "get_transaction") return Promise.resolve({ data: { ...line, ...extra }, error: null });
    if (name === "get_dashboard") {
      return Promise.resolve({
        data: { company_id: "c", name: "אלפא", vat_registered: true, basis: "invoiced", from: "2026-09-01", to: "2026-09-28", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, overhead_agorot: 0, expense_agorot: 0, net_profit_agorot: 0, prev_income_agorot: null, prev_expense_agorot: null, prev_net_agorot: null, active_projects: 2, review_count: 0, projects: [project("p1", "Cedar St"), project("p2", "Oak Ave")] },
        error: null,
      });
    }
    if (name === "list_categories") {
      return Promise.resolve({
        data: [
          { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
          { id: "c2", name: "ציוד והשכרה", kind: "expense", hidden: false, is_default: false },
        ],
        error: null,
      });
    }
    if (name === "reassign_transaction") return Promise.resolve({ data: "undo-1", error: null });
    if (name === "remember_line_category") {
      return Promise.resolve({ data: { supplier_id: "s1", category_id: "c2", prior_category_id: null }, error: null });
    }
    return Promise.resolve({ data: null, error: null });
  };
  return renderWithProviders(
    <Routes>
      <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
    </Routes>,
    { route: "/transactions/tx" },
  );
}

const names = { supplier: "Example Depot", category: "ציוד והשכרה" };

async function pickCategory(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: /קטגוריה/ }));
  fireEvent.click(await screen.findByRole("radio", { name }));
  fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
  await waitFor(() => {
    expect(rpc.calls.some((call) => call.name === "reassign_transaction")).toBe(true);
  });
}

function toastPlace(text: string): string | undefined {
  const node = screen.getByText(text);
  return node.closest<HTMLElement>("[data-place]")?.dataset.place;
}

describe("the supplier rule offer (FLOW-965)", () => {
  it("a category change offers the supplier's next lines; accepting remembers it, and ביטול forgets it", async () => {
    mount();
    await pickCategory("ציוד והשכרה");
    expect(await screen.findByText(ruleOfferText(names))).toBeInTheDocument();
    expect(toastPlace("השיוך נשמר")).toBe("top");
    fireEvent.click(screen.getByRole("button", { name: "כן, מעכשיו" }));
    expect(await screen.findByText(ruleSavedText(names))).toBeInTheDocument();
    expect(rpc.calls.find((call) => call.name === "remember_line_category")?.args).toEqual({ p_id: "tx" });
    expect(toastPlace(ruleSavedText(names))).toBe("top");
    expect(screen.queryByText(ruleOfferText(names))).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(rpc.calls.find((call) => call.name === "forget_line_category")?.args).toEqual({
        p_supplier_id: "s1",
        p_category_id: "c2",
        p_prior_category_id: null,
      });
    });
  });

  it("רק השורה הזו closes the offer and writes nothing", async () => {
    mount();
    await pickCategory("ציוד והשכרה");
    fireEvent.click(await screen.findByRole("button", { name: "רק השורה הזו" }));
    expect(screen.queryByText(ruleOfferText(names))).toBeNull();
    expect(rpc.calls.some((call) => call.name === "remember_line_category")).toBe(false);
  });

  it("an income line has no offer", async () => {
    mount({ direction: "income", supplier_name: null, customer_name: "Example Tenant" });
    await pickCategory("ציוד והשכרה");
    await screen.findByText("השיוך נשמר");
    expect(screen.queryByRole("button", { name: "כן, מעכשיו" })).toBeNull();
  });

  it("a project change has no offer", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /^פרויקט.*Cedar St/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "Oak Ave" }));
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await screen.findByText("השיוך נשמר");
    expect(screen.queryByRole("button", { name: "כן, מעכשיו" })).toBeNull();
  });

  it("the counts-in switch toasts under the header", async () => {
    mount();
    fireEvent.click(await screen.findByRole("button", { name: /נספר/ }));
    fireEvent.click(await screen.findByRole("switch", { name: /נספר בתזרים/ }));
    expect(await screen.findByText("הוצא מהתזרים")).toBeInTheDocument();
    expect(toastPlace("הוצא מהתזרים")).toBe("top");
  });
});
