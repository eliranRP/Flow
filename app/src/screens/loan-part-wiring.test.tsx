import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { TransactionScreen } from "./flow-screens";

// FLOW-122 review: the live card passes the line's category loan_part, read from
// list_categories by id, to the loan split. A renamed principal category still counts.
const rpc = vi.hoisted(() => ({ categoryId: "c-p" }));

vi.mock("./loan-match", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./loan-match")>()),
  LoanTransactionSplit: ({ loanPart }: { loanPart: string | null }) => <p>{`loan part: ${String(loanPart)}`}</p>,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      getSession: () => Promise.resolve({ data: { session: { access_token: "t" } }, error: null }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    rpc: (name: string) => {
      if (name === "list_categories") {
        return Promise.resolve({
          data: [
            { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: false, loan_part: null },
            { id: "c-p", name: "החזר הלוואה", kind: "expense", hidden: false, is_default: true, excluded_from_pnl: true, loan_part: "principal" },
          ],
          error: null,
        });
      }
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
            category_id: rpc.categoryId,
            category_name: rpc.categoryId === "c-p" ? "החזר הלוואה" : "חומרים",
            supplier_name: "ספק לדוגמה",
            customer_name: null,
            paid: false,
            open_gross_agorot: null,
            allocations: [],
            in_pnl_override: null,
            category_excluded_from_pnl: rpc.categoryId === "c-p",
            in_pnl: rpc.categoryId !== "c-p",
            pnl_fixed: false,
          },
          error: null,
        });
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

beforeEach(() => {
  rpc.categoryId = "c-p";
});

describe("the transaction card passes loan_part to the loan split", () => {
  it("passes principal for a line in the renamed principal category", async () => {
    showLive();
    expect(await screen.findByText("loan part: principal")).toBeTruthy();
  });

  it("passes null for a line in any other category", async () => {
    rpc.categoryId = "c1";
    showLive();
    expect(await screen.findByText("loan part: null")).toBeTruthy();
    expect(screen.queryByText("loan part: principal")).toBeNull();
  });
});
