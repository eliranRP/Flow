import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinReviewLine } from "../review-pin";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { takeReviewFocus } from "./review-focus";
import { ReviewQueue } from "./flow-screens";

// FLOW-1166 part 2c: a closed_month_change card. אישור is its one action and calls leave_held_change once;
// a failure shows the queue's usual approve toast and the card stays.

type Reply = { data: unknown; error: { message: string } | null };

const state = vi.hoisted((): {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  hold: Set<string>;
  release: Array<() => void>;
  fail: Set<string>;
} => ({ calls: [], hold: new Set(), release: [], fail: new Set() }));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      const reply: Reply = state.fail.has(name) ? { data: null, error: { message: "refused" } } : { data: null, error: null };
      if (!state.hold.has(name)) return Promise.resolve(reply);
      state.hold.delete(name);
      return new Promise<Reply>((resolve) => { state.release.push(() => { resolve(reply); }); });
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  }),
}));

const held: ReviewRow = {
  id: "r-held",
  transaction_id: "t-held",
  description: "Example Supply Co",
  doc_date: "2026-03-14",
  amount_net: -120_000n,
  currency: "USD",
  direction: "expense",
  source: "mercury",
  reason: "closed_month_change",
  project_id: null,
  category_id: null,
  supplier_name: "Example Supply Co",
  line_status: "posted",
  held: { kind: "update", amount_minor: 135_050, currency: "USD", doc_date: "2026-03-14", cash_date: "2026-03-14", line_status: "posted", provider: "mercury" },
};

function argsOf(name: string) {
  return state.calls.filter((call) => call.name === name).map((call) => call.args);
}

beforeEach(() => {
  vi.spyOn(window, "matchMedia").mockImplementation((query: string) => ({
    matches: query.includes("prefers-reduced-motion"),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  }) as unknown as MediaQueryList);
});

afterEach(() => {
  vi.restoreAllMocks();
  state.calls = [];
  state.hold.clear();
  state.release = [];
  state.fail.clear();
  pinReviewLine(null);
  takeReviewFocus();
});

describe("the closed_month_change card (FLOW-1166)", () => {
  it("says what waits and how to take it, with אישור as its only action", () => {
    renderWithProviders(<ReviewQueue rows={[held]} search="" />, { route: "/review" });
    expect(screen.getByText("שינוי מהבנק ממתין: התקופה סגורה בספרים.")).toBeInTheDocument();
    expect(screen.getByText("$1,350.50")).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toHaveAccessibleDescription("כדי לקבל את השינוי, הזיזו אחורה את תאריך הסגירה. הרענון הבא יכניס אותו. אישור משאיר את השורה כמו שהיא.");
    expect(screen.queryByRole("link", { name: "שינוי" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "דלג" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^פרויקט:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^קטגוריה:/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /פיצול/ })).not.toBeInTheDocument();
  });

  it("calls leave_held_change once on a double tap, then says the line stays as it is", async () => {
    state.hold.add("leave_held_change");
    renderWithProviders(<ReviewQueue rows={[held]} search="" />, { route: "/review" });
    const approve = screen.getByRole("button", { name: "אישור" });
    fireEvent.click(approve);
    fireEvent.click(approve);
    await waitFor(() => { expect(argsOf("leave_held_change")).toHaveLength(1); });
    expect(argsOf("leave_held_change")[0]).toEqual({ p_review_id: "r-held" });
    await act(async () => {
      state.release.shift()?.();
      await Promise.resolve();
    });
    expect(await screen.findByText("השורה נשארת כמו שהיא.")).toBeInTheDocument();
    expect(screen.queryByText("הפריט אושר")).not.toBeInTheDocument();
    expect(argsOf("leave_held_change")).toHaveLength(1);
    expect(argsOf("approve_review_item")).toHaveLength(0);
    expect(argsOf("resolve_review")).toHaveLength(0);
  });

  it("shows the queue's approve failure and keeps the card", async () => {
    state.fail.add("leave_held_change");
    renderWithProviders(<ReviewQueue rows={[held]} search="" />, { route: "/review" });
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByText("לא הצלחנו לאשר.")).toBeInTheDocument();
    expect(screen.queryByText("השורה נשארת כמו שהיא.")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Example Supply Co" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    expect(argsOf("leave_held_change")).toHaveLength(1);
  });

  it("is read-only for a viewer", () => {
    renderWithProviders(
      <ViewerPreview>
        <ReviewQueue rows={[held]} search="" sample />
      </ViewerPreview>,
      { route: "/review" },
    );
    expect(screen.getByText("שינוי מהבנק ממתין: התקופה סגורה בספרים.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "אישור" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^פרויקט:/ })).not.toBeInTheDocument();
  });

  it("shows the reason and the hint, with no detail line, when held is missing", () => {
    renderWithProviders(<ReviewQueue rows={[{ ...held, held: undefined }]} search="" />, { route: "/review" });
    expect(screen.getByText("שינוי מהבנק ממתין: התקופה סגורה בספרים.")).toBeInTheDocument();
    expect(screen.getByText("כדי לקבל את השינוי, הזיזו אחורה את תאריך הסגירה. הרענון הבא יכניס אותו. אישור משאיר את השורה כמו שהיא.")).toBeInTheDocument();
    expect(document.querySelector(".ui-review-held-details")).toBeNull();
  });
});
