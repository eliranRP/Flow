import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinReviewLine } from "../review-pin";
import { ToastProvider } from "../ui/toast";
import type { ReviewPaging } from "../use-review";
import { takeReviewFocus } from "./review-focus";
import { ReviewQueue } from "./flow-screens";

vi.mock("../lib/supabase", () => ({ getSupabase: () => null }));

function row(n: number): ReviewRow {
  const id = `r${String(n).padStart(3, "0")}`;
  return {
    id,
    transaction_id: id,
    description: `ספק ${id}`,
    doc_date: "2026-06-20",
    amount_net: -1_000n,
    direction: "expense",
    reason: null,
    project_id: "p",
    category_id: "c",
    supplier_name: `ספק ${id}`,
    project_name: "אלפא",
    category_name: "מלט",
  };
}

const rowsOf = (count: number) => Array.from({ length: count }, (_, index) => row(index + 1));

function pagingOf(extra: Partial<ReviewPaging> = {}): ReviewPaging {
  return { total: 1287, more: true, loading: false, failed: false, loadMore: vi.fn(), retry: vi.fn(), ...extra };
}

const write = { run: () => Promise.resolve(), onDone: () => undefined, onUndo: () => undefined };

function queue(rows: ReviewRow[], paging: ReviewPaging) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <ToastProvider>
        <MemoryRouter>
          <ReviewQueue rows={rows} search="" sample paging={paging} previewWrite={write} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

// These tests are about the order of the cards, not the swap between them: with reduced motion the next card
// shows at once (review-swap.ts), so a busy CI runner can't outrun the 200 ms swap and the 1 s wait for the card.
beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query: string) =>
      ({
        matches: query.includes("prefers-reduced-motion"),
        media: query,
        onchange: null,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  pinReviewLine(null);
  takeReviewFocus();
});

describe("FLOW-984: the queue loads its next page ahead of the owner", () => {
  it("counts from the server's total, with a thousands comma", () => {
    render(queue(rowsOf(50), pagingOf()));
    const counter = document.querySelector(".ui-review-counter");
    expect(counter?.textContent).toBe("פריט 1 מתוך 1,287");
    expect(screen.getByRole("meter", { name: "התקדמות התור" })).toHaveAttribute("aria-valuemax", "1287");
  });

  it("starts the next page when 15 cards are left, and not before", () => {
    const paging = pagingOf();
    const { unmount } = render(queue(rowsOf(16), paging));
    expect(paging.loadMore).not.toHaveBeenCalled();
    unmount();
    render(queue(rowsOf(15), paging));
    expect(paging.loadMore).toHaveBeenCalledTimes(1);
  });

  it("starts nothing while a page is loading, after a failed page, or when every page is loaded", () => {
    const loading = pagingOf({ loading: true });
    const failed = pagingOf({ failed: true });
    const done = pagingOf({ more: false, total: 15 });
    for (const paging of [loading, failed, done]) {
      render(queue(rowsOf(15), paging));
      cleanup();
      expect(paging.loadMore).not.toHaveBeenCalled();
    }
  });

  it("a skipped card waits behind the cards still to load: the queue does not wrap to it until the last page", async () => {
    const paging = pagingOf({ loading: true });
    const { rerender } = render(queue(rowsOf(2), paging));
    expect(screen.getByRole("heading", { name: "ספק r001" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    expect(await screen.findByRole("heading", { name: "ספק r002" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    // Nothing is left ahead and a page is still on its way: the skipped card does not come back yet.
    await waitFor(() => { expect(screen.queryByRole("heading", { name: /ספק r00/ })).not.toBeInTheDocument(); });
    expect(screen.queryByText("הכל מאושר")).not.toBeInTheDocument();
    // The page lands: its first card is next, and the skipped ones come after it.
    rerender(queue([...rowsOf(2), row(3)], pagingOf()));
    expect(await screen.findByRole("heading", { name: "ספק r003" })).toBeInTheDocument();
  });

  it("wraps to the first skipped card once every page is loaded", async () => {
    const paging = pagingOf({ more: false, total: 2 });
    render(queue(rowsOf(2), paging));
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    expect(await screen.findByRole("heading", { name: "ספק r002" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    expect(await screen.findByRole("heading", { name: "ספק r001" })).toBeInTheDocument();
  });
});

describe("FLOW-1016: the cards loaded are used up while a page loads", () => {
  it("keeps the queue's frame with the card's place as a skeleton, not the whole-screen loader", () => {
    render(queue([], pagingOf({ loading: true })));
    expect(screen.getByRole("heading", { name: "לאישור" })).toBeInTheDocument();
    expect(document.querySelector(".ui-review-card-loading")).not.toBeNull();
    expect(screen.getByText("טוענים עוד…")).toHaveAttribute("role", "status");
    expect(screen.queryByText("הכל מאושר")).not.toBeInTheDocument();
  });
});

describe("FLOW-984: a page that fails to load", () => {
  it("shows a quiet row where the next card would be, and its retry loads the page again", () => {
    const paging = pagingOf({ failed: true });
    render(queue(rowsOf(1), paging));
    expect(screen.getByText("לא הצלחנו לטעון עוד פריטים")).toBeInTheDocument();
    expect(screen.queryByText(/הבא בתור/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    expect(paging.retry).toHaveBeenCalledTimes(1);
  });

  it("leaves the next card in its place while there is one", () => {
    render(queue(rowsOf(3), pagingOf({ failed: true })));
    expect(screen.getByText(/הבא בתור: ספק r002/)).toBeInTheDocument();
    expect(screen.queryByText("לא הצלחנו לטעון עוד פריטים")).not.toBeInTheDocument();
  });

  it("takes the card's place when the cards loaded are used up", async () => {
    const paging = pagingOf({ failed: true });
    render(queue(rowsOf(1), paging));
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    // The row moves from below the card to the card's own place as the card leaves, so wait for where it settles.
    await waitFor(() => { expect(screen.getByText("לא הצלחנו לטעון עוד פריטים")).toBeInTheDocument(); });
    expect(screen.queryByText("הכל מאושר")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר" }));
    expect(paging.retry).toHaveBeenCalled();
  });
});
