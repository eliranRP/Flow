import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider, useFiledTodayQuery, useTransactionQuery } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ReviewScreen } from "./flow-screens";

// FLOW-309: approving a card, and ביטול on its toast, refresh the open filed-today list and the
// transaction's own card live, without a reload.

const rpc = vi.hoisted(() => ({
  handlers: [] as Array<(event: string, session: Session | null) => void>,
  calls: [] as string[],
}));

const item = {
  id: "r1",
  transaction_id: "t1",
  description: "מלט",
  doc_date: "2026-09-01",
  doc_kind: "invoice",
  amount_net: -100,
  vat_agorot: 18,
  direction: "expense",
  reason: "suggested",
  project_id: "p1",
  category_id: "c1",
  project_name: "הרצל",
  category_name: "חומרים",
  confidence: 92,
  supplier_name: "מחסן",
  project_suggested: true,
  category_suggested: true,
  auto_approved_today: 0,
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    auth: {
      onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
        rpc.handlers.push(callback);
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
      getSession: () => Promise.resolve({ data: { session } }),
      signOut: () => Promise.resolve({ error: null }),
    },
    rpc: (name: string) => {
      rpc.calls.push(name);
      if (name === "list_review") return Promise.resolve({ data: [item], error: null });
      if (name === "list_auto_assigned_today") return Promise.resolve({ data: [], error: null });
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const session = {
  access_token: "test",
  refresh_token: "test",
  expires_in: 3600,
  token_type: "bearer",
  user: {
    id: "11111111-1111-1111-1111-111111111111",
    aud: "authenticated",
    app_metadata: {},
    user_metadata: {},
    created_at: "2026-09-27T00:00:00Z",
    email: "dana@example.com",
  },
} satisfies Session;

/** Keeps the filed-today list and the line's card open while the review screen works. */
function OpenElsewhere() {
  useFiledTodayQuery();
  useTransactionQuery("t1");
  return null;
}

function reads(name: string): number {
  return rpc.calls.filter((call) => call === name).length;
}

afterEach(() => {
  rpc.handlers.length = 0;
  rpc.calls.length = 0;
});

describe("review approve and undo refresh", () => {
  it("re-reads filed-today and the transaction after אישור, and again after ביטול", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter initialEntries={["/review"]}>
            <AuthProvider>
              <BooksProvider>
                <ReviewScreen />
                <OpenElsewhere />
              </BooksProvider>
            </AuthProvider>
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    act(() => {
      for (const handler of rpc.handlers) handler("INITIAL_SESSION", session);
    });
    const approveButton = await screen.findByRole("button", { name: "אישור" });
    // Both are read once on open, before אישור, so a read after the approve is a refresh.
    await waitFor(() => {
      expect(reads("list_auto_assigned_today")).toBe(1);
      expect(reads("get_transaction")).toBe(1);
    });
    fireEvent.click(approveButton);
    const toast = await screen.findByRole("button", { name: "ביטול" });
    await waitFor(() => {
      expect(rpc.calls).toContain("approve_review_item");
    });
    const approve = rpc.calls.lastIndexOf("approve_review_item");
    await waitFor(() => {
      expect(rpc.calls.slice(approve)).toContain("list_auto_assigned_today");
      expect(rpc.calls.slice(approve)).toContain("get_transaction");
    });

    fireEvent.click(toast);
    await waitFor(() => { expect(rpc.calls).toContain("reopen_review"); });
    const reopen = rpc.calls.lastIndexOf("reopen_review");
    await waitFor(() => {
      expect(rpc.calls.slice(reopen)).toContain("list_auto_assigned_today");
      expect(rpc.calls.slice(reopen)).toContain("get_transaction");
    });
    expect(await screen.findByText("הפריט חזר לתור, והשיוך הקודם שוחזר.")).toBeInTheDocument();
  });
});
