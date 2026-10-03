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
  hold: null as Promise<void> | null,
  failSuggestions: false,
  seenIds: [] as string[][],
  writes: [] as Array<{ name: string; args?: Record<string, unknown> }>,
}));

function table(data: unknown, options?: { gate?: boolean }) {
  const result = {
    data: options?.gate && db.failSuggestions ? null : data,
    error: options?.gate && db.failSuggestions ? { message: "jev down" } : null,
  };
  const ready = () => (options?.gate && db.hold != null ? db.hold.then(() => result) : Promise.resolve(result));
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
      if (name === "company_integrations") return table(db.integration);
      if (name === "tag_suggestions") return table(db.suggestions, { gate: true });
      if (name === "projects") return table([{ id: "p1", name: "וילה רעננה", status: "active" }]);
      return table([{ id: "c1", name: "חומרים", hidden: false }]);
    },
    rpc: (name: string, args?: Record<string, unknown>) => {
      db.writes.push({ name, args });
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

function renderQueue() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <ReviewQueue rows={[open]} search="" />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Jev review one tap", () => {
  beforeEach(() => {
    db.integration = null;
    db.suggestions = [];
    db.hold = null;
    db.failSuggestions = false;
    db.seenIds = [];
    db.writes = [];
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
      expect(db.writes.map((call) => call.name)).toContain("resolve_review");
    });
    expect(db.writes.find((call) => call.name === "resolve_review")?.args).toEqual({
      p_id: "r1",
      p_action: "approved",
      p_project_id: "p1",
      p_category_id: "c1",
      p_remember: false,
    });
    expect(db.writes.some((call) => call.name === "record_jev_correction")).toBe(false);
    expect(db.seenIds.some((ids) => ids.includes("t1") && ids.includes("t2"))).toBe(true);
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

  it("holds the card height and refuses אישור until a slow Jev read settles", async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise<void>((resolve) => {
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
    const approve = await screen.findByRole("button", { name: "אישור" });
    expect(approve).toBeDisabled();
    expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    expect(screen.queryByText("חסר קטגוריה, הקישו לבחירה")).not.toBeInTheDocument();
    const pending = fieldBox();
    expect(pending.rows).toBe(2);
    expect(pending.note).toBe("");
    approve.removeAttribute("disabled");
    fireEvent.click(approve);
    expect(db.writes).toEqual([]);
    release();
    expect(await screen.findByRole("button", { name: "פרויקט: וילה רעננה, הצעה" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "קטגוריה: חומרים, הצעה" })).toBeInTheDocument();
    const settled = fieldBox();
    expect(settled).toEqual(pending);
    expect(screen.queryByText("אין הצעה, הקישו לבחירה")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "אישור" }));
    await waitFor(() => {
      expect(db.writes.map((call) => call.name)).toContain("resolve_review");
    });
    expect(db.writes.find((call) => call.name === "resolve_review")?.args).toMatchObject({
      p_project_id: "p1",
      p_category_id: "c1",
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
