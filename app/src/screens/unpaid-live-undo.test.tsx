import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import type { UnpaidRow } from "@flow/shared";
import { UnpaidScreen } from "./unpaid-screen";
import { ToastProvider } from "../ui/toast";

// FLOW-357: the live path (no sample). The toast's ביטול must send the second write, paid: false.
const db = vi.hoisted(() => ({
  rows: [] as UnpaidRow[],
  rpcs: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("../use-books", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../use-books")>()),
  useUnpaidQuery: () => useQuery({ queryKey: ["unpaid"], queryFn: () => Promise.resolve(db.rows) }),
  useSumitStatusQuery: () => ({ data: undefined }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: { p_id: string; p_paid: boolean }) => {
      db.rpcs.push({ name, args });
      if (name === "set_invoice_paid") {
        db.rows = db.rows.map((row) => (row.id === args.p_id ? { ...row, marked_paid_at: args.p_paid ? "2026-10-10T06:00:00Z" : null } : row));
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const invoice = (id: string, name: string): UnpaidRow => ({
  id, description: "חשבונית", doc_date: "2026-09-01", customer_name: name, project_name: null,
  open_gross_agorot: 10_000n, open_net_agorot: 10_000n, currency: "ILS", direction: "income", marked_paid_at: null,
});

describe("Unpaid mark undo on the live path (FLOW-357)", () => {
  it("marks from the sheet, then the toast's ביטול clears the mark with a second write", async () => {
    db.rows = [invoice("a", "לקוח א"), invoice("b", "לקוח ב")];
    db.rpcs = [];
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter>
          <ToastProvider>
            <UnpaidScreen />
          </ToastProvider>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: /לקוח א/ }));
    const sheet = await screen.findByRole("dialog", { name: "לקוח א" });
    fireEvent.click(within(sheet).getByRole("button", { name: "סימון כשולם" }));
    const undo = await screen.findByRole("button", { name: "ביטול" });
    expect(db.rpcs).toEqual([{ name: "set_invoice_paid", args: { p_id: "a", p_paid: true } }]);
    fireEvent.click(undo);
    await waitFor(() => { expect(db.rpcs).toHaveLength(2); });
    expect(db.rpcs[1]).toEqual({ name: "set_invoice_paid", args: { p_id: "a", p_paid: false } });
  });
});
