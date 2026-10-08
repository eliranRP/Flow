import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import type { JevReviewState } from "./jev-review";
import { ChangeForm } from "./flow-screens";

const state = vi.hoisted((): { jev: JevReviewState; row: Record<string, unknown> } => ({
  jev: { connectorOn: false, prefill: null },
  row: {},
}));

vi.mock("./jev-review-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jev-review-card")>();
  return { ...actual, useJevReview: () => ({ ...state.jev, loading: false }) };
});

const dashboard = {
  company_id: "c",
  name: "אלפא",
  vat_registered: true,
  basis: "invoiced",
  from: "2026-09-01",
  to: "2026-09-28",
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  overhead_agorot: 0,
  expense_agorot: 0,
  net_profit_agorot: 0,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 1,
  review_count: 1,
  projects: [
    { id: "p1", name: "הרצל", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 },
  ],
};

const supabase = {
  rpc: (name: string) => {
    if (name === "list_review") return Promise.resolve({ data: [state.row], error: null });
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
    if (name === "list_categories") {
      return Promise.resolve({
        data: [
          { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
          { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
        ],
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  },
};

vi.mock("../lib/supabase", () => ({ getSupabase: () => supabase }));

function row(extra: Record<string, unknown> = {}) {
  return {
    id: "r1",
    transaction_id: "t1",
    description: "מחסן הנמל",
    doc_date: "2026-09-29",
    amount_net: -10_000,
    direction: "expense",
    reason: "missing_category",
    project_id: "p1",
    category_id: null,
    project_name: "הרצל",
    category_name: null,
    supplier_name: "מחסן הנמל",
    doc_kind: "invoice",
    ...extra,
  };
}

function renderChange() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/review/change?item=r1"]}>
          <BooksProvider>
            <Routes>
              <Route path="/review/change" element={<ChangeForm />} />
            </Routes>
          </BooksProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

afterEach(() => {
  state.jev = { connectorOn: false, prefill: null };
});

describe("the change sheet seeded with a Jev guess (FLOW-703)", () => {
  it("starts remember off when the category came from Jev", async () => {
    state.row = row();
    state.jev = {
      connectorOn: true,
      prefill: { suggestionId: "s1", transactionId: "t1", project: null, category: { id: "c2", name: "הובלה" } },
    };
    renderChange();
    const toggle = await screen.findByRole("switch", { name: /לזכור לספק הזה/, hidden: true });
    await waitFor(() => {
      expect(toggle).not.toBeChecked();
    });
  });

  it("keeps remember on when the category is the line's own", async () => {
    state.row = row({ category_id: "c1", category_name: "חומרים", category_suggested: true });
    renderChange();
    const toggle = await screen.findByRole("switch", { name: /לזכור לספק הזה/, hidden: true });
    expect(toggle).toBeChecked();
  });
});
