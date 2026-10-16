import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TransactionScreen } from "./flow-screens";
import { renderWithProviders } from "../test-render";
import { loadReadSchemas } from "../load-read-schemas";

// The bank line (get_line_meta) on the live transaction screen: a failed read shows the פרטי הבנק retry row,
// and a retry that succeeds replaces the row with the bank line.
const rpc = vi.hoisted(() => ({
  metaFail: false,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    rpc: (name: string) => {
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
            source: "bank",
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
            in_cash_override: null,
            cash_state: "in",
            pnl_fixed: false,
          },
          error: null,
        });
      }
      if (name === "get_line_meta") {
        if (rpc.metaFail) return Promise.resolve({ data: null, error: { message: "boom" } });
        return Promise.resolve({
          data: [
            {
              transaction_id: "tx",
              method: "ach",
              card_last4: null,
              memo: null,
              account: "Example Checking ••1234",
              counterparty: null,
              bank_description: null,
            },
          ],
          error: null,
        });
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

// The first mount is a cold start in jsdom: pay it here, then clear the DOM.
beforeAll(async () => {
  await loadReadSchemas();
  showLive();
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  cleanup();
});

beforeEach(() => {
  rpc.metaFail = false;
});

describe("transaction bank line retry (FLOW-304)", () => {
  it("shows a פרטי הבנק retry row when the meta read fails, and the bank account after a retry", async () => {
    rpc.metaFail = true;
    showLive();
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר: פרטי הבנק" });
    expect(screen.getByText("לא הצלחנו לטעון.")).toBeInTheDocument();

    rpc.metaFail = false;
    fireEvent.click(retry);
    expect(await screen.findByText("Example Checking ••1234")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר: פרטי הבנק" })).not.toBeInTheDocument();
    expect(screen.queryByText("לא הצלחנו לטעון.")).not.toBeInTheDocument();
  });
});
