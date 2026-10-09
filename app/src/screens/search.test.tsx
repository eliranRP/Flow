import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readTxnList } from "../txn-nav";
import { SearchEntry } from "../ui/search-entry";
import { BooksProvider } from "../use-books";
import { resetSearchMemory, SearchScreen, searchRowDetails } from "./search";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  impl: (_name: string, _args: Record<string, unknown>): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown> = {}) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
  }),
}));

const PROJECT = "4c3a2b1e-0000-4000-8000-000000000001";

// Invented lines only. Every column the RPC returns is present, nulls included.
function line(id: string, patch: Record<string, unknown> = {}) {
  return {
    id,
    description: "תנועה לדוגמה",
    doc_date: "2026-10-02",
    doc_kind: "invoice",
    amount_net: -12_400,
    vat_agorot: -2_232,
    direction: "expense",
    currency: "ILS",
    amount_original: 14_632,
    line_status: "posted",
    project_id: PROJECT,
    category_id: null,
    project_name: "שיפוץ לדוגמה",
    category_name: null,
    supplier_name: "חומרי בניין לדוגמה",
    customer_name: null,
    waiting_review: false,
    kept_out: false,
    split_parts: 0,
    loan_matched: false,
    ...patch,
  };
}

const dashboard = {
  company_id: "co",
  name: "חברה לדוגמה",
  vat_registered: true,
  basis: "invoiced",
  from: null,
  to: null,
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  overhead_agorot: 0,
  expense_agorot: 0,
  net_profit_agorot: 0,
  prev_income_agorot: null,
  prev_expense_agorot: null,
  prev_net_agorot: null,
  active_projects: 1,
  review_count: 0,
  projects: [{ id: PROJECT, name: "שיפוץ לדוגמה", status: "active", income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_before_shared_agorot: 0, profit_agorot: 0 }],
};

let page = { total: 2, expenses: [line("t1"), line("t2", { doc_date: "2026-09-20", supplier_name: null, customer_name: "לקוח לדוגמה", direction: "income", amount_net: 50_000, waiting_review: true })] };

function Where() {
  const location = useLocation();
  return (
    <>
      <p data-testid="where">{location.pathname}</p>
      <p data-testid="list">{readTxnList(location.state)?.ids.join(",") ?? ""}</p>
    </>
  );
}

function wrap(entry: string | { pathname: string; search?: string; state?: unknown }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <BooksProvider>
        <MemoryRouter initialEntries={entry === "/" ? ["/"] : ["/", entry]} initialIndex={entry === "/" ? 0 : 1}>
          <Routes>
            <Route path="/search" element={<SearchScreen />} />
            <Route path="/transactions/:id" element={<Where />} />
            <Route path="/" element={<SearchEntry to="/search" />} />
          </Routes>
        </MemoryRouter>
      </BooksProvider>
    </QueryClientProvider>,
  );
}

const searchCalls = () => rpc.calls.filter((call) => call.name === "search_transactions");

