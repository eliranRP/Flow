import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { TransactionScreen } from "./flow-screens";

// FLOW-108 review: the live card, not the sample. It writes through set_transaction_pnl.
const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  override: null as boolean | null,
  excluded: false,
  fail: null as { message: string; code?: string } | null,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      if (name === "get_transaction") {
        return Promise.resolve({
          data: {
            id: "tx",
            description: "ספק לדוגמה",
            direction: "expense",
            doc_date: "2026-07-01",
            amount_gross: -120000,
            amount_net: -120000,
            vat_amount: 0,
            vat_status: "source",
            source: "sumit",
            pnl_role: "project",
            review_status: "approved",
            project_id: "p1",
            project_name: "פרויקט לדוגמה",
            category_id: "c1",
            category_name: "חומרים",
            supplier_name: "ספק לדוגמה",
            customer_name: null,
            paid: false,
            open_gross_agorot: null,
            allocations: [],
            in_pnl_override: rpc.override,
            category_excluded_from_pnl: rpc.excluded,
            in_pnl: rpc.override ?? !rpc.excluded,
            pnl_fixed: false,
          },
          error: null,
        });
      }
      if (name === "set_transaction_pnl") {
        if (rpc.fail) return Promise.resolve({ data: null, error: rpc.fail });
        rpc.override = (args as { p_in_pnl: boolean | null }).p_in_pnl;
        return Promise.resolve({ data: { id: "tx" }, error: null });
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function showLive() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/transactions/tx"]}>
            <Routes>
              <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
            </Routes>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function pnlCalls() {
  return rpc.calls.filter((call) => call.name === "set_transaction_pnl").map((call) => call.args);
}

async function pnlSwitch() {
  return screen.findByRole("switch", { name: "ברווח והפסד" });
}

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.override = null;
  rpc.excluded = false;
  rpc.fail = null;
});

describe("one line out of the P&L, live", () => {
  it("writes false, and ביטול writes the previous null back", async () => {
    showLive();
    fireEvent.click(await pnlSwitch());
    await waitFor(() => { expect(pnlCalls()).toEqual([{ p_id: "tx", p_in_pnl: false }]); });
    expect(await screen.findByText("מחוץ לרווח")).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(pnlCalls().at(-1)).toEqual({ p_id: "tx", p_in_pnl: null }); });
  });

  it("writes true for a line of a kept-out category", async () => {
    rpc.excluded = true;
    showLive();
    fireEvent.click(await pnlSwitch());
    await waitFor(() => { expect(pnlCalls()).toEqual([{ p_id: "tx", p_in_pnl: true }]); });
  });

  it("toasts the failure and leaves the switch as it was", async () => {
    rpc.fail = { message: "transaction not found", code: "P0001" };
    showLive();
    fireEvent.click(await pnlSwitch());
    expect(await screen.findByText("לא הצלחנו לעדכן את השורה.")).toBeTruthy();
    expect(await pnlSwitch()).toBeChecked();
  });

  it("says a refused viewer has no permission", async () => {
    rpc.fail = { message: "forbidden", code: "42501" };
    showLive();
    fireEvent.click(await pnlSwitch());
    expect(await screen.findByText("אין הרשאה לעדכן את השורה.")).toBeTruthy();
  });
});
