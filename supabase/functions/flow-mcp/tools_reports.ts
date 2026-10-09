// MCP tools: the Unpaid report and the review dashboard reads.
// Split out of tools.ts (FLOW-807). Decision 0080.

import { fail, READ_REFUSED, type ToolResult, type ToolRpc } from "./tools_args.ts";

/**
 * FLOW-330. list_unpaid rows in minor units, with open and marked totals per currency and
 * direction: customer invoices (income) and supplier invoices (expense, negative) never mix.
 */
export function unpaidReport(rows: unknown[]) {
  const totals = new Map<string, { currency: string; direction: string; open_gross_minor: bigint; marked_gross_minor: bigint }>();
  const invoices = rows.map((raw) => {
    const row = (raw ?? {}) as Record<string, unknown>;
    const currency = typeof row.currency === "string" ? row.currency : "ILS";
    const direction = row.direction === "expense" ? "expense" : "income";
    const gross = BigInt(String(row.open_gross_agorot ?? 0));
    const markedAt = typeof row.marked_paid_at === "string" ? row.marked_paid_at : null;
    const key = `${currency}|${direction}`;
    const total = totals.get(key) ?? { currency, direction, open_gross_minor: 0n, marked_gross_minor: 0n };
    if (markedAt == null) total.open_gross_minor += gross;
    else total.marked_gross_minor += gross;
    totals.set(key, total);
    return {
      id: row.id,
      description: row.description ?? null,
      doc_date: row.doc_date ?? null,
      currency,
      direction,
      project_name: row.project_name ?? null,
      customer_name: row.customer_name ?? null,
      open_gross_minor: Number(gross),
      open_net_minor: Number(BigInt(String(row.open_net_agorot ?? 0))),
      marked_paid_at: markedAt,
      document_url: typeof row.document_url === "string" ? row.document_url : null,
    };
  });
  return {
    invoices,
    totals: [...totals.values()]
      .sort((x, y) => x.currency.localeCompare(y.currency) || x.direction.localeCompare(y.direction))
      .map((t) => ({
        currency: t.currency,
        direction: t.direction,
        open_gross_minor: Number(t.open_gross_minor),
        marked_gross_minor: Number(t.marked_gross_minor),
      })),
  };
}

export type Review = Record<string, unknown>;

export function filterReviews(rows: Review[], input: {
  direction: string | null;
  reason: string | null;
  supplier: string | null;
  query: string | null;
  from: string | null;
  to: string | null;
  limit: number;
  offset: number;
}): { total: number; reviews: Review[] } {
  const filtered = rows.filter((row) => {
    if (input.direction && row.direction !== input.direction) return false;
    if (input.reason && row.reason !== input.reason) return false;
    if (input.supplier) {
      // An income line's party is its customer.
      const names = [row.supplier_name, row.customer_name].filter((name): name is string => typeof name === "string");
      if (!names.some((name) => name.includes(input.supplier!))) return false;
    }
    if (input.query) {
      const description = typeof row.description === "string" ? row.description : "";
      if (!description.includes(input.query)) return false;
    }
    const doc = typeof row.doc_date === "string" ? row.doc_date : "";
    if (input.from && doc < input.from) return false;
    if (input.to && doc > input.to) return false;
    return true;
  });
  return { total: filtered.length, reviews: filtered.slice(input.offset, input.offset + input.limit) };
}

export function projectRow(row: Review) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    budget_agorot: row.budget_agorot ?? null,
    income_agorot: row.income_agorot,
    direct_agorot: row.direct_agorot,
    shared_agorot: row.shared_agorot,
    profit_agorot: row.profit_agorot,
    is_overhead: row.is_overhead === true,
    group_id: row.group_id ?? null,
    by_currency: row.by_currency ?? [],
  };
}

export function totalsOf(body: Review) {
  return {
    company_id: body.company_id ?? null,
    name: body.name ?? null,
    basis: body.basis,
    from: body.from ?? null,
    to: body.to ?? null,
    income_agorot: body.income_agorot,
    direct_agorot: body.direct_agorot,
    shared_agorot: body.shared_agorot,
    overhead_agorot: body.overhead_agorot,
    expense_agorot: body.expense_agorot,
    unassigned_income_agorot: body.unassigned_income_agorot,
    unassigned_expense_agorot: body.unassigned_expense_agorot,
    overhead_project_id: body.overhead_project_id ?? null,
    net_profit_agorot: body.net_profit_agorot,
    active_projects: body.active_projects,
    review_count: body.review_count,
    excluded_income_agorot: body.excluded_income_agorot,
    excluded_expense_agorot: body.excluded_expense_agorot,
    by_currency: body.by_currency ?? [],
    groups: Array.isArray(body.groups) ? body.groups : [],
  };
}

export async function dashboard(rpc: ToolRpc, from: string | null, to: string | null, basis: string): Promise<ToolResult | Review> {
  const result = await rpc("get_dashboard", { p_from: from, p_to: to, p_basis: basis });
  if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
    return fail("refused", READ_REFUSED);
  }
  return result.json as Review;
}
