import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TransactionScreen } from "./flow-screens";
import { renderWithProviders } from "../test-render";

// FLOW-1165: the page's picks run one after another, each ביטול undoes the pick it was shown for, and
// the delete confirm waits for a write in flight.

type Reply = { data: unknown; error: { message: string } | null };

const state = vi.hoisted((): {
  calls: Array<{ name: string; args: Record<string, unknown> }>;
  txn: Record<string, unknown>;
  /** Answers held back, by RPC name: the next call of that name waits for the test. */
  hold: Set<string>;
  release: Array<() => void>;
  undoIds: string[];
  /** undo_reassign's refusal, when set. */
  undoError: string | null;
} => ({ calls: [], txn: {}, hold: new Set(), release: [], undoIds: [], undoError: null }));

function project(id: string, name: string) {
  return {
    id,
    name,
    status: "active" as const,
    state_label: "פעיל",
    budget_agorot: null,
    income_agorot: 0,
    direct_agorot: 0,
    shared_agorot: 0,
    profit_before_shared_agorot: 0,
    profit_agorot: 0,
  };
}

function answer(name: string): Reply {
  if (name === "get_transaction") {
    return {
      data: {
        id: "tx",
        description: "מלט",
        direction: "expense",
        doc_date: "2026-09-12",
        amount_gross: -1_180_000,
        amount_net: -1_000_000,
        vat_amount: -180_000,
        vat_status: "assumed",
        source: "manual",
        project_id: "p1",
        project_name: "חולון",
        category_id: "c1",
        category_name: "חומרים",
        supplier_name: "ספק",
        customer_name: null,
        review_status: "approved",
        paid: false,
        open_gross_agorot: null,
        ...state.txn,
      },
      error: null,
    };
  }
  if (name === "get_dashboard") {
    return {
      data: {
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
        review_count: 0,
        projects: [project("p1", "חולון"), project("p2", "וילה")],
      },
      error: null,
    };
  }
  if (name === "list_categories") {
    return {
      data: [
        { id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false },
        { id: "c2", name: "הובלה", kind: "expense", hidden: false, is_default: false },
      ],
      error: null,
    };
  }
  if (name === "reassign_transaction") return { data: state.undoIds.shift() ?? null, error: null };
  if (name === "undo_reassign" && state.undoError != null) return { data: null, error: { message: state.undoError } };
  return { data: null, error: null };
}

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown>) => {
      state.calls.push({ name, args });
      const reply = answer(name);
      if (!state.hold.has(name)) return Promise.resolve(reply);
      state.hold.delete(name);
      return new Promise<Reply>((resolve) => { state.release.push(() => { resolve(reply); }); });
    },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }) }),
  }),
}));

function mountTxn() {
  renderWithProviders(
    <Routes>
      <Route path="/transactions/:transactionId" element={<TransactionScreen />} />
    </Routes>,
    { route: "/transactions/tx" },
  );
}

function argsOf(name: string) {
  return state.calls.filter((call) => call.name === name).map((call) => call.args);
}

/** Opens a row's picker, taps an option and saves, then waits for the sheet to close. */
async function pick(row: RegExp, option: string) {
  fireEvent.click(await screen.findByRole("button", { name: row }));
  fireEvent.click(await screen.findByRole("radio", { name: option }));
  fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
  await waitFor(() => { expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
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
  state.txn = {};
  state.hold.clear();
  state.release = [];
  state.undoIds = [];
  state.undoError = null;
});

describe("the transaction page's picks (FLOW-1165)", () => {
  it("a second pick waits for the first write, so the server ends on the last pick", async () => {
    state.undoIds = ["undo-1", "undo-2"];
    state.hold.add("reassign_transaction");
    mountTxn();
    await pick(/חולון/, "וילה");
    await waitFor(() => { expect(argsOf("reassign_transaction")).toHaveLength(1); });
    await pick(/חומרים/, "הובלה");
    await act(async () => { await Promise.resolve(); });
    expect(argsOf("reassign_transaction")).toHaveLength(1);
    await releaseAll();
    await waitFor(() => { expect(argsOf("reassign_transaction")).toHaveLength(2); });
    expect(argsOf("reassign_transaction")).toEqual([
      { p_id: "tx", p_project_id: "p2", p_category_id: "c1" },
      { p_id: "tx", p_project_id: "p2", p_category_id: "c2" },
    ]);
  });

  it("ביטול on the first pick undoes that pick, though a second is still running", async () => {
    state.undoIds = ["undo-1", "undo-2"];
    mountTxn();
    await pick(/חולון/, "וילה");
    const undo = await screen.findByRole("button", { name: "ביטול" });
    state.hold.add("reassign_transaction");
    await pick(/חומרים/, "הובלה");
    await waitFor(() => { expect(argsOf("reassign_transaction")).toHaveLength(2); });
    fireEvent.click(undo);
    await releaseAll();
    await waitFor(() => { expect(argsOf("undo_reassign")).toHaveLength(1); });
    expect(argsOf("undo_reassign")[0]).toEqual({ p_id: "undo-1" });
  });

  it("ביטול of a filing the line has changed since says so, with no retry (FLOW-1166)", async () => {
    state.undoIds = ["undo-1"];
    state.undoError = "line changed since";
    mountTxn();
    await pick(/חולון/, "וילה");
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("השורה שונתה מאז. הביטול לא בוצע.")).toBeInTheDocument();
    expect(argsOf("undo_reassign")).toEqual([{ p_id: "undo-1" }]);
    expect(screen.queryByRole("button", { name: "ניסיון חוזר" })).not.toBeInTheDocument();
  });

  it("the delete confirm sends nothing while a pick's write is in flight", async () => {
    state.undoIds = ["undo-1"];
    state.hold.add("reassign_transaction");
    mountTxn();
    await pick(/חולון/, "וילה");
    await waitFor(() => { expect(argsOf("reassign_transaction")).toHaveLength(1); });
    fireEvent.click(screen.getByRole("button", { name: "עוד" }));
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    const confirm = await screen.findByRole("dialog", { name: "למחוק את הרשומה?" });
    const button = Array.from(confirm.querySelectorAll("button")).find((element) => element.textContent.includes("מחיקה"));
    if (button == null) throw new Error("no confirm button");
    fireEvent.click(button);
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 50)); });
    expect(argsOf("delete_transaction")).toHaveLength(0);
    await releaseAll();
    await waitFor(() => { expect(button).not.toHaveAttribute("aria-busy", "true"); });
    fireEvent.click(button);
    await waitFor(() => { expect(argsOf("delete_transaction")).toHaveLength(1); });
  });
});
