import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { TransactionScreen } from "./flow-screens";

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: () => undefined } } }),
    },
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

function card(id: string, supplier: string) {
  return {
    id,
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
    supplier_name: supplier,
    customer_name: null,
    paid: true,
    open_gross_agorot: null,
  } as const;
}

const list = { txnList: { ids: ["t1", "t2", "t3"], from: "/projects/p1" } };

function renderCard({ id, search = "", state, sample, client = new QueryClient() }: {
  id: string;
  search?: string;
  state?: unknown;
  sample?: ReturnType<typeof card>;
  client?: QueryClient;
}) {
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <BooksProvider>
          <MemoryRouter initialEntries={["/projects/p1", { pathname: `/transactions/${id}`, search, state }]} initialIndex={1}>
            <Routes>
              <Route path="/projects/:projectId" element={<p>the list</p>} />
              <Route path="/transactions/:transactionId" element={<TransactionScreen sample={sample} />} />
            </Routes>
          </MemoryRouter>
        </BooksProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("the step row on the transaction card (FLOW-345 option D)", () => {
  it("sits under the card, not in the top bar, with the words and the place in the list", () => {
    renderCard({ id: "t2", state: list, sample: card("t2", "ספק ב") });
    const row = screen.getByRole("group", { name: "מעבר בין תנועות" });
    expect(row).toHaveTextContent("הקודמת2 מתוך 3הבאה");
    expect(row.closest("header")).toBeNull();
    const header = document.querySelector("header");
    if (!header) throw new Error("no header");
    // The top bar keeps Back and ⋯ only.
    expect(within(header).queryByRole("button", { name: "התנועה הבאה" })).toBeNull();
    expect(within(header).queryByRole("button", { name: "התנועה הקודמת" })).toBeNull();
    expect(row.parentElement).toHaveClass("ui-txn-stepped");
  });

  it("shows no row on a card opened from a link", () => {
    renderCard({ id: "t2", sample: card("t2", "ספק ב") });
    expect(screen.queryByRole("group", { name: "מעבר בין תנועות" })).toBeNull();
    expect(document.querySelector(".ui-txn-stepped")).toBeNull();
  });

  it("peeks the neighbour's name from the cache the prefetch warms, and a plain edge without it", () => {
    const client = new QueryClient();
    client.setQueryData(["txn", "off", "t3"], card("t3", "ספק ג"));
    renderCard({ id: "t2", state: list, sample: card("t2", "ספק ב"), client });
    const next = document.querySelector('.ui-cswipe-peek[data-side="next"]');
    const prev = document.querySelector('.ui-cswipe-peek[data-side="prev"]');
    expect(next).toHaveTextContent("ספק ג");
    expect(next).toHaveAttribute("aria-hidden", "true");
    expect(prev).toBeEmptyDOMElement();
  });

  it("keeps the row while the card loads, so the walk can go on past it", () => {
    renderCard({ id: "t2", search: "?preview=loading", state: list });
    expect(screen.getByRole("group", { name: "מעבר בין תנועות" })).toHaveTextContent("2 מתוך 3");
  });
});
