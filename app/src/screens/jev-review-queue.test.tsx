import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ReviewQueue } from "./flow-screens";
import { bindJevConnectorScope, jevConnectorStorageKey, jevQueueQueryKey, type JevConnectorScope } from "./jev-review";

const scope: JevConnectorScope = { userId: "user-1", companyId: "company-1" };

const db = vi.hoisted(() => ({
  integration: null as { enabled: boolean; mode: string } | null,
  suggestions: [] as Array<{ id: string; transaction_id: string; answers: unknown }>,
  holdIntegration: null as Promise<void> | null,
  holdSuggestions: null as Promise<void> | null,
  failSuggestions: false,
  integrationError: false,
  seenIds: [] as string[][],
  integrationReads: 0,
  writes: [] as Array<{ name: string; args?: Record<string, unknown> }>,
  rows: [] as ReviewRow[],
  closed: new Set<string>(),
}));

function table(data: unknown, options?: { hold?: "integration" | "suggestions"; fail?: boolean }) {
  const failed = options?.hold === "integration" ? db.integrationError : Boolean(options?.fail && db.failSuggestions);
  const result = {
    data: failed ? null : data,
    error: failed ? { message: "jev down" } : null,
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
      // The queue reads the category kinds for the החזר mark. A read, not a write.
      if (name === "list_categories") return Promise.resolve({ data: [], error: null });
      // FLOW-304. The card's bank details are a read too.
      if (name === "get_line_meta") return Promise.resolve({ data: [], error: null });
      db.writes.push({ name, args });
      if (name === "approve_review_item" && args?.p_check_shown === true) {
        const id = typeof args.p_id === "string" ? args.p_id : "";
        const row = db.rows.find((item) => item.id === id);
        if (!row) return Promise.resolve({ data: { ok: false, error: { code: "not_found" } }, error: null });
        if (db.closed.has(id)) return Promise.resolve({ data: { ok: false, error: { code: "already_closed" } }, error: null });
        const shownProject = args.p_shown_project_id ?? null;
        const shownCategory = args.p_shown_category_id ?? null;
        if ((row.project_id ?? null) !== shownProject || (row.category_id ?? null) !== shownCategory) {
          return Promise.resolve({ data: { ok: false, error: { code: "stale" } }, error: null });
        }
        db.closed.add(id);
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

function renderQueue(rows: ReviewRow[] = [open], prepare?: (client: QueryClient) => void) {
  db.rows = rows;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  prepare?.(client);
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
    db.integrationError = false;
    db.seenIds = [];
    db.integrationReads = 0;
    db.writes = [];
    db.rows = [];
    db.closed = new Set();
    bindJevConnectorScope(scope);
    localStorage.removeItem("flow.jev-connector");
    localStorage.removeItem(jevConnectorStorageKey(scope));
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
    expect(await screen.findByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעת Jev" })).toBeInTheDocument();
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
    expect(await screen.findByRole("button", { name: "קטגוריה: חומרים, הצעת Jev" })).toBeInTheDocument();
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

  it("marks only the Jev field הצעת Jev and leaves a supplier rule unmarked", async () => {
    const row: ReviewRow = { ...stored, project_id: null, project_name: null };
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: {
        project: { choice: "p1", confidence: 0.91 },
        category: { choice: "c1", confidence: 0.88 },
      },
    }];
    renderQueue([row]);
    expect(await screen.findByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: קטגוריה שמורה" })).toBeInTheDocument();
    expect(screen.getAllByText("הצעת Jev")).toHaveLength(1);
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
  });

  it("keeps הצעה on a stored suggestion Jev did not answer", async () => {
    const row: ReviewRow = { ...stored, project_suggested: true, category_suggested: true };
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: { category: { choice: "c1", confidence: 0.88 } },
    }];
    renderQueue([row]);
    expect(await screen.findByRole("button", { name: "קטגוריה: חומרים, הצעת Jev" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור, הצעה" })).toBeInTheDocument();
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
      expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "בחירת פרויקט" })).toBeEnabled();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.queryByText("הצעת Jev")).not.toBeInTheDocument();
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
    expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    expect(document.querySelector(".ui-review-note")).toBeNull();
    expect(document.querySelector(".ui-review-note-slot")).toBeNull();
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeDisabled();
    expect(fieldBox().rows).toBe(2);
    approve.removeAttribute("disabled");
    fireEvent.click(approve);
    expect(db.writes).toEqual([]);
    release();
    expect(await screen.findByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעת Jev" })).toBeInTheDocument();
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

  it("offers בחירת פרויקט when a slow read settles with no suggestion", async () => {
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
    expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    expect(document.querySelector(".ui-review-note")).toBeNull();
    expect(document.querySelector(".ui-review-note-slot")).toBeNull();
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    const pendingRows = fieldBox().rows;
    release();
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).toBeNull();
    });
    expect(fieldBox().rows).toBe(pendingRows);
    expect(document.querySelector(".ui-review-note")).toBeNull();
    expect(document.querySelector(".ui-review-note-slot")).toBeNull();
    expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "בחירת פרויקט" })).toBeEnabled();
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

  it("keeps אישור disabled while a complete stored guess is still loading, then sends the Jev ids", async () => {
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
    const guess: ReviewRow = {
      ...open,
      project_id: "p-old",
      project_name: "פרויקט ישן",
      project_suggested: true,
      category_id: "c-old",
      category_name: "קטגוריה ישנה",
      category_suggested: true,
    };
    renderQueue([guess]);
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    });
    expect(document.querySelector(".ui-review-note")).toBeNull();
    expect(document.querySelector(".ui-review-note-slot")).toBeNull();
    const approve = screen.getByRole("button", { name: "אישור" });
    expect(approve).toBeDisabled();
    approve.removeAttribute("disabled");
    fireEvent.click(approve);
    expect(db.writes).toEqual([]);
    release();
    expect(await screen.findByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).toBeInTheDocument();
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
      p_shown_project_id: "p-old",
      p_shown_category_id: "c-old",
    });
    expect(await screen.findByText("הפריט אושר")).toBeInTheDocument();
  });

  it("sends one approve when אישור is clicked three times", async () => {
    db.integration = { enabled: true, mode: "off" };
    renderQueue([stored]);
    const approve = await screen.findByRole("button", { name: "אישור" });
    expect(approve).toBeEnabled();
    fireEvent.click(approve);
    fireEvent.click(approve);
    fireEvent.click(approve);
    await waitFor(() => {
      expect(db.writes.filter((call) => call.name === "approve_review_item")).toHaveLength(1);
    });
    expect(await screen.findByText("הפריט אושר")).toBeInTheDocument();
  });

  it("treats a second approve of the same row as already closed", async () => {
    db.integration = { enabled: true, mode: "off" };
    renderQueue([stored]);
    const approve = await screen.findByRole("button", { name: "אישור" });
    fireEvent.click(approve);
    expect(await screen.findByText("הפריט אושר")).toBeInTheDocument();
    fireEvent.click(approve);
    expect(await screen.findByText("הפריט כבר טופל.")).toBeInTheDocument();
  });

  it("refuses an approve whose id is no longer the stored row", async () => {
    db.integration = { enabled: true, mode: "off" };
    renderQueue([stored]);
    const approve = await screen.findByRole("button", { name: "אישור" });
    db.rows = [];
    fireEvent.click(approve);
    expect(await screen.findByText("לא הצלחנו לאשר.")).toBeInTheDocument();
    expect(screen.queryByText("הפריט אושר")).not.toBeInTheDocument();
  });

  it("waits on the first paint when the last launch left Jev on", async () => {
    bindJevConnectorScope(scope);
    localStorage.setItem(jevConnectorStorageKey(scope), "1");
    let release: () => void = () => undefined;
    db.holdIntegration = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.integration = { enabled: false, mode: "off" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: {
        project: { choice: "p1", confidence: 0.91 },
        category: { choice: "c1", confidence: 0.88 },
      },
    }];
    renderQueue([stored]);
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    });
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).not.toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    release();
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).toBeNull();
    });
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
  });

  it("does not render a suggestion that arrives before this session's connector read", async () => {
    bindJevConnectorScope(scope);
    localStorage.setItem(jevConnectorStorageKey(scope), "1");
    let release: () => void = () => undefined;
    db.holdIntegration = new Promise<void>((resolve) => {
      release = resolve;
    });
    db.integration = { enabled: false, mode: "off" };
    renderQueue([stored], (client) => {
      client.setQueryData(jevQueueQueryKey(["t1"]), {
        connectorOn: true,
        byId: {
          t1: {
            suggestionId: "s1",
            transactionId: "t1",
            project: { id: "p1", name: "וילה רעננה" },
            category: { id: "c1", name: "חומרים" },
          },
        },
      });
    });
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).not.toBeNull();
    });
    expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).not.toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "פרויקט: פרויקט שמור" })).toBeInTheDocument();
    release();
    await waitFor(() => {
      expect(document.querySelector("[data-jev-pending]")).toBeNull();
    });
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "אישור" })).toBeEnabled();
  });

  it("keeps the stored card when a remembered on meets a connector error", async () => {
    bindJevConnectorScope(scope);
    localStorage.setItem(jevConnectorStorageKey(scope), "1");
    db.integrationError = true;
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
      expect(document.querySelector("[data-jev-pending]")).toBeNull();
      expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "פרויקט: וילה רעננה, הצעת Jev" })).not.toBeInTheDocument();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "בחירת פרויקט" })).toBeEnabled();
  });

  it("fails a Jev read without a toast and leaves the stored row", async () => {
    db.failSuggestions = true;
    db.integration = { enabled: true, mode: "shadow" };
    renderQueue();
    await waitFor(() => {
      expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "בחירת פרויקט" })).toBeEnabled();
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(db.writes).toEqual([]);
  });
});

