import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { unpaidRowSchema } from "@flow/shared";
import { InvoiceScreen } from "./invoice-screen";
import { ToastProvider } from "../ui/toast";

// FLOW-367: the live path of the bank match on the invoice page. The real list query runs: list_unpaid answers the
// server's JSON (plain numbers, amount_minor) and the app parses it. "זה התשלום" calls link_invoice_payment and
// "לא זה" calls dismiss_invoice_match, each with the invoice and the deposit.
const db = vi.hoisted(() => ({
  rows: [] as unknown[],
  rpcs: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("../use-books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-books")>()),
  useSumitStatusQuery: () => ({ data: undefined }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: { p_invoice: string; p_transaction: string }) => {
      db.rpcs.push({ name, args });
      if (name === "list_unpaid") return Promise.resolve({ data: db.rows, error: null });
      if (name === "link_invoice_payment" && args != null) db.rows = db.rows.filter((row) => (row as { id: string }).id !== args.p_invoice);
      if (name === "dismiss_invoice_match" && args != null) db.rows = db.rows.map((row) => (((row as { id: string }).id === args.p_invoice) ? { ...(row as object), match: null } : row));
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

/** One open invoice as list_unpaid sends it, with a bank deposit to offer. */
const serverInvoice = (): Record<string, unknown> => ({
  id: "inv-1", description: "חשבונית", doc_date: "2026-09-01", customer_name: "לקוח א", project_name: null,
  open_gross_agorot: 10000, open_net_agorot: 10000, currency: "ILS", direction: "income", marked_paid_at: null,
  days_open: 45,
  match: { transaction_id: "tx-9", date: "2026-10-05", account_name: "בנק", raw_description: "העברה", amount_minor: 10000 },
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
    db.rows = [serverInvoice()];
    db.rpcs = [];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "זה התשלום" }));
    await waitFor(() => { expect(db.rpcs.filter((call) => call.name !== "list_unpaid")).toEqual([{ name: "link_invoice_payment", args: { p_invoice: "inv-1", p_transaction: "tx-9" } }]); });
  });

  it("לא זה sends dismiss_invoice_match and the match card goes", async () => {
    db.rows = [serverInvoice()];
    db.rpcs = [];
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "לא זה" }));
    await waitFor(() => { expect(db.rpcs.filter((call) => call.name !== "list_unpaid")).toEqual([{ name: "dismiss_invoice_match", args: { p_invoice: "inv-1", p_transaction: "tx-9" } }]); });
    await waitFor(() => { expect(screen.queryByRole("region", { name: "תשלום תואם בבנק" })).toBeNull(); });
  });

  it("the list schema reads a match (amount_minor) and an invoice dated after today (negative days_open)", () => {
    const rows = unpaidRowSchema.array().parse([serverInvoice(), { ...serverInvoice(), id: "inv-2", days_open: -3 }]);
    expect(rows[0]?.match?.amount_minor).toBe(10000n);
    expect(rows[1]?.days_open).toBe(-3);
  });
});
