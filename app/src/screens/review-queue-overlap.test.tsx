import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pinReviewLine } from "../review-pin";
import { renderWithProviders } from "../test-render";
import { takeReviewFocus } from "./review-focus";
import { ReviewQueue } from "./flow-screens";

// FLOW-1165: דלג waits for an אישור in flight on the same card, and the project picked on the card is
// one save (saveFlow): a second pick, or אישור, waits for it.

type Reply = { data: unknown; error: { message: string } | null };

const state = vi.hoisted((): {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  hold: Set<string>;
  release: Array<() => void>;
} => ({ calls: [], hold: new Set(), release: [] }));

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
  active_projects: 2,
  review_count: 1,
  projects: [
    { id: "p1", name: "הרצל", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 },
    { id: "p2", name: "וילה", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 },
  ],
};

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      const reply: Reply = name === "get_dashboard"
        ? { data: dashboard, error: null }
        : name === "approve_review_item" ? { data: { ok: true }, error: null } : { data: null, error: null };
      if (!state.hold.has(name)) return Promise.resolve(reply);
      state.hold.delete(name);
      return new Promise<Reply>((resolve) => { state.release.push(() => { resolve(reply); }); });
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  }),
}));

function row(id: string, supplier: string): ReviewRow {
  return {
    id,
    transaction_id: `t-${id}`,
    description: supplier,
    doc_date: "2026-06-20",
    amount_net: -1_000n,
    direction: "expense",
    reason: null,
    project_id: "p1",
    category_id: "c1",
    supplier_name: supplier,
    project_name: "הרצל",
    category_name: "מלט",
  };
}

function argsOf(name: string) {
  return state.calls.filter((call) => call.name === name).map((call) => call.args);
}

async function releaseAll() {
  while (state.release.length > 0) {
    await act(async () => {
      state.release.shift()?.();
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  // The next card shows at once (review-swap.ts), so the tests read the order, not the swap.
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
  pinReviewLine(null);
  takeReviewFocus();
});

describe("the review card's skip and project pick (FLOW-1165)", () => {
  it("דלג does nothing while that card's אישור is in flight", async () => {
    let finish: () => void = () => undefined;
    const write = {
      run: () => new Promise<void>((resolve) => { finish = resolve; }),
      onDone: () => undefined,
      onUndo: () => undefined,
    };
    renderWithProviders(<ReviewQueue rows={[row("a", "ספק א"), row("b", "ספק ב")]} search="" sample previewWrite={write} />);
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 100)); });
    expect(screen.getByRole("heading", { name: "ספק א" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "ספק ב" })).not.toBeInTheDocument();
    await act(async () => {
      finish();
      await Promise.resolve();
    });
  });

  it("a project picked on the card is one save: אישור and the picker wait for it", async () => {
    state.hold.add("resolve_review");
    renderWithProviders(<ReviewQueue rows={[row("a", "ספק א")]} search="" openPicker />);
    fireEvent.click(await screen.findByRole("radio", { name: "וילה" }));
    await waitFor(() => { expect(argsOf("resolve_review")).toHaveLength(1); });
    // אישור now would approve the project the card still shows, not the one being saved.
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    // The picker stays closed too: a second pick now would be dropped without a word.
    fireEvent.click(await screen.findByRole("button", { name: /^פרויקט:/ }));
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByRole("radio", { name: "הרצל" })).not.toBeInTheDocument();
    expect(argsOf("approve_review_item")).toHaveLength(0);
    expect(argsOf("resolve_review")).toHaveLength(1);
    await releaseAll();
    expect(argsOf("resolve_review")[0]).toMatchObject({ p_id: "a", p_project_id: "p2", p_resolve: false });
    // Once the save is done the picker opens again, and a second pick is sent.
    fireEvent.click(await screen.findByRole("button", { name: /^פרויקט:/ }));
    fireEvent.click(await screen.findByRole("radio", { name: "הרצל" }));
    await waitFor(() => { expect(argsOf("resolve_review")).toHaveLength(2); });
  });
});
