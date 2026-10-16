import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionScreen } from "./flow-screens";
import { renderWithProviders } from "../test-render";

// FLOW-366 (decision 0180): the counted-in cash switch flips at once; the server's answer only corrects it.
const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  cashOverride: null as boolean | null,
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
            in_pnl_override: null,
            category_excluded_from_pnl: false,
            in_pnl: true,
            in_cash_override: rpc.cashOverride,
            cash_state: "in",
            pnl_fixed: false,
          },
          error: null,
        });
      }
      if (name === "set_transaction_cash") {
        const finish = () => {
          if (rpc.fail) return { data: null, error: rpc.fail };
          rpc.cashOverride = (args as { p_in_cash: boolean }).p_in_cash;
          return { data: { id: "tx" }, error: null };
        };
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

/** The cash switch sits in the נספר ב sheet: open the sheet when it is not up yet. */
async function cashSwitch() {
  if (!screen.queryByRole("switch", { name: "נספר בתזרים" })) {
    fireEvent.click(await screen.findByRole("button", { name: /^נספר ב/ }));
  }
  return screen.findByRole("switch", { name: "נספר בתזרים" });
}

// The first render of the screen in a file is a cold start (about 1.5s in jsdom: the first mount and the first
// role queries). Pay it here, outside the timed tests, then clear the DOM so the first test starts empty.
beforeAll(async () => {
  showLive();
  // The first mount is paid here; the queries of the first test then resolve at once.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup();
});

beforeEach(() => {
  rpc.calls.length = 0;
  rpc.cashOverride = null;
  rpc.fail = null;
  rpc.gate = null;
});

describe("the counted-in cash switch, live", () => {
  it("flips at once while the write is pending, and reverts when it fails", async () => {
    let release: () => void = () => undefined;
    rpc.gate = new Promise<void>((resolve) => { release = resolve; });
    rpc.fail = { message: "transaction not found", code: "P0001" };
    showLive();
    expect(await cashSwitch()).toBeChecked();
    fireEvent.click(await cashSwitch());
    // The write has not answered yet, and the switch already shows the tap.
    expect(await cashSwitch()).not.toBeChecked();
    await waitFor(() => {
      expect(rpc.calls.filter((call) => call.name === "set_transaction_cash").map((call) => call.args)).toEqual([{ p_id: "tx", p_in_cash: false }]);
    });
    release();
    expect(await screen.findByText("לא הצלחנו לעדכן את השורה.")).toBeTruthy();
    expect(await cashSwitch()).toBeChecked();
  });

  it("keeps the flip when the write succeeds, and ביטול clears the override again", async () => {
    showLive();
    fireEvent.click(await cashSwitch());
    expect(await cashSwitch()).not.toBeChecked();
    expect(await screen.findByText("הוצא מהתזרים")).toBeTruthy();
    fireEvent.click(await screen.findByText("ביטול"));
    await waitFor(() => {
      expect(rpc.calls.filter((call) => call.name === "set_transaction_cash").at(-1)?.args).toEqual({ p_id: "tx", p_in_cash: null });
    });
    expect(await cashSwitch()).toBeChecked();
  });
});
