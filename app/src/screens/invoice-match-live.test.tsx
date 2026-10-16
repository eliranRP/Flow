import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { InvoiceScreen } from "./invoice-screen";
import type { UnpaidInvoice } from "../unpaid";
import { ToastProvider } from "../ui/toast";

// FLOW-367: the live path of the bank match on the invoice page. "זה התשלום" calls link_invoice_payment and
// "לא זה" calls dismiss_invoice_match, each with the invoice and the deposit; the rows answer as the server does.
const db = vi.hoisted(() => ({
  rows: [] as UnpaidInvoice[],
  rpcs: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("../use-books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-books")>()),
  useUnpaidQuery: () => useQuery({ queryKey: ["unpaid", "match-live"], queryFn: () => Promise.resolve(db.rows) }),
  useSumitStatusQuery: () => ({ data: undefined }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: { p_invoice: string; p_transaction: string }) => {
      db.rpcs.push({ name, args });
      if (name === "link_invoice_payment") db.rows = db.rows.filter((row) => row.id !== args.p_invoice);
      if (name === "dismiss_invoice_match") db.rows = db.rows.map((row) => (row.id === args.p_invoice ? { ...row, match: null } : row));
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const invoice = (): UnpaidInvoice => ({
  id: "inv-1", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח א", project_name: null,
  open_gross_agorot: 10_000n, open_net_agorot: 10_000n, currency: "ILS", direction: "income", marked_paid_at: null,
  days_open: 45,
  match: { transaction_id: "tx-9", date: "2026-10-05", account_name: "בנק", raw_description: "העברה", amount_agorot: 10_000n },
});

function renderPage() {
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={["/unpaid/inv-1"]}>
        <ToastProvider>
          <Routes>
            <Route path="/unpaid/:invoiceId" element={<InvoiceScreen />} />
          </Routes>
        </ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("Bank match writes on the live path (FLOW-367)", () => {
  it("זה התשלום sends link_invoice_payment with the invoice and the deposit", async () => {
    db.rows = [invoice()];
    db.rpcs = [];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "זה התשלום" }));
    await waitFor(() => { expect(db.rpcs).toEqual([{ name: "link_invoice_payment", args: { p_invoice: "inv-1", p_transaction: "tx-9" } }]); });
  });

  it("לא זה sends dismiss_invoice_match and the match card goes", async () => {
    db.rows = [invoice()];
    db.rpcs = [];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "לא זה" }));
    await waitFor(() => { expect(db.rpcs).toEqual([{ name: "dismiss_invoice_match", args: { p_invoice: "inv-1", p_transaction: "tx-9" } }]); });
    await waitFor(() => { expect(screen.queryByRole("region", { name: "תשלום תואם בבנק" })).toBeNull(); });
  });
});
