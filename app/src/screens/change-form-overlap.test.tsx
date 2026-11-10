import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { ChangeForm } from "./flow-screens";
import { reviewPage } from "./review-page-test-support";

// FLOW-1165: the sheet's writes run one after another in one scope (decision 0221). Each write and
// each ביטול carries its own pick and its own undo id, so a pick queued behind another never reads it.

type Reply = { data: unknown; error: { message: string } | null };

const state = vi.hoisted((): {
  row: Record<string, unknown>;
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  /** Answers held back, by RPC name: the first call of that name waits for the test. */
  hold: Set<string>;
  release: Array<() => void>;
  /** The undo ids collapse_split and reassign_transaction return, one per call. */
  undoIds: string[];
} => ({ row: {}, calls: [], hold: new Set(), release: [], undoIds: [] }));

vi.mock("./jev-review-card", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./jev-review-card")>();
  return { ...actual, useJevReview: () => ({ connectorOn: false, prefill: null, loading: false }) };
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
  active_projects: 2,
  review_count: 1,
  projects: [
    { id: "p1", name: "הרצל", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 },
    { id: "p2", name: "וילה", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 },
  ],
};

function answer(name: string): Reply {
  if (name === "list_review_page") return { data: reviewPage([state.row]), error: null };
  if (name === "get_dashboard") return { data: dashboard, error: null };
  if (name === "list_categories") {
    return {
      data: [
        { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
        { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
      ],
      error: null,
    };
  }
  if (name === "collapse_split" || name === "reassign_transaction") return { data: state.undoIds.shift() ?? null, error: null };
  return { data: null, error: null };
}

const supabase = {
  rpc: (name: string, args: Record<string, unknown>) => {
    state.calls.push({ name, args });
    const reply = answer(name);
    if (!state.hold.has(name)) return Promise.resolve(reply);
    state.hold.delete(name);
    return new Promise<Reply>((resolve) => { state.release.push(() => { resolve(reply); }); });
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
    reason: "auto_suggested",
    project_id: "p1",
    category_id: "c1",
    project_name: "הרצל",
    category_name: "חומרים",
    project_suggested: true,
    category_suggested: true,
    supplier_name: "מחסן הנמל",
    doc_kind: "invoice",
    ...extra,
  };
}

function renderSheet(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/review/change" element={<ChangeForm />} />
      <Route path="/review" element={<h1>תור</h1>} />
    </Routes>,
    { route },
  );
}

function argsOf(name: string) {
  return state.calls.filter((call) => call.name === name).map((call) => call.args);
}

async function pick(field: "פרויקט" | "קטגוריה", option: RegExp) {
  const opener = screen.queryByRole("button", { name: new RegExp(`^${field}:`), hidden: true });
  if (opener) fireEvent.click(opener);
  fireEvent.click(await screen.findByRole("radio", { name: option, hidden: true }));
}

async function releaseAll() {
  while (state.release.length > 0) {
    await act(async () => {
      state.release.shift()?.();
      await Promise.resolve();
    });
  }
}

afterEach(() => {
  state.calls = [];
  state.hold.clear();
  state.release = [];
  state.undoIds = [];
});

describe("the change sheet: each queued pick writes its own values (FLOW-1165)", () => {
  it("a shared cost's category: three picks write three categories, in order", async () => {
    state.row = row({ pnl_role: "shared", share_count: 2, project_id: null, project_name: null });
    state.hold.add("set_transaction_category");
    renderSheet("/review/change?item=r1&pick=category");
    await pick("קטגוריה", /הובלה/);
    await waitFor(() => { expect(argsOf("set_transaction_category")).toHaveLength(1); });
    await pick("קטגוריה", /חומרים/);
    await pick("קטגוריה", /הובלה/);
    await releaseAll();
    await waitFor(() => { expect(argsOf("set_transaction_category")).toHaveLength(3); });
    expect(argsOf("set_transaction_category").map((args) => args.p_category_id)).toEqual(["c2", "c1", "c2"]);
  });

  it("ביטול on a shared cost's first pick undoes that pick, though a second is still running", async () => {
    state.row = row({ pnl_role: "shared", share_count: 2, project_id: null, project_name: null });
    state.undoIds = ["undo-1", "undo-2"];
    renderSheet("/review/change?item=r1");
    await screen.findByRole("button", { name: /^פרויקט:/, hidden: true });
    await pick("פרויקט", /וילה/);
    const undo = await screen.findByRole("button", { name: "ביטול", hidden: true });
    await screen.findByRole("button", { name: /^פרויקט: וילה/, hidden: true });
    state.hold.add("collapse_split");
    await pick("פרויקט", /הרצל/);
    await waitFor(() => { expect(argsOf("collapse_split")).toHaveLength(2); });
    fireEvent.click(undo);
    await releaseAll();
    await waitFor(() => { expect(argsOf("undo_reassign")).toHaveLength(1); });
    expect(argsOf("undo_reassign")[0]).toEqual({ p_id: "undo-1" });
  });

  it("ביטול on a reassign undoes that reassign, though the next one is still running", async () => {
    state.row = row();
    state.undoIds = ["undo-1", "undo-2"];
    renderSheet("/review/change?item=r1");
    await screen.findByRole("button", { name: /^פרויקט:/, hidden: true });
    // The first pick resolves the item; the next ones reassign the closed line.
    await pick("פרויקט", /וילה/);
    await waitFor(() => { expect(argsOf("resolve_review")).toHaveLength(1); });
    await screen.findByRole("button", { name: /^קטגוריה:/, hidden: true });
    await pick("קטגוריה", /הובלה/);
    await waitFor(() => { expect(argsOf("reassign_transaction")).toHaveLength(1); });
    const undo = await screen.findByRole("button", { name: "ביטול", hidden: true });
    expect(screen.getByText(/^השיוך נשמר · וילה · הובלה/)).toBeInTheDocument();
    await screen.findByRole("button", { name: /^פרויקט:/, hidden: true });
    state.hold.add("reassign_transaction");
    await pick("פרויקט", /הרצל/);
    await waitFor(() => { expect(argsOf("reassign_transaction")).toHaveLength(2); });
    fireEvent.click(undo);
    await releaseAll();
    await waitFor(() => { expect(argsOf("undo_reassign")).toHaveLength(1); });
    expect(argsOf("undo_reassign")[0]).toEqual({ p_id: "undo-1" });
  });
});
