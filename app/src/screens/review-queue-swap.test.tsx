import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { pinReviewLine } from "../review-pin";
import { takeReviewFocus } from "./review-focus";
import { ToastProvider } from "../ui/toast";
import { ReviewQueue } from "./flow-screens";

vi.mock("../lib/supabase", () => ({ getSupabase: () => null }));

function row(id: string, supplier: string, extra: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id,
    transaction_id: id,
    description: supplier,
    doc_date: "2026-06-20",
    amount_net: -1_000n,
    direction: "expense",
    reason: null,
    project_id: "p",
    category_id: "c",
    supplier_name: supplier,
    project_name: "אלפא",
    category_name: "מלט",
    ...extra,
  };
}

const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });

function queue(qc: QueryClient, rows: ReviewRow[], previewWrite?: Parameters<typeof ReviewQueue>[0]["previewWrite"]) {
  return (
    <QueryClientProvider client={qc}>
      <ToastProvider>
        <MemoryRouter>
          <ReviewQueue rows={rows} search="" sample previewWrite={previewWrite} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  pinReviewLine(null);
  // An unmount with focus in the bar hands it over; the next test starts clean.
  takeReviewFocus();
});

describe("FLOW-309: the review card swap", () => {
  it("settles a card that comes back while it was leaving, with אישור enabled", () => {
    vi.useFakeTimers();
    const qc = client();
    const a = row("a", "ספק א");
    const b = row("b", "ספק ב");
    const { rerender } = render(queue(qc, [a, b]));
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    // Closed elsewhere: the card starts to leave...
    rerender(queue(qc, [b]));
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    // ...and a refetch brings it back before the swap lands.
    act(() => { vi.advanceTimersByTime(80); });
    rerender(queue(qc, [a, b]));
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByRole("heading", { name: "ספק א" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    expect(document.querySelector(".ui-review-motion")).not.toHaveAttribute("data-motion", "out");
  });

  it("shows a change to the card on screen outside the swap key", () => {
    const qc = client();
    const { rerender } = render(queue(qc, [row("a", "ספק א")]));
    expect(screen.getByRole("heading", { name: "ספק א" })).toBeInTheDocument();
    rerender(queue(qc, [row("a", "ספק א בע״מ", { amount_net: -2_000n })]));
    expect(screen.getByRole("heading", { name: "ספק א בע״מ" })).toBeInTheDocument();
  });

  it("moves focus to the next card's אישור after a keyboard approve", async () => {
    const rows = [row("a", "ספק א"), row("b", "ספק ב")];
    const qc = client();
    let listed = rows;
    const write = {
      run: () => Promise.resolve(),
      onDone: (id: string) => {
        listed = listed.filter((item) => item.id !== id);
        rerender(queue(qc, listed, write));
      },
      onUndo: (id: string) => {
        const original = rows.find((item) => item.id === id);
        if (original == null || listed.some((item) => item.id === id)) return;
        listed = [original, ...listed];
        rerender(queue(qc, listed, write));
      },
    };
    const { rerender } = render(queue(qc, listed, write));
    const approve = screen.getByRole("button", { name: "אישור" });
    approve.focus();
    fireEvent.click(approve);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "ספק ב" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "אישור" }));
    });
    // ביטול on the toast: the undone card is back, and focus lands on its אישור, not on body.
    const undo = screen.getByRole("button", { name: "ביטול" });
    undo.focus();
    fireEvent.click(undo);
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "ספק א" })).toBeInTheDocument();
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "אישור" }));
    });
  });

  it("moves focus to the empty state's action when the last card leaves, and back on ביטול", async () => {
    const rows = [row("a", "ספק א")];
    const qc = client();
    let listed = rows;
    const write = {
      run: () => Promise.resolve(),
      onDone: (id: string) => {
        listed = listed.filter((item) => item.id !== id);
        rerender(queue(qc, listed, write));
      },
      onUndo: () => {
        listed = rows;
        rerender(queue(qc, listed, write));
      },
    };
    const { rerender } = render(queue(qc, listed, write));
    const approve = screen.getByRole("button", { name: "אישור" });
    approve.focus();
    fireEvent.click(approve);
    const home = await screen.findByRole("link", { name: "לדף הבית" });
    await waitFor(() => {
      expect(document.activeElement).toBe(home);
    });
    const undo = screen.getByRole("button", { name: "ביטול" });
    undo.focus();
    fireEvent.click(undo);
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "אישור" }));
    });
  });

  it("leaves focus alone when the bar never had it (a touch tap on iPhone)", async () => {
    const qc = client();
    let listed = [row("a", "ספק א"), row("b", "ספק ב")];
    const write = {
      run: () => Promise.resolve(),
      onDone: (id: string) => {
        listed = listed.filter((item) => item.id !== id);
        rerender(queue(qc, listed, write));
      },
      onUndo: () => undefined,
    };
    const { rerender } = render(queue(qc, listed, write));
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "ספק ב" })).toBeInTheDocument();
    });
    await act(async () => { await new Promise((resolve) => { window.setTimeout(resolve, 50); }); });
    // The header's title took focus on mount (no ring); nothing moved it to the bar.
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "לאישור" }));
  });
});