beforeEach(() => {
  rpc.calls = [];
  resetSearchMemory();
  page = { total: 2, expenses: [line("t1"), line("t2", { doc_date: "2026-09-20", supplier_name: null, customer_name: "לקוח לדוגמה", direction: "income", amount_net: 50_000, waiting_review: true })] };
  rpc.impl = (name) => {
    if (name === "search_transactions") return Promise.resolve({ data: page, error: null });
    if (name === "get_dashboard") return Promise.resolve({ data: dashboard, error: null });
    if (name === "list_categories") return Promise.resolve({ data: [], error: null });
    return Promise.resolve({ data: null, error: null });
  };
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Search screen (FLOW-323)", () => {
  it("lists every line newest first with no text, and counts them with no totals (FLOW-339 C6-6)", async () => {
    wrap("/search");
    expect(await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ })).toBeInTheDocument();
    expect(searchCalls()[0]?.args).toEqual({ p_scope: "all", p_limit: 50, p_offset: 0 });
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(/^2 תנועות$/);
    // The income line names its customer and waits for review, in words on the row.
    const income = screen.getByRole("link", { name: /^לקוח לדוגמה/ });
    expect(income).toHaveAccessibleName(/ממתינה לאישור/);
  });

  it("waits for typing to stop before it asks, and tints the match", async () => {
    wrap("/search");
    await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ });
    const field = screen.getByRole("searchbox", { name: "חיפוש תנועות" });
    fireEvent.change(field, { target: { value: "ח" } });
    fireEvent.change(field, { target: { value: "חו" } });
    fireEvent.change(field, { target: { value: "חומרי" } });
    await waitFor(() => {
      expect(searchCalls().some((call) => call.args.p_query === "חומרי")).toBe(true);
    });
    expect(searchCalls().filter((call) => call.args.p_query != null).map((call) => call.args.p_query)).toEqual(["חומרי"]);
    const row = await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ });
    expect(within(row).getByText("חומרי", { selector: "mark" })).toBeInTheDocument();
  });

  it("opens with the project chip set from a project's כל התנועות (FLOW-402)", async () => {
    wrap(`/search?project=${PROJECT}`);
    await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ });
    expect(searchCalls()[0]?.args).toMatchObject({ p_project: PROJECT });
    expect(await screen.findByRole("button", { name: "שיפוץ לדוגמה" })).toHaveAttribute("aria-pressed", "true");
  });

  it("sends each chip to the server", async () => {
    wrap("/search");
    await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ });
    fireEvent.click(screen.getByRole("button", { name: "הוצאות" }));
    await waitFor(() => {
      expect(searchCalls().at(-1)?.args).toMatchObject({ p_direction: "expense" });
    });
    fireEvent.click(screen.getByRole("button", { name: "לאישור" }));
    await waitFor(() => {
      expect(searchCalls().at(-1)?.args).toMatchObject({ p_direction: "expense", p_scope: "pending" });
    });
    // A second tap clears the chip.
    fireEvent.click(screen.getByRole("button", { name: "הוצאות" }));
    await waitFor(() => {
      expect(searchCalls().at(-1)?.args).not.toHaveProperty("p_direction");
    });
  });

  it("says nothing matched, with one way out", async () => {
    page = { total: 0, expenses: [] };
    wrap("/search?q=%D7%9E%D7%A2%D7%9C%D7%99%D7%95%D7%AA");
    expect(await screen.findByText("לא מצאנו ״מעליות״")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ניקוי החיפוש" }));
    await waitFor(() => {
      expect(searchCalls().at(-1)?.args).not.toHaveProperty("p_query");
    });
    expect(screen.getByRole("searchbox", { name: "חיפוש תנועות" })).toHaveValue("");
  });

  it("does not say nothing matched for text the server has not answered yet", async () => {
    page = { total: 0, expenses: [] };
    wrap("/search?q=%D7%97%D7%95%D7%9E%D7%A8%D7%99%D7%A7");
    expect(await screen.findByText("לא מצאנו ״חומריק״")).toBeInTheDocument();
    let answer: (value: { data: unknown; error: null }) => void = () => undefined;
    rpc.impl = (name) => (name === "search_transactions"
      ? new Promise((resolve) => { answer = resolve; })
      : Promise.resolve({ data: name === "get_dashboard" ? dashboard : [], error: null }));
    fireEvent.change(screen.getByRole("searchbox", { name: "חיפוש תנועות" }), { target: { value: "חומרי" } });
    await waitFor(() => {
      expect(searchCalls().at(-1)?.args).toMatchObject({ p_query: "חומרי" });
    });
    expect(screen.queryByText(/^לא מצאנו/)).not.toBeInTheDocument();
    answer({ data: { total: 1, expenses: [line("t1")] }, error: null });
    expect(await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ })).toBeInTheDocument();
  });

  it("says a company with no lines has none yet", async () => {
    page = { total: 0, expenses: [] };
    wrap("/search");
    expect(await screen.findByText("עוד אין תנועות")).toBeInTheDocument();
  });

  it("shows a failed read with ניסיון חוזר, which reads again", async () => {
    rpc.impl = (name) => (name === "search_transactions"
      ? Promise.resolve({ data: null, error: { message: "boom" } })
      : Promise.resolve({ data: name === "get_dashboard" ? dashboard : [], error: null }));
    wrap("/search");
    const retry = await screen.findByRole("button", { name: "ניסיון חוזר" });
    const before = searchCalls().length;
    rpc.impl = (name) => Promise.resolve({ data: name === "search_transactions" ? page : name === "get_dashboard" ? dashboard : [], error: null });
    fireEvent.click(retry);
    expect(await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ })).toBeInTheDocument();
    expect(searchCalls().length).toBeGreaterThan(before);
  });

  it("loads the next page with עוד תנועות", async () => {
    page = { total: 51, expenses: Array.from({ length: 50 }, (_, i) => line(`p${String(i)}`)) };
    wrap("/search");
    const more = await screen.findByRole("button", { name: "עוד תנועות" });
    expect(screen.getByRole("status")).toHaveTextContent(/^51 תנועות$/);
    page = { total: 51, expenses: [line("p50")] };
    fireEvent.click(more);
    await waitFor(() => {
      expect(searchCalls().at(-1)?.args).toMatchObject({ p_offset: 50 });
    });
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "עוד תנועות" })).not.toBeInTheDocument();
    });
  });

  it("draws a line the next page repeats once, and still ends the paging", async () => {
    page = { total: 51, expenses: Array.from({ length: 50 }, (_, i) => line(`p${String(i)}`)) };
    wrap("/search");
    const more = await screen.findByRole("button", { name: "עוד תנועות" });
    // A new line landed between the reads, so the second page starts with the first page's last.
    page = { total: 51, expenses: [line("p49")] };
    fireEvent.click(more);
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "עוד תנועות" })).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole("link", { name: /^חומרי בניין לדוגמה/ })).toHaveLength(50);
  });

  it("sends no id the server would refuse from a hand-edited link", async () => {
    wrap("/search?project=p1&category=%3Cx%3E");
    await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ });
    expect(searchCalls()[0]?.args).toEqual({ p_scope: "all", p_limit: 50, p_offset: 0 });
  });

  it("opens a line with the results as its prev and next list", async () => {
    wrap("/search");
    const row = await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ });
    expect(row).toHaveAttribute("href", "/transactions/t1");
    fireEvent.click(row);
    expect(await screen.findByTestId("where")).toHaveTextContent("/transactions/t1");
    // ˄ ˅ on the card walk the results in the order shown.
    expect(screen.getByTestId("list")).toHaveTextContent("t1,t2");
  });

  it("focuses the field when the search icon opened it, and not on a link or Back", async () => {
    const { unmount } = wrap("/");
    fireEvent.click(screen.getByRole("link", { name: "חיפוש תנועות" }));
    await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ });
    expect(screen.getByRole("searchbox", { name: "חיפוש תנועות" })).toHaveFocus();
    unmount();
    wrap("/search");
    await screen.findByRole("link", { name: /^חומרי בניין לדוגמה/ });
    expect(screen.getByRole("searchbox", { name: "חיפוש תנועות" })).not.toHaveFocus();
  });
});

