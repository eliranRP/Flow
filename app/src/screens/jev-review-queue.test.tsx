import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ReviewQueue } from "./flow-screens";

const db = vi.hoisted(() => ({
  integration: null as { enabled: boolean; mode: string } | null,
  suggestion: null as { id: string; transaction_id: string; answers: unknown } | null,
  writes: [] as Array<{ name: string; args?: Record<string, unknown> }>,
}));

function table(data: unknown) {
  const result = { data, error: null };
  const builder = {
    select: () => builder,
    eq: () => builder,
    order: () => builder,
    limit: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (name: string) => {
      if (name === "company_integrations") return table(db.integration);
      if (name === "tag_suggestions") return table(db.suggestion);
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
};

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
    db.suggestion = null;
    db.writes = [];
  });

  it("approves the prefilled project and category in one tap", async () => {
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestion = {
      id: "s1",
      transaction_id: "t1",
      answers: {
        project: { choice: "p1", confidence: 0.91 },
        category: { choice: "c1", confidence: 0.88 },
      },
    };
    renderQueue();
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
  });

  it("does not prefill when the connector is off", async () => {
    db.integration = { enabled: true, mode: "off" };
    db.suggestion = {
      id: "s1",
      transaction_id: "t1",
      answers: {
        project: { choice: "p1", confidence: 0.91 },
        category: { choice: "c1", confidence: 0.88 },
      },
    };
    renderQueue();
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "אישור" })).toBeDisabled();
    });
    expect(screen.queryByText("הצעה")).not.toBeInTheDocument();
    expect(screen.getByText("אין הצעה, הקישו לבחירה")).toBeInTheDocument();
    expect(db.writes).toEqual([]);
  });
});
