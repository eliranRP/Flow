import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import type { ReviewRow } from "@flow/shared";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { ReviewAllList } from "./flow-screens";
import { bindJevConnectorScope, jevConnectorStorageKey, type JevConnectorScope } from "./jev-review";

const scope: JevConnectorScope = { userId: "user-1", companyId: "company-1" };

const db = vi.hoisted(() => ({
  integration: null as { enabled: boolean; mode: string } | null,
  suggestions: [] as Array<{ id: string; transaction_id: string; answers: unknown }>,
}));

function table(data: unknown) {
  const result = { data, error: null };
  const builder = {
    select: () => builder,
    eq: () => builder,
    in: () => builder,
    order: () => builder,
    limit: () => builder,
    abortSignal: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (onFulfilled: (value: typeof result) => unknown, onRejected?: (reason: unknown) => unknown) =>
      Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return builder;
}

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    from: (name: string) => {
      if (name === "company_integrations") return table(db.integration);
      if (name === "tag_suggestions") return table(db.suggestions);
      if (name === "projects") return table([{ id: "p1", name: "וילה רעננה", status: "active" }]);
      if (name === "jev_prefills") return table([]);
      return table([{ id: "c1", name: "חומרים", hidden: false }]);
    },
    rpc: () => Promise.resolve({ data: [], error: null }),
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

const ruled: ReviewRow = {
  ...open,
  id: "r2",
  transaction_id: "t2",
  supplier_name: "בטון הצפון",
  project_id: "p9",
  project_name: "מחסן הנמל",
  project_suggested: true,
  category_id: "c9",
  category_name: "בטון",
  category_suggested: true,
};

function renderList(rows: ReviewRow[]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>
          <ReviewAllList rows={rows} search="" backTo="/review" skipped={false} />
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

describe("Review list rows on a Jev fill (FLOW-704)", () => {
  beforeEach(() => {
    db.integration = null;
    db.suggestions = [];
    bindJevConnectorScope(scope);
    localStorage.removeItem(jevConnectorStorageKey(scope));
  });

  it("shows Jev's values as \"✦ Jev · …\" and names them הצעת Jev; a rule suggestion keeps ✦ and הצעה", async () => {
    db.integration = { enabled: true, mode: "shadow" };
    db.suggestions = [{
      id: "s1",
      transaction_id: "t1",
      answers: { project: { choice: "p1", confidence: 0.91 }, category: { choice: "c1", confidence: 0.88 } },
    }];
    renderList([open, ruled]);
    const jevRow = await screen.findByRole("link", { name: /הצעת Jev: וילה רעננה · חומרים/ }, { timeout: 3000 });
    expect(jevRow.querySelector(".ui-statement-suggest")?.textContent).toBe("✦ Jev · וילה רעננה · חומרים");
    const ruleRow = screen.getByRole("link", { name: /הצעה: מחסן הנמל · בטון/ });
    expect(ruleRow.querySelector(".ui-statement-suggest")?.textContent).toBe("✦ מחסן הנמל · בטון");
  });

  it("leaves the rows as stored when Jev is off", async () => {
    db.integration = { enabled: false, mode: "off" };
    renderList([ruled]);
    expect(await screen.findByRole("link", { name: /הצעה: מחסן הנמל · בטון/ })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /הצעת Jev/ })).not.toBeInTheDocument();
  });
});