describe("searchRowDetails", () => {
  const base = { ...line("x"), amount_net: -1n, vat_agorot: null, amount_original: null } as never;
  const now = new Date("2026-10-08T09:00:00Z");

  it("reads date, project and category, and leaves out what a chip already names", () => {
    const row = { ...(base as object), category_name: "חומרים" } as Parameters<typeof searchRowDetails>[0];
    expect(searchRowDetails(row, undefined, now).map((d) => d.text)).toEqual(["02/10", "שיפוץ לדוגמה", "חומרים"]);
    expect(searchRowDetails(row, { project: PROJECT, category: null }, now).map((d) => d.text)).toEqual(["02/10", "חומרים"]);
  });

  it("leads with מחוץ לרווח, says the split, and puts ממתינה לאישור in the accent", () => {
    const kept = { ...(base as object), kept_out: true, split_parts: 3 } as Parameters<typeof searchRowDetails>[0];
    expect(searchRowDetails(kept, undefined, now).map((d) => d.text)).toEqual(["מחוץ לרווח", "02/10", "שיפוץ לדוגמה", "פוצלה ל־3"]);
    const waiting = { ...(base as object), waiting_review: true } as Parameters<typeof searchRowDetails>[0];
    expect(searchRowDetails(waiting, undefined, now)).toEqual([{ text: "02/10" }, { text: "ממתינה לאישור", tone: "accent" }]);
  });
});
