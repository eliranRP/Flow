import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import type { PaymentRecurring, TransactionDetail } from "@flow/shared";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { TxnChargeSwitches } from "./transaction-charge-switches";

// The live path (no sample): the recurring switch flips at once while set_payment_recurring is pending,
// and goes back with a retry toast when the write fails (decision 0180). Invented data only.
const db = vi.hoisted(() => ({
  rpcs: [] as Array<{ name: string; args: unknown }>,
  gate: null as Promise<{ data: null; error: { message: string } | null }> | null,
}));

vi.mock("../forecast", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../forecast")>()),
  usePaymentRecurringQuery: (transactionId: string) => useQuery({
    queryKey: ["payment-recurring", "off", transactionId],
    queryFn: () => Promise.resolve(found),
    staleTime: Infinity,
  }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: unknown) => {
      db.rpcs.push({ name, args });
      if (db.gate != null) return db.gate;
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const txn: NonNullable<TransactionDetail> = {
  id: "t-1",
  description: "אור חשמל",
  direction: "expense",
  doc_date: "2026-10-04",
  amount_gross: -255_000n,
  amount_net: -255_000n,
  vat_amount: 0n,
  vat_status: "source",
  source: "sumit",
  pnl_role: "project",
  review_status: "approved",
  project_id: "p1",
  project_name: "בניין לדוגמה",
  category_id: "c1",
  category_name: "חשמל",
  supplier_name: "אור חשמל",
  customer_name: null,
  allocations: [],
  in_pnl_override: null,
  category_excluded_from_pnl: false,
  in_pnl: true,
  pnl_fixed: false,
};

const found: PaymentRecurring = {
  transaction_id: "t-1",
  party: { direction: "expense", id: "s1", name: "אור חשמל", currency: "ILS" },
  recurring: true,
  override: null,
  detected: true,
  typical_day: 4,
  typical_amount_minor: -185_000n,
  pace: "month",
  pace_override: null,
  detected_pace: "month",
  next_due_month: "2026-11",
};

describe("payment page recurring switch, live path (decision 0180)", () => {
  it("flips at once while the write is pending, and goes back with a retry when it fails", async () => {
    db.rpcs = [];
    let answer: (result: { data: null; error: { message: string } | null }) => void = () => undefined;
    db.gate = new Promise((resolve) => { answer = resolve; });
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ToastProvider>
          <MemoryRouter>
            <TxnChargeSwitches txn={txn} party="אור חשמל" holdWrites={false} />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => { expect(screen.getByRole("switch", { name: "חיוב קבוע" })).toBeChecked(); });
    fireEvent.click(screen.getByRole("switch", { name: "חיוב קבוע" }));
    // Off at once, and no busy mark on the switch while the write is pending.
    await waitFor(() => { expect(screen.getByRole("switch", { name: "חיוב קבוע" })).not.toBeChecked(); });
    expect(screen.getByRole("switch", { name: "חיוב קבוע" })).not.toHaveAttribute("aria-busy");
    expect(db.rpcs).toEqual([{ name: "set_payment_recurring", args: { p_id: "t-1", p_recurring: false } }]);
    await act(async () => {
      answer({ data: null, error: { message: "Failed to fetch" } });
      await Promise.resolve();
    });
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "חיוב קבוע" })).toBeChecked();
    db.gate = null;
  });
});
