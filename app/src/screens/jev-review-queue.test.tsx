import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ReviewQueue } from "./flow-screens";

const db = vi.hoisted(() => ({
  integration: null as { enabled: boolean; mode: string } | null,
  suggestions: [] as Array<{ id: string; transaction_id: string; answers: unknown }>,
  holdIntegration: null as Promise<void> | null,
  holdSuggestions: null as Promise<void> | null,
  failSuggestions: false,
  seenIds: [] as string[][],
  integrationReads: 0,
  writes: [] as Array<{ name: string; args?: Record<string, unknown> }>,
  rows: [] as ReviewRow[],
}));

function table(data: unknown, options?: { hold?: "integration" | "suggestions"; fail?: boolean }) {
  const result = {
    data: options?.fail && db.failSuggestions ? null : data,
    error: options?.fail && db.failSuggestions ? { message: "jev down" } : null,
  };
  const held = options?.hold === "integration"
    ? db.holdIntegration
    : options?.hold === "suggestions"
      ? db.holdSuggestions
      : null;
  const ready = () => {
    const finish = () => {
      if (options?.hold === "integration") db.integrationReads += 1;
      return result;
    };
    return held != null ? held.then(finish) : Promise.resolve().then(finish);
  };
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: (_column: string, values: string[]) => {
      db.seenIds.push(values);
      return builder;
    },
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => ready(),
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => ready().then(onFulfilled, onRejected),
  };
  return builder;
}

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (name: string) => {
      if (name === "company_integrations") return table(db.integration, { hold: "integration" });
      if (name === "tag_suggestions") return table(db.suggestions, { hold: "suggestions", fail: true });
      if (name === "projects") return table([{ id: "p1", name: "וילה רעננה", status: "active" }]);
      return table([{ id: "c1", name: "חומרים", hidden: false }]);
    },
    rpc: (name: string, args?: Record<string, unknown>) => {
      db.writes.push({ name, args });
      if (name === "approve_review_item" && args?.p_check_shown === true) {
        const row = db.rows.find((item) => item.id === args.p_id);
        const shownProject = args.p_shown_project_id ?? null;
        const shownCategory = args.p_shown_category_id ?? null;
        const storedProject = row?.project_id ?? null;
        const storedCategory = row?.category_id ?? null;
        if (storedProject !== shownProject || storedCategory !== shownCategory) {
          return Promise.resolve({ data: { ok: false, error: { code: "stale" } }, error: null });
        }
      }
      return Promise.resolve({ data: null, error: null });
    },
  }),
}));

const open: ReviewRow = {
  id: "r1",
  transaction_id: "t1",
  description: "חומרי בניין",
  doc_date: "2026-04-12",
  amount_net: -2_200_000n,
  direction: "expense",
  reason: null,
  project_id: null,
  category_id: null,
  supplier_name: "חומרי בניין השרון בע״מ",
  project_name: null,
  category_name: null,
  project_suggested: false,
  category_suggested: false,
};

function fieldBox() {
  const ai = document.querySelector(".ui-review-ai");
  return {
    rows: ai?.querySelectorAll(":scope > .ui-row").length ?? 0,
    note: ai?.querySelector(":scope > p")?.textContent ?? "",
  };
}

const stored: ReviewRow = {
  ...open,
  project_id: "p-stored",
  category_id: "c-stored",
  project_name: "פרויקט שמור",
  category_name: "קטגוריה שמורה",
};

