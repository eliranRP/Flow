import type { ReviewRow } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToastProvider } from "../ui/toast";
import { lineMetaQueryKey } from "../use-books";
import { ReviewAllList } from "./flow-screens";

/** FLOW-305: the statement rows read FLOW-304 bank details once per list page. Invented data. */

const db = vi.hoisted(() => ({
  meta: [] as unknown,
  metaError: false,
  calls: [] as Array<{ name: string; args: unknown }>,
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      db.calls.push({ name, args });
      if (name === "get_line_meta") {
        return Promise.resolve(db.metaError ? { data: null, error: { message: "meta down" } } : { data: db.meta, error: null });
      }
      return Promise.resolve({ data: [], error: null });
    },
  }),
}));

vi.mock("../wait-for-session", () => ({ waitForAccessToken: () => Promise.resolve("x") }));

afterEach(() => {
  db.meta = [];
  db.metaError = false;
  db.calls = [];
});

const base: ReviewRow = {
  id: "r1",
  transaction_id: "t1",
  description: "Northwind Traders",
  doc_date: "2026-09-29",
  amount_net: -4_299n,
  currency: "USD",
  direction: "expense",
  reason: null,
  project_id: null,
  category_id: null,
  supplier_name: null,
  source: "mercury",
};

const rows: ReviewRow[] = [
  base,
  { ...base, id: "r2", transaction_id: "t2", description: "Fabrikam Supply Co" },
  { ...base, id: "r3", transaction_id: "t3", description: "Contoso Lumber" },
  { ...base, id: "r4", transaction_id: "t4", description: "לקוח לדוגמה", source: "sumit", doc_kind: "invoice" },
];

const metaRow = (transaction_id: string, method: string, card_last4: string | null = null) => ({
  transaction_id,
  method,
  card_last4,
  memo: null,
  account: null,
  counterparty: null,
  bank_description: null,
});

function wrap(node: ReactNode, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter>{node}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
  return client;
}

const methodOf = (name: RegExp) => screen.getByRole("link", { name }).querySelector(".ui-statement-method")?.textContent;

describe("review list bank details (FLOW-305)", () => {
  it("reads every bank line's meta in one call and shows card and ACH labels", async () => {
    db.meta = [metaRow("t1", "card", "4242"), metaRow("t2", "ach")];
    const client = wrap(<ReviewAllList rows={rows} search="" backTo="/review" />);
    await waitFor(() => { expect(methodOf(/Northwind Traders/)).toBe("••4242"); });
    expect(methodOf(/Fabrikam Supply Co/)).toBe("ACH");
    expect(methodOf(/Contoso Lumber/)).toBe("בנק");
    expect(methodOf(/לקוח לדוגמה/)).toBe("חשבונית");
    expect(screen.getByRole("link", { name: /Northwind Traders/ }).getAttribute("aria-label")).toContain("כרטיס שמסתיים ב־4242");
    const reads = db.calls.filter((call) => call.name === "get_line_meta");
    expect(reads).toEqual([{ name: "get_line_meta", args: { p_ids: ["t1", "t2", "t3"] } }]);
    // The card's per-line read reuses the page's answer.
    expect(client.getQueryData(lineMetaQueryKey("off", "t2"))).toMatchObject({ method: "ach" });
    expect(client.getQueryData(lineMetaQueryKey("off", "t3"))).toBeNull();
  });

  it("does not read ids already in the per-line cache", async () => {
    const client = new QueryClient();
    client.setQueryData(lineMetaQueryKey("off", "t1"), metaRow("t1", "wire"));
    db.meta = [metaRow("t2", "check")];
    wrap(<ReviewAllList rows={rows} search="" backTo="/review" />, client);
    await waitFor(() => { expect(methodOf(/Fabrikam Supply Co/)).toBe("צ׳ק"); });
    expect(methodOf(/Northwind Traders/)).toBe("העברה בנקאית");
    expect(db.calls.filter((call) => call.name === "get_line_meta").map((call) => call.args)).toEqual([{ p_ids: ["t2", "t3"] }]);
  });

  it("keeps בנק silently when the meta read fails", async () => {
    db.metaError = true;
    wrap(<ReviewAllList rows={rows} search="" backTo="/review" />, new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } }));
    await waitFor(() => { expect(db.calls.filter((call) => call.name === "get_line_meta").length).toBeGreaterThan(0); });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(methodOf(/Northwind Traders/)).toBe("בנק");
    expect(methodOf(/Fabrikam Supply Co/)).toBe("בנק");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("makes no read when the page has no bank lines", async () => {
    wrap(<ReviewAllList rows={rows.slice(3)} search="" backTo="/review" />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(db.calls.some((call) => call.name === "get_line_meta")).toBe(false);
  });
});
