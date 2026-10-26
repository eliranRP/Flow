import { QueryClient, QueryClientProvider, onlineManager, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UnpaidRow } from "@flow/shared";
import { UnpaidScreen } from "./unpaid-screen";
import { InvoiceScreen } from "./invoice-screen";
import { unpaidToast, UNPAID_UNDO_MS } from "./unpaid-actions";
import { ToastProvider } from "../ui/toast";

// FLOW-968: the invoice pages' undo toasts, the failed read and the offline line, on the live path.
const db = vi.hoisted(() => ({
  rows: [] as UnpaidRow[],
  rpcs: [] as Array<{ name: string; args: unknown }>,
  fail: false,
}));

vi.mock("../use-books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-books")>()),
  useUnpaidQuery: () => useQuery({
    queryKey: ["unpaid", "off"],
    queryFn: () => (db.fail ? Promise.reject(new Error("boom")) : Promise.resolve(db.rows)),
  }),
  useSumitStatusQuery: () => ({ data: undefined }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      db.rpcs.push({ name, args });
      if (name === "dismiss_invoice_match") {
        db.rows = db.rows.map((row) => (row.id === args.p_invoice ? { ...row, match: null } : row));
        return Promise.resolve({ data: { dismissed: true, dismissed_at: "2026-10-26T10:00:00.123456+00:00" }, error: null });
      }
      if (name === "set_invoice_paid") {
        db.rows = db.rows.map((row) => (row.id === args.p_id ? { ...row, marked_paid_at: args.p_paid === true ? "2026-10-26T10:00:00Z" : null } : row));
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const invoice = (id: string, name: string, extra: Partial<UnpaidRow> = {}): UnpaidRow => ({
  id, description: "חשבונית", doc_date: "2026-09-01", customer_name: name, project_name: null,
  open_gross_agorot: 10_000n, open_net_agorot: 10_000n, currency: "ILS", direction: "income", marked_paid_at: null,
  ...extra,
});

const matched = invoice("a", "לקוח א", {
  match: { transaction_id: "t1", amount_minor: 10_000n, date: "2026-09-05", account_name: "Example Bank", raw_description: "EXAMPLE WIRE" },
});

function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderPage(node: React.ReactNode) {
  render(
    <QueryClientProvider client={client()}>
      <MemoryRouter>
        <ToastProvider>{node}</ToastProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  onlineManager.setOnline(true);
  db.fail = false;
});

describe("Invoice toasts (FLOW-968, decision 0218)", () => {
  it("keeps an undo 5s and a note 4s, both under the header", () => {
    expect(unpaidToast({ message: "x", action: "ביטול", onAction: () => undefined })).toMatchObject({ place: "top", durationMs: UNPAID_UNDO_MS });
    expect(UNPAID_UNDO_MS).toBe(5000);
    expect(unpaidToast({ message: "x" })).toMatchObject({ place: "top", durationMs: 4000 });
  });

  it("לא זה offers ביטול, which takes back only that dismissal at the time it was written", async () => {
    db.rows = [matched];
    db.rpcs = [];
    renderPage(<InvoiceScreen invoiceId="a" />);
    fireEvent.click(await screen.findByRole("button", { name: "לא זה" }));
    const toast = await screen.findByRole("status");
    expect(toast.closest("[data-place]")).toHaveAttribute("data-place", "top");
    fireEvent.click(within(toast).getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(db.rpcs.map((rpc) => rpc.name)).toContain("undismiss_invoice_match"); });
    expect(db.rpcs.find((rpc) => rpc.name === "undismiss_invoice_match")?.args).toEqual({
      p_invoice: "a", p_transaction: "t1", p_dismissed_at: "2026-10-26T10:00:00.123456+00:00",
    });
  });

  it("clearing a mark offers ביטול, which marks it again", async () => {
    db.rows = [invoice("a", "לקוח א", { marked_paid_at: "2026-10-26T09:00:00Z" })];
    db.rpcs = [];
    renderPage(<UnpaidScreen />);
    const row = (await screen.findByRole("link", { name: /לקוח א/ })).closest("li") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "ביטול" }));
    const toast = await screen.findByRole("status");
    expect(within(toast).getByText("הסימון בוטל.")).toBeInTheDocument();
    fireEvent.click(within(toast).getByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(db.rpcs).toHaveLength(2); });
    expect(db.rpcs[1]).toEqual({ name: "set_invoice_paid", args: { p_id: "a", p_paid: true } });
  });
});

describe("Invoice states (FLOW-968)", () => {
  it("a failed read says so, with נסו שוב and צריך עזרה?", async () => {
    db.fail = true;
    renderPage(<UnpaidScreen />);
    expect(await screen.findByRole("heading", { name: "החשבוניות לא נטענו" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "צריך עזרה?" })).toHaveAttribute("href", "/help");
  });

  it("the invoice page's failed read says so too", async () => {
    db.fail = true;
    renderPage(<InvoiceScreen invoiceId="a" />);
    expect(await screen.findByRole("heading", { name: "החשבונית לא נטענה" })).toBeInTheDocument();
  });

  it("offline with invoices on screen, a line says which moment they are from", async () => {
    db.rows = [invoice("a", "לקוח א")];
    renderPage(<UnpaidScreen />);
    await screen.findByRole("link", { name: /לקוח א/ });
    onlineManager.setOnline(false);
    expect(await screen.findByText(/אין חיבור · מוצג המצב/)).toBeInTheDocument();
  });

  it("the bar names both amounts", async () => {
    db.rows = [invoice("a", "לקוח א")];
    renderPage(<UnpaidScreen summary={{ paid_agorot: 5_000n, issued_since: "2026-09-01", last_sync_at: null }} />);
    expect(await screen.findByRole("img", { name: /שולם .*פתוח/ })).toBeInTheDocument();
  });
});
