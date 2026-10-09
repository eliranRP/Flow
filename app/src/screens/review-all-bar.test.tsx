import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { Session } from "@supabase/supabase-js";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthProvider } from "../auth";
import { BooksProvider } from "../use-books";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { ReviewScreen, resetReviewListFocus } from "./flow-screens";


const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args?: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

const supabase = {
  auth: {
    onAuthStateChange: (callback: (event: string, session: Session | null) => void) => {
      callback("INITIAL_SESSION", session);
      return { data: { subscription: { unsubscribe: () => undefined } } };
    },
    getSession: () => Promise.resolve({ data: { session } }),
    signOut: () => Promise.resolve({ error: null }),
  },
  rpc: (name: string, args?: unknown) => {
    rpc.calls.push({ name, args });
    return rpc.impl(name, args);
  },
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => supabase,
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
    user_metadata: { full_name: "דנה" },
    created_at: "2026-09-27T00:00:00Z",
    email: "dana@example.com",
  },
} satisfies Session;

function reviewRow(id: string, supplier: string, projectId: string | null, extra: Record<string, unknown> = {}) {
  return {
    id,
    transaction_id: `t-${id}`,
    description: supplier,
    doc_date: "2026-09-29",
    amount_net: -10_000,
    direction: "expense",
    reason: null,
    project_id: projectId,
    category_id: "c1",
    project_name: projectId === "p1" ? "הרצל" : projectId === "p2" ? "וילה" : null,
    category_name: "חומרים",
    supplier_name: supplier,
    doc_kind: "invoice",
    auto_approved_today: 3,
    ...extra,
  };
}

afterEach(() => {
  rpc.calls.length = 0;
  rpc.impl = () => Promise.resolve({ data: null, error: null });
  resetReviewListFocus();
});

