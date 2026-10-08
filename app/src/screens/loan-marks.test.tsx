import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { loanRowProps, partsLabel, useLoanMarks } from "./loan-marks";

const db = vi.hoisted(() => ({
  rows: [] as Array<{ transaction_id: string; needs_review: boolean }>,
  batches: [] as string[][],
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (table: string) => {
      if (table !== "loan_splits") throw new Error(table);
      return {
        select: () => ({
          in: (_column: string, ids: string[]) => {
            db.batches.push(ids);
            return Promise.resolve({ data: db.rows.filter((row) => ids.includes(row.transaction_id)), error: null });
          },
        }),
      };
    },
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useLoanMarks", () => {
  it("marks split lines, and a line with any part waiting for review as review", async () => {
    db.rows = [
      { transaction_id: "t1", needs_review: false },
      { transaction_id: "t1", needs_review: false },
      { transaction_id: "t1", needs_review: false },
      { transaction_id: "t2", needs_review: false },
      { transaction_id: "t2", needs_review: true },
      { transaction_id: "t2", needs_review: false },
    ];
    db.batches = [];
    const { result } = renderHook(() => useLoanMarks(["t3", "t1", "t2"]), { wrapper });
    await waitFor(() => { expect(result.current.size).toBe(2); });
    expect(result.current.get("t1")).toEqual({ parts: 3, review: false });
    expect(result.current.get("t2")).toEqual({ parts: 3, review: true });
    expect(result.current.get("t3")).toBeUndefined();
  });

  it("reads at most 100 ids per request and nothing when disabled", async () => {
    db.rows = [];
    db.batches = [];
    const ids = Array.from({ length: 150 }, (_, index) => `t${String(index).padStart(3, "0")}`);
    renderHook(() => useLoanMarks(ids), { wrapper });
    await waitFor(() => { expect(db.batches).toHaveLength(2); });
    expect(db.batches.map((batch) => batch.length)).toEqual([100, 50]);
    db.batches = [];
    renderHook(() => useLoanMarks(["x"], false), { wrapper });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(db.batches).toHaveLength(0);
  });
});

describe("loanRowProps", () => {
  it("leaves an ordinary row alone", () => {
    expect(loanRowProps(undefined, "05/09")).toEqual({ hint: "05/09" });
  });

  it("puts the part count before the hint on a split row", () => {
    render(<span>{loanRowProps({ parts: 2, review: false }, "05/09").hint}</span>);
    expect(screen.getByText("2 חלקים · 05/09")).toBeInTheDocument();
  });

  it("counts the parts as written", () => {
    expect(partsLabel(1)).toBe("חלק אחד");
    expect(partsLabel(4)).toBe("4 חלקים");
  });

  it("warns, with an icon, while a part waits for review", () => {
    const props = loanRowProps({ parts: 3, review: true }, "05/09");
    expect(props.tone).toBe("warning");
    expect(props.icon).toBeTruthy();
    render(<span>{props.hint}</span>);
    expect(screen.getByText("ממתין לבדיקה · 05/09")).toBeInTheDocument();
  });

  it("shows the words alone when there is no other hint", () => {
    expect(loanRowProps({ parts: 3, review: false }, "").hint).toBe("3 חלקים");
  });
});
