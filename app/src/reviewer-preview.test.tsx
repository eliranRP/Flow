import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ReviewQueue, type ReviewPreviewWrite } from "./screens/flow-screens";
import { reviewerQueue } from "./reviewer-sample";
import { ToastProvider } from "./ui/toast";

const paint = reviewerQueue[2];
if (!paint) throw new Error("missing sample row");

function previewWrite(mode: "ok" | "fail" | "offline"): ReviewPreviewWrite {
  return {
    run: () => {
      if (mode === "fail") return Promise.reject(new Error("category kind must match the direction"));
      if (mode === "offline") return Promise.reject(new Error("Failed to fetch"));
      return Promise.resolve();
    },
    onDone: () => undefined,
    onUndo: () => undefined,
  };
}

function renderQueue(row: ReviewRow, mode: "ok" | "fail" | "offline") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={["/reviewer/review"]}>
          <Routes>
            <Route
              path="/reviewer/review"
              element={<ReviewQueue rows={[row]} search="" sample previewWrite={previewWrite(mode)} />}
            />
            <Route path="/transactions/:transactionId/split" element={<p>חלוקה לדוגמה</p>} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("reviewer sample saves", () => {
  it("approves a ready row without a retry", async () => {
    renderQueue(paint, "ok");
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByText("הפריט אושר")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ביטול" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("refuses a save with no retry", async () => {
    renderQueue(paint, "fail");
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(screen.getByText("לא נשמר. בדקו את הפרטים ונסו שוב.")).toBeInTheDocument();
    });
    expect(screen.queryByText("לא נשמר – אין חיבור")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("offers a retry when the sample connection drops", async () => {
    renderQueue(paint, "offline");
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByRole("button", { name: "ניסיון חוזר" })).toBeInTheDocument();
    expect(screen.getByText("לא נשמר – אין חיבור")).toBeInTheDocument();
  });

  it("keeps אישור off when the category is missing", () => {
    const bolts = reviewerQueue[1];
    if (!bolts) throw new Error("missing sample row");
    renderQueue(bolts, "ok");
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeDisabled();
    expect(getComputedStyle(approve).cursor).toBe("not-allowed");
    expect(screen.getByText("חסר קטגוריה, הקישו לבחירה")).toBeInTheDocument();
  });

  it("opens the sample split for a shared cost", async () => {
    const shared = reviewerQueue[0];
    if (!shared) throw new Error("missing sample row");
    renderQueue(shared, "ok");
    expect(screen.getByText(/הוצאה משותפת/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByText("חלוקה לדוגמה")).toBeInTheDocument();
  });
});
