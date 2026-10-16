import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionScreen } from "./flow-screens";
import { renderWithProviders } from "../test-render";
import { loadReadSchemas } from "../load-read-schemas";

// FLOW-366: the recurring row is not optimistic (decision 0180 covers the cash switch only). It waits
// in the pace sheet: the other choices are held until the write answers, and they open again when it fails.
const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  fail: null as { message: string; code?: string } | null,
  gate: null as Promise<void> | null,
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
            description: "ספק חשמל לדוגמה",
            direction: "expense",
            doc_date: "2026-10-04",
            amount_gross: -255000,
            amount_net: -255000,
            vat_amount: 0,
            vat_status: "source",
            source: "sumit",
            pnl_role: "project",
            review_status: "approved",
            project_id: "p1",
            project_name: "בניין לדוגמה",
            category_id: "c1",
            category_name: "חשמל",
            supplier_name: "ספק חשמל לדוגמה",
            customer_name: null,
            paid: false,
            open_gross_agorot: null,
            allocations: [],
            in_pnl_override: null,
            category_excluded_from_pnl: false,
            in_pnl: true,
            pnl_fixed: false,
          },
          error: null,
        });
      }
      if (name === "payment_recurring") {
        return Promise.resolve({
          data: {
            transaction_id: "tx",
            party: { direction: "expense", id: "s1", name: "ספק חשמל לדוגמה", currency: "ILS" },
            recurring: true,
            override: null,
            detected: true,
            typical_day: 4,
            typical_amount_minor: -185000,
            pace: "month",
            pace_override: null,
            detected_pace: "month",
            next_due_month: "2026-11",
          },
          error: null,
        });
      }
      if (name === "set_payment_pace") {
        const finish = () => ({ data: null, error: rpc.fail });
        return rpc.gate ? rpc.gate.then(finish) : Promise.resolve(finish());
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

function showLive() {
  renderWithProviders(
    <Routes>
      <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
    </Routes>,
    { route: "/transactions/tx" },
  );
}

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.fail = null;
  rpc.gate = null;
});

// The first render of the screen in a file is a cold start (about 1.5s in jsdom: the first mount and the first
// role queries). Pay it here, outside the timed tests, then clear the DOM so the first test starts empty.
beforeAll(async () => {
  await loadReadSchemas();
  showLive();
  await screen.findByRole("button", { name: /תשלום קבוע/ }, { timeout: 8000 });
  cleanup();
});

describe("the recurring row, live", () => {
  it("holds the other pace choices while the write is pending, and enables them again when it fails", async () => {
    let release: () => void = () => undefined;
    rpc.gate = new Promise<void>((resolve) => { release = resolve; });
    rpc.fail = { message: "transaction not found", code: "P0001" };
    showLive();
    fireEvent.click(await screen.findByRole("button", { name: /תשלום קבוע/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "כל רבעון" }));
    await waitFor(() => {
      expect(rpc.calls.filter((call) => call.name === "set_payment_pace").map((call) => call.args)).toEqual([{ p_id: "tx", p_pace: "quarter" }]);
    });
    // While the write is pending the other choices are held, so nothing else can be tapped.
    expect(screen.getByRole("radio", { name: "כל שנה" })).toBeDisabled();
    release();
    expect(await screen.findByText("לא הצלחנו לעדכן את השורה.")).toBeTruthy();
    expect(screen.getByRole("radio", { name: "כל שנה" })).toBeEnabled();
    expect(screen.getByRole("radio", { name: "כל רבעון" })).toBeEnabled();
  });
});
