import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { TransactionScreen } from "./flow-screens";

const rpc = vi.hoisted(() => ({ calls: [] as string[] }));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    rpc: (name: string) => {
      rpc.calls.push(name);
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const manual = {
  id: "t2",
  description: "מלט",
  direction: "expense",
  doc_date: "2026-09-12",
  amount_gross: -1_180_000n,
  amount_net: -1_000_000n,
  vat_amount: -180_000n,
  vat_status: "assumed",
  source: "manual",
  project_id: "p1",
  project_name: "חולון",
  category_id: "c1",
  category_name: "חומרים",
  supplier_name: "ספק",
  customer_name: null,
  paid: true,
  open_gross_agorot: null,
} as const;

describe("delete on a card opened from a list", () => {
  it("returns to that list and refreshes the lists that showed the row", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const lists = [["project", "off", "p1"], ["project-category", "off", "p1", "c1"], ["filed-today", "off"]];
    for (const key of lists) client.setQueryData(key, []);
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <BooksProvider>
            <MemoryRouter
              initialEntries={["/projects/p1", { pathname: "/transactions/t2", state: { txnList: { ids: ["t1", "t2", "t3"], from: "/projects/p1" } } }]}
              initialIndex={1}
            >
              <Routes>
                <Route path="/projects/:projectId" element={<p>the list</p>} />
                <Route path="/transactions/:transactionId" element={<TransactionScreen sample={manual} />} />
              </Routes>
            </MemoryRouter>
          </BooksProvider>
        </ToastProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    fireEvent.click(screen.getByRole("button", { name: "מחיקה" }));
    fireEvent.click(within(await screen.findByRole("dialog", { name: "למחוק את הרשומה?" })).getByRole("button", { name: "מחיקה" }));
    expect(await screen.findByText("the list")).toBeInTheDocument();
    expect(rpc.calls).toContain("delete_transaction");
    await waitFor(() => {
      for (const key of lists) expect(client.getQueryState(key)?.isInvalidated, key.join("/")).toBe(true);
    });
  });
});