function renderWithLine(path: string, options?: { viewer?: boolean }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const routes = (
    <Routes>
      <Route path="/review" element={<ReviewScreen />} />
      <Route path="/review/all" element={<ReviewScreen />} />
      <Route path="/review/change" element={<h1>שינוי</h1>} />
      <Route path="/transactions/:transactionId/split-category" element={<h1>עורך הפיצול</h1>} />
      <Route path="/transactions/:transactionId" element={<h1>תנועה</h1>} />
    </Routes>
  );
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[path]}>
          <AuthProvider>
            <BooksProvider>
              {options?.viewer ? <ViewerPreview>{routes}</ViewerPreview> : routes}
            </BooksProvider>
          </AuthProvider>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("the pinned review bar (FLOW-327)", () => {
  it("puts אישור, שינוי and דלג in one bar above the tab bar, and the skip toast above it", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1"), reviewRow("r2", "עגורני החוף", "p2")], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review");
    const approve = await screen.findByRole("button", { name: "אישור" });
    const bar = approve.closest(".ui-action-bar");
    expect(bar).toHaveAttribute("data-place", "tabbar");
    expect(bar).toHaveAttribute("data-toast-floor");
    expect(within(bar as HTMLElement).getByRole("link", { name: "שינוי" })).toBeInTheDocument();
    const skip = within(bar as HTMLElement).getByRole("button", { name: "דלג" });
    expect(document.querySelector(".ui-review-queue")).toHaveAttribute("data-bar");
    expect(screen.getByText("פריט")).toHaveClass("sr-only");
    fireEvent.click(skip);
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "resolve_review")).toBe(true);
    });
    const toast = await screen.findByText("דילגנו על הפריט");
    expect(toast.closest(".ui-toast-host")).toHaveAttribute("data-place", "bar");
    expect(within(toast.closest(".ui-toast") as HTMLElement).getByRole("button", { name: "ביטול" })).toBeInTheDocument();
  });

  it("keeps focus on the bar's first button when the next card is a split_mismatch (FLOW-327 r1)", async () => {
    let skipped = false;
    rpc.impl = (name) => {
      if (name === "list_review") {
        const mismatch = reviewRow("r2", "עגורני החוף", "p2", { reason: "split_mismatch" });
        return Promise.resolve({ data: skipped ? [mismatch] : [reviewRow("r1", "מחסן הנמל", "p1"), mismatch], error: null });
      }
      if (name === "approve_review_item") skipped = true;
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review");
    const approve = await screen.findByRole("button", { name: "אישור" });
    approve.focus();
    fireEvent.click(approve);
    expect(await screen.findByRole("heading", { name: "עגורני החוף" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "עדכון הפיצול" })).toHaveFocus();
    });
  });

  it("moves focus to אישור when the next card is a normal card (FLOW-327 r2)", async () => {
    let skipped = false;
    rpc.impl = (name) => {
      if (name === "list_review") {
        const next = reviewRow("r2", "עגורני החוף", "p2");
        return Promise.resolve({ data: skipped ? [next] : [reviewRow("r1", "מחסן הנמל", "p1"), next], error: null });
      }
      if (name === "resolve_review") skipped = true;
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review");
    const skip = await screen.findByRole("button", { name: "דלג" });
    skip.focus();
    fireEvent.click(skip);
    // A browser drops focus to the page when the button goes disabled; jsdom does not.
    (document.activeElement as HTMLElement | null)?.blur();
    expect(await screen.findByRole("heading", { name: "עגורני החוף" })).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "אישור" })).toHaveFocus();
    });
  });

  it("disables דלג while אישור is writing (FLOW-327 r1)", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1"), reviewRow("r2", "עגורני החוף", "p2")], error: null });
      if (name === "approve_review_item") return new Promise(() => undefined);
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review");
    const approve = await screen.findByRole("button", { name: "אישור" });
    const skip = screen.getByRole("button", { name: "דלג" });
    expect(skip).toBeEnabled();
    fireEvent.click(approve);
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "approve_review_item")).toBe(true);
    });
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "דלג" })).toBeDisabled();
    });
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    expect(rpc.calls.some((call) => call.name === "resolve_review")).toBe(false);
  });

  it("says why when both fields are missing, and points the button at it", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", null, { category_id: null, category_name: null })], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review");
    const pick = await screen.findByRole("button", { name: "בחירת פרויקט" });
    expect(pick).toBeEnabled();
    const hint = screen.getByText("בחרו פרויקט וקטגוריה");
    expect(pick).toHaveAttribute("aria-describedby", hint.id);
    expect(hint.closest(".ui-review")).not.toBeNull();
  });

  it("does not say it when only one field is missing", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", null)], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review");
    const pick = await screen.findByRole("button", { name: "בחירת פרויקט" });
    expect(pick).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("בחרו פרויקט וקטגוריה")).toBeNull();
  });

  it("a split_mismatch card leads with עדכון הפיצול; להשאיר כך approves the line as it stands (FLOW-333 C2, C8)", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1", { reason: "split_mismatch" })], error: null });
      if (name === "get_line_split") {
        return Promise.resolve({
          data: { parts: [
            { id: "a", category_id: "c1", category_name: "חומרים", project_id: null, project_name: null, amount_minor: -6000 },
            { id: "b", category_id: "c2", category_name: "הובלה", project_id: null, project_name: null, amount_minor: -3000 },
          ], transaction_id: "t-r1", line_minor: -10000, parts_match: false },
          error: null,
        });
      }
      if (name === "approve_review_item") return Promise.resolve({ data: { ok: true }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review");
    const fix = await screen.findByRole("button", { name: "עדכון הפיצול" });
    expect(fix.closest(".ui-action-bar")).not.toBeNull();
    expect(screen.queryByRole("link", { name: "שינוי" })).toBeNull();
    expect(screen.queryByRole("button", { name: "אישור" })).toBeNull();
    const keep = screen.getByRole("button", { name: "להשאיר כך" });
    expect(keep).toHaveAttribute("aria-describedby", "review-mismatch");
    expect(document.getElementById("review-mismatch")).toHaveTextContent("הפיצול לא תואם את סכום השורה בבנק.");
    expect(screen.getByRole("button", { name: "דלג" })).toBeInTheDocument();
    expect(screen.queryByText("הצעה")).toBeNull();
    await waitFor(() => {
      expect(document.querySelector(".ui-review-split-row")).toHaveTextContent("מפוצל · 2 חלקים");
    });
    expect(rpc.calls.find((call) => call.name === "get_line_split")?.args).toEqual({ p_transaction_id: "t-r1" });
    fireEvent.click(keep);
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "approve_review_item")).toBe(true);
    });
  });

  it("עדכון הפיצול opens the parts editor", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1", { reason: "split_mismatch" })], error: null });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review");
    fireEvent.click(await screen.findByRole("button", { name: "עדכון הפיצול" }));
    expect(await screen.findByRole("heading", { name: "עורך הפיצול" })).toBeInTheDocument();
  });

  it("shows no flag and no error when the anomaly read fails", async () => {
    rpc.impl = (name) => {
      if (name === "list_review") return Promise.resolve({ data: [reviewRow("r1", "מחסן הנמל", "p1")], error: null });
      if (name === "review_anomalies") return Promise.resolve({ data: null, error: { message: "forbidden" } });
      return Promise.resolve({ data: null, error: null });
    };
    renderWithLine("/review");
    expect(await screen.findByRole("button", { name: "אישור" })).toBeInTheDocument();
    await waitFor(() => {
      expect(rpc.calls.some((call) => call.name === "review_anomalies")).toBe(true);
    });
    expect(document.querySelector(".ui-review-flag, .ui-review-flag-quiet")).toBeNull();
    expect(document.querySelector(".ui-toast-bad")).toBeNull();
  });
});