describe("review card pin (prod QA: אישור approved another line)", () => {
  beforeEach(() => {
    db.integration = null;
    db.suggestions = [];
    db.writes = [];
    db.closed = new Set();
    bindJevConnectorScope(scope);
  });

  const other: ReviewRow = {
    ...open,
    id: "r2",
    transaction_id: "t2",
    description: "קבלן משנה",
    supplier_name: "קבלן משנה בע״מ",
    doc_date: "2026-04-01",
  };

  function queue(rows: ReviewRow[], client: QueryClient) {
    db.rows = rows;
    return (
      <QueryClientProvider client={client}>
        <ToastProvider>
          <MemoryRouter>
            <ReviewQueue rows={rows} search="" />
          </MemoryRouter>
        </ToastProvider>
      </QueryClientProvider>
    );
  }

  it("keeps the card on screen when a refetch reorders the queue", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(queue([open, other], client));
    expect(await screen.findByText("חומרי בניין השרון בע״מ")).toBeInTheDocument();
    view.rerender(queue([other, open], client));
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(screen.getByText("חומרי בניין השרון בע״מ")).toBeInTheDocument();
    expect(screen.queryByText("קבלן משנה בע״מ")).not.toBeInTheDocument();
  });

  it("returns to the same card after the picker, whatever order the queue comes back in", async () => {
    const first = render(queue([open, other], new QueryClient({ defaultOptions: { queries: { retry: false } } })));
    expect(await screen.findByText("חומרי בניין השרון בע״מ")).toBeInTheDocument();
    first.unmount();
    render(queue([other, open], new QueryClient({ defaultOptions: { queries: { retry: false } } })));
    expect(await screen.findByText("חומרי בניין השרון בע״מ")).toBeInTheDocument();
  });

  it("skips the card on screen and ביטול reopens it", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(queue([open, other], client));
    expect(await screen.findByText("חומרי בניין השרון בע״מ")).toBeInTheDocument();
    view.rerender(queue([other, open], client));
    fireEvent.click(screen.getByRole("button", { name: "דלג" }));
    await waitFor(() => {
      expect(db.writes.find((call) => call.name === "resolve_review")?.args).toEqual({ p_id: "r1", p_action: "skipped" });
    });
    // The skipped card leaves; the next one takes the screen.
    view.rerender(queue([other], client));
    expect(await screen.findByText("קבלן משנה בע״מ")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => {
      expect(db.writes.find((call) => call.name === "reopen_review")?.args).toEqual({ p_id: "r1" });
    });
    expect(await screen.findByText("הפריט חזר לתור.")).toBeInTheDocument();
    // It comes back behind the card on screen in queue order, but ביטול puts it in front.
    view.rerender(queue([other, open], client));
    expect(await screen.findByText("חומרי בניין השרון בע״מ")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByText("קבלן משנה בע״מ")).not.toBeInTheDocument();
    });
  });

  it("moves on once the card leaves the queue", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = render(queue([open, other], client));
    expect(await screen.findByText("חומרי בניין השרון בע״מ")).toBeInTheDocument();
    view.rerender(queue([other], client));
    expect(await screen.findByText("קבלן משנה בע״מ")).toBeInTheDocument();
  });
});