function renderQueue(rows: ReviewRow[] = [open]) {
  db.rows = rows;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <ReviewQueue rows={rows} search="" />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Jev review one tap", () => {
  beforeEach(() => {
    db.integration = null;
    db.suggestions = [];
    db.holdIntegration = null;
    db.holdSuggestions = null;
    db.failSuggestions = false;
    db.seenIds = [];
    db.integrationReads = 0;
    db.writes = [];
    db.rows = [];
  });

  it("approves the prefilled project and category in one tap", async () => {
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: {
        project: { choice: "p1", confidence: 0.91 },
        category: { choice: "c1", confidence: 0.88 },
      },
    }];
    db.rows = [open, { ...open, id: "r2", transaction_id: "t2" }];
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ReviewQueue rows={[open, { ...open, id: "r2", transaction_id: "t2" }]} search="" />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("button", { name: "פרויקט: וילה רעננה, הצעה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(db.writes.map((call) => call.name)).toContain("approve_review_item");
    });
    expect(db.writes.find((call) => call.name === "approve_review_item")?.args).toEqual({
      p_id: "r1",
      p_project_id: "p1",
      p_category_id: "c1",
      p_remember: false,
      p_check_shown: true,
    });
    expect(db.writes.some((call) => call.name === "record_jev_correction")).toBe(false);
    expect(db.seenIds.some((ids) => ids.includes("t1") && ids.includes("t2"))).toBe(true);
  });

  it("approves a Jev-filled category with the stored shown ids", async () => {
    const row: ReviewRow = {
      ...stored,
      category_id: null,
      category_name: null,
    };
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: {
        category: { choice: "c1", confidence: 0.88 },
      },
    }];
    renderQueue([row]);
    expect(await screen.findByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    expect(await screen.findByText("הפריט אושר")).toBeInTheDocument();
    expect(screen.queryByText("השיוך עודכן. בדקו את הכרטיס.")).not.toBeInTheDocument();
    expect(db.writes.find((call) => call.name === "approve_review_item")?.args).toEqual({
      p_id: "r1",
      p_project_id: "p-stored",
      p_category_id: "c1",
      p_remember: false,
      p_check_shown: true,
      p_shown_project_id: "p-stored",
    });
  });

  it("does not prefill when the connector is off", async () => {
    db.integration = { enabled: true, mode: "off" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: {
        project: { choice: "p1", confidence: 0.91 },
        category: { choice: "c1", confidence: 0.88 },
      },
    }];
    renderQueue();
    await waitFor(() => {
      expect(screen.getByText("אין הצעה, הקישו לבחירה")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(db.writes).toEqual([]);
  });

  it("refuses אישור until a slow Jev read settles, and keeps the note while it waits", async () => {
    let release: () => void = () => undefined;
    db.holdSuggestions = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: {
        project: { choice: "p1", confidence: 0.91 },
        category: { choice: "c1", confidence: 0.88 },
      },
    }];
    renderQueue();
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    });
    expect(screen.getByText("אין הצעה, הקישו לבחירה")).toBeInTheDocument();
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeDisabled();
    expect(fieldBox().rows).toBe(2);
    approve.removeAttribute("disabled");
    fireEvent.click(approve);
    expect(db.writes).toEqual([]);
    release();
    expect(await screen.findByRole("button", { name: "פרויקט: וילה רעננה, הצעה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toBeInTheDocument();
    expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(db.writes.map((call) => call.name)).toContain("approve_review_item");
    });
    expect(db.writes.find((call) => call.name === "approve_review_item")?.args).toMatchObject({
      p_project_id: "p1",
      p_category_id: "c1",
    });
  });

  it("keeps the note row when a slow read settles with no suggestion", async () => {
    let release: () => void = () => undefined;
    db.holdSuggestions = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestions = [];
    renderQueue();
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    });
    expect(screen.getByText("אין הצעה, הקישו לבחירה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    const pending = fieldBox();
    release();
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).toBeNull();
    });
    expect(fieldBox()).toEqual(pending);
    expect(screen.getByText("אין הצעה, הקישו לבחירה")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
  });

  it("shows no pending state while a Jev-off read is still loading", async () => {
    let release: () => void = () => undefined;
    db.holdIntegration = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.integration = { enabled: true, mode: "off" };
    renderQueue([stored]);
    const approve = await screen.findByRole("button", { name: "אישור" });
    expect(approve).toBeEnabled();
    expect(document.querySelector("[data-jev-pending]")).toBeNull();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
    expect(db.seenIds).toEqual([]);
    release();
    await waitFor(() => {
      expect(db.integrationReads).toBeGreaterThan(0);
    });
    expect(db.seenIds).toEqual([]);
    expect(document.querySelector("[data-jev-pending]")).toBeNull();
    expect(approve).toBeEnabled();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
  });

  it("falls back to today's values within a second when the Jev read stalls", async () => {
    db.holdSuggestions = new Promise<void>(() => undefined);
    db.integration = { enabled: true, mode: "shadow" };
    renderQueue([stored]);
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    });
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    const marked = performance.now();
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).toBeNull();
    }, { timeout: 2500 });
    expect(performance.now() - marked).toBeLessThan(1500);
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeEnabled();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    fireEvent.click(approve);
    await waitFor(() => {
      expect(db.writes.map((call) => call.name)).toContain("approve_review_item");
    });
    expect(db.writes.find((call) => call.name === "approve_review_item")?.args).toMatchObject({
      p_project_id: "p-stored",
      p_category_id: "c-stored",
    });
  });

  it("fails a Jev read without a toast and leaves the stored row", async () => {
    db.failSuggestions = true;
    db.integration = { enabled: true, mode: "shadow" };
    renderQueue();
    await waitFor(() => {
      expect(screen.getByText("אין הצעה, הקישו לבחירה")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(db.writes).toEqual([]);
  });
});
