import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWithProviders } from "../test-render";
import { ViewerPreview } from "../use-is-viewer";
import { ChangeForm } from "./flow-screens";

// FLOW-325 §10 (option A): פיצול לפי קטגוריות on the change sheet's project list approves the
// line, then opens the parts editor.

type ApproveReply = Promise<{ data: unknown; error: { message: string } | null }>;

const state = vi.hoisted((): {
  row: Record<string, unknown>;
  approve: null | (() => ApproveReply);
  /** A resolve_review answer the test holds back (a pick on an open line). */
  resolve: null | (() => ApproveReply);
  calls: Array<{ name: string; args: unknown }>;
} => ({ row: {}, approve: null, resolve: null, calls: [] }));

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

const supabase = {
  rpc: (name: string, args: unknown) => {
    state.calls.push({ name, args });
    if (name === "list_review") return Promise.resolve({ data: [state.row], error: null });
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
    if (name === "list_categories") {
      return Promise.resolve({ data: [{ id: "c1", name: "חומרים", kind: "expense", hidden: false, is_default: false }], error: null });
    }
    if (name === "approve_review_item") return state.approve ? state.approve() : Promise.resolve({ data: { ok: true }, error: null });
    if (name === "resolve_review" && state.resolve) return state.resolve();
    return Promise.resolve({ data: null, error: null });
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

function renderSheet(wrap: (node: ReactNode) => ReactNode = (node) => node) {
  return renderWithProviders(
    wrap(
      <Routes>
        <Route path="/review/change" element={<ChangeForm />} />
        <Route path="/review" element={<h1>תור</h1>} />
        <Route path="/transactions/:transactionId/split-category" element={<h1>עורך הפיצול</h1>} />
      </Routes>,
    ),
    { route: "/review/change?item=r1&pick=project" },
  );
}

function approveCalls() {
  return state.calls.filter((call) => call.name === "approve_review_item");
}

afterEach(() => {
  state.approve = null;
  state.calls = [];
});

describe("פיצול לפי קטגוריות on the change sheet (FLOW-325 §10)", () => {
  it("approves with the values on the sheet, then opens the parts editor", async () => {
    state.row = row();
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: "פיצול לפי קטגוריות", hidden: true }));
    expect(await screen.findByRole("heading", { name: "עורך הפיצול" })).toBeInTheDocument();
    expect(approveCalls()).toHaveLength(1);
    expect(approveCalls()[0]?.args).toMatchObject({
      p_id: "r1",
      p_project_id: "p1",
      p_category_id: "c1",
      p_remember: false,
      p_check_shown: true,
      p_shown_project_id: "p1",
      p_shown_category_id: "c1",
    });
    expect(screen.getByText("הפריט אושר")).toBeInTheDocument();
  });

  it("stays on the sheet with לא הצלחנו לאשר. when the approve fails", async () => {
    state.row = row();
    state.approve = () => Promise.resolve({ data: null, error: { message: "permission denied" } });
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: "פיצול לפי קטגוריות", hidden: true }));
    expect(await screen.findByText("לא הצלחנו לאשר.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "עורך הפיצול" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פיצול לפי קטגוריות", hidden: true })).toBeInTheDocument();
  });

  it("says the line changed and stays when the stored values moved (stale)", async () => {
    state.row = row();
    state.approve = () => Promise.resolve({ data: { ok: false, error: { code: "stale" } }, error: null });
    renderSheet();
    fireEvent.click(await screen.findByRole("button", { name: "פיצול לפי קטגוריות", hidden: true }));
    expect(await screen.findByText("השיוך עודכן. בדקו את הכרטיס.")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "עורך הפיצול" })).not.toBeInTheDocument();
  });

  it("ignores presses while the approve is running", async () => {
    state.row = row();
    let release: () => void = () => undefined;
    state.approve = () => new Promise((resolve) => {
      release = () => { resolve({ data: { ok: true }, error: null }); };
    });
    renderSheet();
    const link = await screen.findByRole("button", { name: "פיצול לפי קטגוריות", hidden: true });
    fireEvent.click(link);
    await waitFor(() => {
      expect(link).toHaveAttribute("aria-busy", "true");
    });
    fireEvent.click(link);
    fireEvent.click(screen.getByRole("radio", { name: /וילה/, hidden: true }));
    expect(approveCalls()).toHaveLength(1);
    expect(state.calls.some((call) => call.name === "resolve_review")).toBe(false);
    release();
    expect(await screen.findByRole("heading", { name: "עורך הפיצול" })).toBeInTheDocument();
  });

  it("is not offered on a shared cost, a split_mismatch card, or a line missing its category", async () => {
    for (const extra of [
      { pnl_role: "shared", share_count: 2 },
      { reason: "split_mismatch" },
      { category_id: null, category_name: null },
    ]) {
      state.row = row(extra);
      const view = renderSheet();
      await screen.findByRole("dialog", { hidden: true });
      await screen.findByRole("button", { name: "פרויקט חדש", hidden: true });
      expect(screen.queryByRole("button", { name: "פיצול לפי קטגוריות", hidden: true })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it("is not offered to a viewer, who never gets the sheet", () => {
    state.row = row();
    renderSheet((node) => <ViewerPreview>{node}</ViewerPreview>);
    expect(screen.getByRole("heading", { name: "תור" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "פיצול לפי קטגוריות", hidden: true })).not.toBeInTheDocument();
    expect(approveCalls()).toHaveLength(0);
  });

  it("checks a project at once on an open line while resolve_review is pending, and puts it back when the write fails", async () => {
    state.row = row();
    state.calls = [];
    let answer: (result: { data: unknown; error: { message: string } | null }) => void = () => undefined;
    state.resolve = () => new Promise((resolve) => { answer = resolve; });
    renderSheet();
    fireEvent.click(await screen.findByRole("radio", { name: /וילה/, hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "שמירה", hidden: true }));
    // The picker closes and the summary shows the tapped project, with no busy row (decision 0180).
    expect(await screen.findByRole("button", { name: /וילה/, hidden: true })).toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: /וילה/, hidden: true })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(state.calls.some((call) => call.name === "resolve_review")).toBe(true);
    });
    await act(async () => {
      answer({ data: null, error: { message: "Failed to fetch" } });
      await Promise.resolve();
    });
    // The failed pick goes back to the project before it, and offers ניסיון חוזר.
    expect(await screen.findByRole("button", { name: "ניסיון חוזר", hidden: true })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /הרצל/, hidden: true })).toBeInTheDocument();
    state.resolve = null;
  });
});

function resolveCalls() {
  return state.calls.filter((call) => call.name === "resolve_review");
}

describe("the picker keeps the choice until שמירה (FLOW-831)", () => {
  afterEach(() => {
    state.resolve = null;
  });

  it("שמירה is disabled while the checked project is the saved one", async () => {
    state.row = row();
    renderSheet();
    expect(await screen.findByRole("button", { name: "שמירה", hidden: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("radio", { name: /וילה/, hidden: true }));
    expect(screen.getByRole("button", { name: "שמירה", hidden: true })).toBeEnabled();
  });

  it("a row tap writes nothing; שמירה sends one resolve_review and shows the project while it is pending", async () => {
    state.row = row();
    let answer: (result: { data: unknown; error: { message: string } | null }) => void = () => undefined;
    state.resolve = () => new Promise((resolve) => { answer = resolve; });
    renderSheet();
    fireEvent.click(await screen.findByRole("radio", { name: /וילה/, hidden: true }));
    expect(resolveCalls()).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "בחירת פרויקט", hidden: true })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שמירה", hidden: true }));
    expect(await screen.findByRole("button", { name: /וילה/, hidden: true })).toBeInTheDocument();
    await waitFor(() => {
      expect(resolveCalls()).toHaveLength(1);
    });
    expect(resolveCalls()[0]?.args).toMatchObject({ p_id: "r1", p_action: "changed", p_project_id: "p2" });
    await act(async () => {
      answer({ data: null, error: { message: "Failed to fetch" } });
      await Promise.resolve();
    });
    expect(await screen.findByRole("button", { name: "ניסיון חוזר", hidden: true })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /הרצל/, hidden: true })).toBeInTheDocument();
    expect(resolveCalls()).toHaveLength(1);
  });

  it("✕ without שמירה sends nothing", async () => {
    state.row = row();
    renderSheet();
    fireEvent.click(await screen.findByRole("radio", { name: /וילה/, hidden: true }));
    fireEvent.click(screen.getByRole("button", { name: "סגירה", hidden: true }));
    await waitFor(() => {
      expect(screen.queryByRole("heading", { name: "בחירת פרויקט", hidden: true })).not.toBeInTheDocument();
    });
    expect(resolveCalls()).toHaveLength(0);
  });
});
