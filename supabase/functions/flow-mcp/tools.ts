// MCP tools: callTool checks the scope and runs each read; writes go to callWrite (tools_write.ts).
// Cycle 2 reads, cycle 3a single-expense writes, cycle 4 project/category/sync, cycle 5 loans, cycle 6 batch. Decision 0080.
// sync_bank and get_sync_status are in tools_sync.ts (decision 0102). Zod write schemas are in tools_schemas.ts.
// Identity is not an argument. The handler signs from the credential row.

import { demandStatement, LoanScheduleError } from "../../../packages/shared/src/loan-schedule.ts";
import {
  argsOf,
  basisArgOf,
  companyCurrency,
  dateOf,
  fail,
  isCalendarDate,
  isFail,
  limitOf,
  lineMetaOf,
  majorString,
  minorFromMajor,
  minorFromMajorOrNull,
  monthsBetween,
  NO_LINE_META,
  offsetOf,
  ok,
  pnlBasis,
  PROFIT_MONTHS_MAX,
  READ_REFUSED,
  scheduleLimitOf,
  scheduleRowOut,
  textOf,
  todayIso,
  type ToolDefer,
  type ToolInvoke,
  type ToolResult,
  type ToolRpc,
  UUID,
  withLineMeta,
} from "./tools_args.ts";
import { ALLOWED, READ_TOOL_NAMES, SYNC_STATUS_TOOL, WRITE_TOOL_NAMES } from "./tools_schemas.ts";
import {
  countedPayments,
  demandPaymentsOf,
  demandTermsOf,
  listedLoan,
  loadLoanPayments,
  loadLoans,
  loanKindOf,
  storedLoanSchedule,
} from "./tools_loans.ts";
import { scopeAllows } from "./tools_specs.ts";
import { dashboard, filterReviews, projectRow, type Review, totalsOf, unpaidReport } from "./tools_reports.ts";
import { syncStatus } from "./tools_sync.ts";
import { callWrite } from "./tools_write.ts";

// Moved to their own files (FLOW-807). Import from those files in new code.
export { type ToolRpc, type ToolInvoke, type ToolDefer } from "./tools_args.ts";
export { READ_TOOL_NAMES, SYNC_STATUS_TOOL, WRITE_TOOL_NAMES } from "./tools_schemas.ts";
export { isWriteTool, scopeAllows, toolsFor } from "./tools_specs.ts";
export { filterReviews } from "./tools_reports.ts";

export async function callTool(
  name: string,
  input: unknown,
  scope: string[],
  rpc: ToolRpc,
  invoke?: ToolInvoke,
  defer?: ToolDefer,
): Promise<ToolResult> {
  const write = (WRITE_TOOL_NAMES as readonly string[]).includes(name);
  const read = (READ_TOOL_NAMES as readonly string[]).includes(name);
  if (!write && !read) return fail("validation", "validation");
  if (!scopeAllows(name, scope)) return fail("forbidden", "forbidden");
  if (write) return callWrite(name as typeof WRITE_TOOL_NAMES[number], input, rpc, invoke, defer);
  const args = argsOf(input, ALLOWED[name] ?? new Set());
  if (isFail(args)) return args;

  if (name === SYNC_STATUS_TOOL) {
    const jobId = args.job_id;
    if (typeof jobId !== "string" || !UUID.test(jobId)) return fail("validation", "validation");
    return syncStatus(jobId, rpc);
  }

  if (name === "list_projects" || name === "get_totals") {
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    const asked = basisArgOf(args.basis);
    if (asked != null && typeof asked !== "string") return asked;
    const basis = await pnlBasis(rpc, asked);
    if (typeof basis !== "string") return basis;
    const body = await dashboard(rpc, from, to, basis);
    if (isFail(body)) return body;
    if (name === "get_totals") return ok(totalsOf(body));
    const projects = Array.isArray(body.projects) ? body.projects as Review[] : [];
    const groups = Array.isArray(body.groups) ? body.groups : [];
    return ok({ basis, projects: projects.map(projectRow), groups });
  }

  if (name === "get_project") {
    const projectId = args.id;
    if (typeof projectId !== "string" || !UUID.test(projectId)) return fail("validation", "validation");
    const asked = basisArgOf(args.basis);
    if (asked != null && typeof asked !== "string") return asked;
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    if ((from == null) !== (to == null) || (from != null && to != null && from > to)) return fail("validation", "validation");
    const basis = await pnlBasis(rpc, asked);
    if (typeof basis !== "string") return basis;
    const body: Record<string, unknown> = { p_id: projectId, p_basis: basis };
    if (from != null) Object.assign(body, { p_from: from, p_to: to });
    const result = await rpc("get_project", body);
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    // The RPC returns null for an unknown id and for another company's project.
    if (result.json == null) return fail("not_found", "not found");
    if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
    return ok({ ...(result.json as Review), basis });
  }

  if (name === "list_project_groups") {
    const result = await rpc("list_project_groups", {});
    if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", READ_REFUSED);
    return ok({ groups: result.json });
  }

  if (name === "get_project_group") {
    const groupId = args.id;
    if (typeof groupId !== "string" || !UUID.test(groupId)) return fail("validation", "validation");
    const asked = basisArgOf(args.basis);
    if (asked != null && typeof asked !== "string") return asked;
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    if ((from == null) !== (to == null) || (from != null && to != null && from > to)) return fail("validation", "validation");
    const basis = await pnlBasis(rpc, asked);
    if (typeof basis !== "string") return basis;
    const body: Record<string, unknown> = { p_id: groupId.toLowerCase(), p_basis: basis };
    if (from != null) Object.assign(body, { p_from: from, p_to: to });
    const result = await rpc("get_project_group", body);
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    // The RPC returns null for an unknown id and for another company's group.
    if (result.json == null) return fail("not_found", "not found");
    if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
    return ok({ ...(result.json as Review), basis });
  }

  if (name === "get_project_categories") {
    const projectId = args.id;
    if (typeof projectId !== "string" || !UUID.test(projectId)) return fail("validation", "validation");
    const months = args.months == null ? 6 : args.months;
    if (typeof months !== "number" || !Number.isInteger(months) || months < 3 || months > 12) return fail("validation", "validation");
    const result = await rpc("project_category_months", { p_project_id: projectId.toLowerCase(), p_months: months });
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    // The RPC returns null for an unknown id and for another company's project.
    if (result.json == null) return fail("not_found", "not found");
    if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
    return ok(result.json as Review);
  }

  if (name === "get_profit_months") {
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    if ((from == null) !== (to == null) || (from != null && to != null && from > to)) return fail("validation", "validation");
    if (from != null && to != null && monthsBetween(from, to) >= PROFIT_MONTHS_MAX) return fail("validation", "validation");
    const asked = basisArgOf(args.basis);
    if (asked != null && typeof asked !== "string") return asked;
    const projectId = args.project_id == null ? null : args.project_id;
    if (projectId != null && (typeof projectId !== "string" || !UUID.test(projectId))) return fail("validation", "validation");
    const basis = await pnlBasis(rpc, asked);
    if (typeof basis !== "string") return basis;
    const result = await rpc("get_profit_months", { p_from: from, p_to: to, p_basis: basis, p_project_id: projectId });
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    // The RPC returns null for a project of another company or an unknown one.
    if (result.json == null) return projectId == null ? fail("refused", READ_REFUSED) : fail("not_found", "not found");
    if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
    return ok({ ...(result.json as Review), basis });
  }

  if (name === "get_jev_status") {
    const result = await rpc("mcp_jev_status", {});
    const status = result.json;
    if (result.status >= 400 || status === null || typeof status !== "object" || Array.isArray(status)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(status);
  }

  if (name === "get_jev_accuracy") {
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    if (from != null && to != null && from > to) return fail("validation", "validation");
    const result = await rpc("mcp_jev_accuracy", { p_from: from, p_to: to });
    const report = result.json;
    if (result.status >= 400 || report === null || typeof report !== "object" || Array.isArray(report)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(report);
  }

  if (name === "get_anomalies" || name === "get_missing_bills" || name === "get_jev_suggestions") {
    const fn = name === "get_anomalies"
      ? "mcp_review_anomalies"
      : name === "get_jev_suggestions"
      ? "mcp_jev_suggestions"
      : "missing_bills";
    const result = await rpc(fn, {});
    const data = result.json;
    if (result.status >= 400 || data === null || typeof data !== "object") return fail("refused", READ_REFUSED);
    if (name !== "get_missing_bills") {
      if (Array.isArray(data)) return fail("refused", READ_REFUSED);
      return ok(data);
    }
    if (!Array.isArray(data)) return fail("refused", READ_REFUSED);
    return ok({ missing: data });
  }

  if (name === "list_team") {
    const result = await rpc("list_team", {});
    const team = result.json;
    if (result.status >= 400 || team === null || typeof team !== "object" || Array.isArray(team)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(team);
  }

  if (name === "list_unpaid") {
    const result = await rpc("list_unpaid", {});
    const rows = result.json;
    if (result.status >= 400 || !Array.isArray(rows)) return fail("refused", READ_REFUSED);
    return ok(unpaidReport(rows));
  }

  if (name === "get_expected_months") {
    const months = args.months == null ? 3 : args.months;
    if (typeof months !== "number" || !Number.isInteger(months) || months < 1 || months > 12) {
      return fail("validation", "validation");
    }
    const projectId = args.project_id ?? null;
    if (projectId != null && (typeof projectId !== "string" || !UUID.test(projectId))) return fail("validation", "validation");
    const result = await rpc("expected_months", { p_months: months, p_project_id: projectId });
    const data = result.json;
    if (result.status >= 400 || data === null || typeof data !== "object" || Array.isArray(data)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(data);
  }

  // FLOW-415 (decision 0172).
  if (name === "get_recurring_changes" || name === "get_recurring_this_month") {
    const changes = name === "get_recurring_changes";
    const result = await rpc(changes ? "recurring_changes" : "recurring_this_month", {});
    const data = result.json;
    if (result.status >= 400 || !Array.isArray(data)) return fail("refused", READ_REFUSED);
    return ok(changes ? { changes: data } : { arrived: data });
  }

  if (name === "get_line_recurring") {
    const id = args.transaction_id;
    if (typeof id !== "string" || !UUID.test(id)) return fail("validation", "validation");
    const result = await rpc("payment_recurring", { p_id: id });
    const data = result.json;
    if (result.status >= 400 || data === null || typeof data !== "object" || Array.isArray(data)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(data);
  }

  if (name === "get_breakdown") {
    const direction = args.direction;
    if (direction !== "income" && direction !== "expense") return fail("validation", "validation");
    const groupBy = args.group_by == null ? "category" : args.group_by;
    if (groupBy !== "category" && groupBy !== "project" && groupBy !== "payer") return fail("validation", "validation");
    // FLOW-406: level parent folds sub-categories into their parent; only by category.
    const level = args.level == null ? "category" : args.level;
    if (level !== "category" && level !== "parent") return fail("validation", "validation");
    if (level === "parent" && groupBy !== "category") return fail("validation", "validation");
    const asked = basisArgOf(args.basis);
    if (asked != null && typeof asked !== "string") return asked;
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    // get_totals counts nothing for a period with one date; refuse it so totals stay equal.
    if ((from == null) !== (to == null)) return fail("validation", "validation");
    const excluded = args.excluded == null ? false : args.excluded;
    if (typeof excluded !== "boolean") return fail("validation", "validation");
    // The kept-out list has no group; a group with excluded would be silently ignored.
    if (excluded && args.group != null) return fail("validation", "validation");
    const totals = args.group == null && !excluded;
    if (totals && (args.currency != null || args.limit != null || args.offset != null)) return fail("validation", "validation");
    const group = args.group == null ? null : args.group;
    if (group != null && (typeof group !== "string" || group.length === 0 || group.length > 64)) return fail("validation", "validation");
    let currency = args.currency;
    if (currency != null && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) return fail("validation", "validation");
    const limit = limitOf(args.limit, 40);
    if (typeof limit !== "number") return limit;
    const offset = offsetOf(args.offset);
    if (typeof offset !== "number") return offset;
    const basis = await pnlBasis(rpc, asked);
    if (typeof basis !== "string") return basis;
    const range = { p_direction: direction, p_from: from, p_to: to, p_group_by: level === "parent" ? "parent" : groupBy, p_basis: basis };
    if (totals) {
      const result = await rpc("get_breakdown", range);
      if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
        return fail("refused", READ_REFUSED);
      }
      return ok({ ...(result.json as Review), basis });
    }
    if (currency == null) {
      const base = await companyCurrency(rpc);
      if (typeof base !== "string") return base;
      currency = base;
    }
    const result = await rpc("get_breakdown_lines", {
      ...range,
      p_group_key: group,
      p_currency: currency,
      p_excluded: excluded,
      p_limit: limit,
      p_offset: offset,
    });
    if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
      return fail("refused", READ_REFUSED);
    }
    return ok({ ...(result.json as Review), basis });
  }

  // FLOW-419 (decision 0176): one project's cash per month, and the lines behind it.
  if (name === "get_project_cash_months" || name === "get_project_cash_lines") {
    const projectId = args.project_id;
    if (typeof projectId !== "string" || !UUID.test(projectId)) return fail("validation", "validation");
    let result;
    if (name === "get_project_cash_months") {
      const months = args.months == null ? 4 : args.months;
      if (typeof months !== "number" || !Number.isInteger(months) || months < 1 || months > 24) {
        return fail("validation", "validation");
      }
      result = await rpc("project_cash_months", { p_project: projectId, p_months: months });
    } else {
      const month = typeof args.month === "string" && /^\d{4}-\d{2}$/.test(args.month) ? `${args.month}-01` : args.month;
      if (typeof month !== "string" || !isCalendarDate(month)) return fail("validation", "validation");
      const side = args.side;
      if (side !== "in" && side !== "out" && side !== "excluded") return fail("validation", "validation");
      const currency = args.currency ?? null;
      if (currency != null && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) return fail("validation", "validation");
      const limit = limitOf(args.limit, 40);
      if (typeof limit !== "number") return limit;
      if (limit === 0) return fail("validation", "validation");
      const offset = offsetOf(args.offset);
      if (typeof offset !== "number") return offset;
      result = await rpc("project_cash_month_lines", {
        p_project: projectId,
        p_month: month,
        p_side: side,
        p_currency: currency,
        p_limit: limit,
        p_offset: offset,
      });
    }
    if (result.status >= 400) return fail("refused", READ_REFUSED);
    // The RPC returns null for a project of another company or an unknown one.
    if (result.json == null) return fail("not_found", "not found");
    if (typeof result.json !== "object" || Array.isArray(result.json)) return fail("refused", READ_REFUSED);
    return ok(result.json as Review);
  }

  // FLOW-413 (decision 0168): money in and out per month, on the company's cash basis.
  if (name === "get_cash_months") {
    const months = args.months == null ? 6 : args.months;
    if (typeof months !== "number" || !Number.isInteger(months) || months < 1 || months > 24) {
      return fail("validation", "validation");
    }
    const result = await rpc("cash_months", { p_months: months });
    if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(result.json as Review);
  }

  if (name === "get_cash_lines") {
    // A month is YYYY-MM or any YYYY-MM-DD in it, as get_cash_months returns it.
    const month = typeof args.month === "string" && /^\d{4}-\d{2}$/.test(args.month) ? `${args.month}-01` : args.month;
    if (typeof month !== "string" || !isCalendarDate(month)) return fail("validation", "validation");
    const side = args.side;
    if (side !== "in" && side !== "out" && side !== "excluded" && side !== "not_in_profit") return fail("validation", "validation");
    const currency = args.currency ?? null;
    if (currency != null && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) return fail("validation", "validation");
    const limit = limitOf(args.limit, 40);
    if (typeof limit !== "number") return limit;
    if (limit === 0) return fail("validation", "validation");
    const offset = offsetOf(args.offset);
    if (typeof offset !== "number") return offset;
    const result = await rpc("cash_month_lines", {
      p_month: month,
      p_side: side,
      p_currency: currency,
      p_limit: limit,
      p_offset: offset,
    });
    if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(result.json as Review);
  }

  // FLOW-213: pairs an outside ledger's rows with Flow lines; the matching is SQL (decision 0084).
  if (name === "match_lines") {
    const rows = matchRowsOf(args.rows);
    if (rows == null) return fail("validation", "validation");
    const window = args.window_days ?? 5;
    if (typeof window !== "number" || !Number.isInteger(window) || window < 0 || window > 31) return fail("validation", "validation");
    const direction = args.direction ?? null;
    if (direction != null && direction !== "income" && direction !== "expense") return fail("validation", "validation");
    const currency = args.currency ?? null;
    if (currency != null && (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency))) return fail("validation", "validation");
    const result = await rpc("match_lines", { p_rows: rows, p_window_days: window, p_direction: direction, p_currency: currency });
    if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
      return fail("refused", READ_REFUSED);
    }
    return ok(result.json as Review);
  }

  if (name === "list_categories") {
    const result = await rpc("list_categories", {});
    if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", "The read was refused.");
    return ok({ categories: result.json });
  }

  if (name === "list_review" || name === "search_expenses") {
    const limit = limitOf(args.limit, 50);
    if (typeof limit !== "number") return limit;
    const offset = offsetOf(args.offset);
    if (typeof offset !== "number") return offset;
    if (name === "search_expenses") {
      const scopeName = args.scope == null ? "pending" : args.scope;
      if (scopeName !== "pending" && scopeName !== "filed" && scopeName !== "all") return fail("validation", "validation");
      const query = textOf(args.query);
      if (typeof query !== "string" && query != null) return query;
      const from = dateOf(args.from);
      if (typeof from !== "string" && from != null) return from;
      const to = dateOf(args.to);
      if (typeof to !== "string" && to != null) return to;
      if (from != null && to != null && from > to) return fail("validation", "validation");
      const direction = textOf(args.direction);
      if (typeof direction !== "string" && direction != null) return direction;
      if (direction != null && direction !== "expense" && direction !== "income") return fail("validation", "validation");
      const project = textOf(args.project_id);
      if (typeof project !== "string" && project != null) return project;
      if (project != null && project !== "none" && !UUID.test(project)) return fail("validation", "validation");
      const category = textOf(args.category_id);
      if (typeof category !== "string" && category != null) return category;
      if (category != null && category !== "none" && !UUID.test(category)) return fail("validation", "validation");
      // FLOW-406: a parent category matches its sub-categories' lines; category_exact matches its own only.
      const categoryExact = args.category_exact == null ? false : args.category_exact;
      if (typeof categoryExact !== "boolean") return fail("validation", "validation");
      if (categoryExact && (category == null || category === "none")) return fail("validation", "validation");
      // An amount is the bank figure without its sign, in the line's own currency (FLOW-211):
      // amount finds one figure, amount_min and amount_max a range, both ends included.
      if (args.amount != null && (args.amount_min != null || args.amount_max != null)) {
        return fail("validation", "validation");
      }
      const amountMin = args.amount != null ? minorFromMajor(args.amount) : minorFromMajorOrNull(args.amount_min);
      if (amountMin != null && typeof amountMin !== "bigint") return amountMin;
      const amountMax = args.amount != null ? amountMin : minorFromMajorOrNull(args.amount_max);
      if (amountMax != null && typeof amountMax !== "bigint") return amountMax;
      if (amountMin != null && amountMax != null && amountMin > amountMax) return fail("validation", "validation");
      const filters = {
        p_from: from,
        p_to: to,
        p_project: project?.toLowerCase() ?? null,
        p_category: category?.toLowerCase() ?? null,
        p_direction: direction,
        ...(categoryExact ? { p_category_exact: true } : {}),
        // Sent only when set, so a call without an amount reads as before the amount filter.
        ...(amountMin == null ? {} : { p_amount_min: Number(amountMin) }),
        ...(amountMax == null ? {} : { p_amount_max: Number(amountMax) }),
      };
      // A query counts as a filter: search_transactions matches it on the description, the
      // supplier and the customer, in any case, as the docs say.
      const filtered = query != null || Object.values(filters).some((value) => value != null);
      if (scopeName === "pending" && filtered) {
        // With a filter, search_transactions picks the page (0140); the rows stay list_review's.
        // A line with two open review rows shows once here, and a row resolved between the two
        // reads drops out of the page while total still counts it.
        const found = await rpc("search_transactions", {
          p_query: query,
          p_scope: "pending",
          p_limit: limit,
          p_offset: offset,
          ...filters,
        });
        if (found.status >= 400 || found.json == null || typeof found.json !== "object") {
          return fail("refused", READ_REFUSED);
        }
        const body = found.json as { total?: unknown; expenses?: unknown };
        const ids = Array.isArray(body.expenses)
          ? (body.expenses as Array<Record<string, unknown>>).map((row) => row.id)
          : [];
        const listed = await rpc("list_review", {});
        if (listed.status >= 400 || !Array.isArray(listed.json)) return fail("refused", "The read was refused.");
        const byLine = new Map((listed.json as Review[]).map((row) => [row.transaction_id, row]));
        const rows = ids.flatMap((id) => {
          const row = byLine.get(id);
          return row ? [{ ...row, id: row.transaction_id }] : [];
        });
        const expenses = await withLineMeta(rpc, rows, (row) => row.id);
        if (!Array.isArray(expenses)) return expenses;
        return ok({ total: body.total, expenses });
      }
      if (scopeName === "pending") {
        const listed = await rpc("list_review", {});
        if (listed.status >= 400 || !Array.isArray(listed.json)) return fail("refused", "The read was refused.");
        const page = filterReviews(listed.json as Review[], {
          direction: null,
          reason: null,
          supplier: null,
          query,
          from: null,
          to: null,
          limit,
          offset,
        });
        const expenses = await withLineMeta(
          rpc,
          page.reviews.map((row) => ({ ...row, id: row.transaction_id })),
          (row) => row.id,
        );
        if (!Array.isArray(expenses)) return expenses;
        return ok({ total: page.total, expenses });
      }
      const found = await rpc("search_transactions", {
        p_query: query,
        p_scope: scopeName,
        p_limit: limit,
        p_offset: offset,
        ...(filtered ? filters : {}),
      });
      if (found.status >= 400 || found.json == null || typeof found.json !== "object") {
        return fail("refused", READ_REFUSED);
      }
      const body = found.json as { expenses?: unknown };
      const rows = Array.isArray(body.expenses) ? (body.expenses as Array<Record<string, unknown>>) : [];
      const expenses = await withLineMeta(rpc, rows, (row) => row.id);
      if (!Array.isArray(expenses)) return expenses;
      return ok({ ...found.json, expenses });
    }
    const direction = textOf(args.direction);
    if (typeof direction !== "string" && direction != null) return direction;
    if (direction != null && direction !== "expense" && direction !== "income") return fail("validation", "validation");
    const reason = textOf(args.reason);
    if (typeof reason !== "string" && reason != null) return reason;
    const supplier = textOf(args.supplier);
    if (typeof supplier !== "string" && supplier != null) return supplier;
    const query = textOf(args.query);
    if (typeof query !== "string" && query != null) return query;
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    const listed = await rpc("list_review", {});
    if (listed.status >= 400 || !Array.isArray(listed.json)) return fail("refused", "The read was refused.");
    const page = filterReviews(listed.json as Review[], {
      direction,
      reason,
      supplier,
      query,
      from,
      to,
      limit,
      offset,
    });
    const reviews = await withLineMeta(rpc, page.reviews, (row) => row.transaction_id);
    if (!Array.isArray(reviews)) return reviews;
    return ok({ ...page, reviews });
  }

  if (name === "list_loans") {
    const includeClosed = args.include_closed ?? true;
    if (typeof includeClosed !== "boolean") return fail("validation", "validation");
    const loans = await loadLoans(rpc);
    if (!Array.isArray(loans)) return loans;
    const listed = includeClosed ? loans : loans.filter((loan) => (loan.status ?? "open") === "open");
    // An open demand loan also shows the interest it owes today, as get_loan_schedule's accrued
    // does: carried plus accrued since the last payment, daily on actual/365 (FLOW-211). Other
    // kinds have it in their schedule rows, and a closed loan owes none: null.
    const asOf = todayIso();
    const out: Array<Record<string, unknown>> = [];
    for (const loan of listed) {
      let accruedMinor: number | null = null;
      if (loanKindOf(loan) === "demand" && (loan.status ?? "open") === "open") {
        // A failed payments read leaves the figure null rather than failing the list.
        const payments = await loadLoanPayments(loan.id, rpc);
        if (Array.isArray(payments)) {
          const counted = countedPayments(payments, null).filter((row) => row.doc_date <= asOf);
          try {
            accruedMinor = Number(demandStatement(demandTermsOf(loan), demandPaymentsOf(counted), asOf).accrued.interestMinor);
          } catch (error) {
            if (!(error instanceof LoanScheduleError)) throw error;
          }
        }
      }
      out.push({ ...listedLoan(loan), accrued_interest_minor: accruedMinor, accrued_as_of: accruedMinor == null ? null : asOf });
    }
    return ok({ loans: out });
  }

  if (name === "get_loan_schedule") {
    const loanId = args.loan_id;
    if (typeof loanId !== "string" || !UUID.test(loanId)) return fail("validation", "validation");
    const fromIndex = args.from == null ? 0 : args.from;
    if (typeof fromIndex !== "number" || !Number.isInteger(fromIndex) || fromIndex < 0) {
      return fail("validation", "validation");
    }
    const limit = scheduleLimitOf(args.limit, 12);
    if (typeof limit !== "number") return limit;
    const loans = await loadLoans(rpc);
    if (!Array.isArray(loans)) return loans;
    const asOf = args.as_of ?? todayIso();
    if (!isCalendarDate(asOf)) return fail("validation", "validation");
    const loan = loans.find((row) => row.id === loanId);
    if (loan == null) return fail("not_found", "not found");
    if (loanKindOf(loan) === "demand") {
      // Nothing is scheduled ahead: the payments attached so far, then the interest accrued
      // from the last one to as_of (default today), daily on actual/365 (decision 0132).
      const payments = await loadLoanPayments(loan.id, rpc);
      if (!Array.isArray(payments)) return payments;
      const counted = countedPayments(payments, null).filter((row) => row.doc_date <= asOf);
      let statement: ReturnType<typeof demandStatement>;
      try {
        statement = demandStatement(demandTermsOf(loan), demandPaymentsOf(counted), asOf);
      } catch (error) {
        if (error instanceof LoanScheduleError) return fail("validation", "validation");
        throw error;
      }
      const accrued = statement.accrued;
      return ok({
        loan_id: loanId,
        kind: "demand",
        from: fromIndex,
        limit,
        total: statement.rows.length,
        rows: statement.rows.slice(fromIndex, fromIndex + limit).map(scheduleRowOut),
        accrued: {
          as_of: asOf,
          since: accrued.fromDate,
          days: accrued.days,
          carried: majorString(accrued.carriedMinor),
          carried_minor: Number(accrued.carriedMinor),
          interest: majorString(accrued.interestMinor),
          interest_minor: Number(accrued.interestMinor),
          balance: majorString(accrued.balanceMinor),
          balance_minor: Number(accrued.balanceMinor),
        },
      });
    }
    const schedule = storedLoanSchedule(loan);
    if (!("rows" in schedule)) return schedule;
    const rows = schedule.rows.slice(fromIndex, fromIndex + limit).map(scheduleRowOut);
    return ok({ loan_id: loanId, kind: loanKindOf(loan), from: fromIndex, limit, total: schedule.rows.length, rows });
  }

  if (name !== "get_expense") return fail("validation", "validation");

  const transactionId = args.transaction_id;
  if (typeof transactionId !== "string" || !UUID.test(transactionId)) return fail("validation", "validation");
  const result = await rpc("get_transaction", { p_id: transactionId });
  if (result.status >= 400) return fail("refused", "The read was refused.");
  if (result.json == null) return fail("not_found", "not found");
  const metas = await lineMetaOf(rpc, [transactionId]);
  if (!(metas instanceof Map)) return metas;
  const row: Record<string, unknown> = {
    ...(result.json as Record<string, unknown>),
    meta: metas.get(transactionId) ?? { ...NO_LINE_META },
  };
  // A line split by category shows its parts. A failed parts read fails the whole read, so a
  // split line never looks whole under its own category.
  const split = await rpc("get_line_split", { p_transaction_id: transactionId });
  if (split.status >= 400) return fail("refused", "The read was refused.");
  const parts = (split.json as { parts?: unknown } | null)?.parts;
  let out: Record<string, unknown> = row;
  if (Array.isArray(parts) && parts.length > 0 && typeof row === "object" && !Array.isArray(row)) {
    const { transaction_id: _id, ...lineSplit } = split.json as Record<string, unknown>;
    // FLOW-212: the parts are what count, so the percent shares kept from before the split move
    // to allocations_superseded and allocations reads empty, as on a line with no shares.
    const { allocations: before, ...rest } = row;
    out = Array.isArray(before) && before.length > 0
      ? { ...rest, allocations: [], allocations_superseded: before, line_split: lineSplit }
      : { ...row, line_split: lineSplit };
  }
  if (row.direction === "income") return ok({ ...out, loan_split: null });
  // get_transaction carries the loan split since FLOW-114; read it on its own only from a
  // database that does not yet.
  if ("loan_split" in row) return ok({ ...out, loan_split: row.loan_split ?? null });
  const loanSplit = await rpc("get_loan_split", { p_transaction_id: transactionId });
  if (loanSplit.status >= 400) return fail("refused", "The read was refused.");
  return ok({ ...out, loan_split: loanSplit.json ?? null });
}

const MATCH_ROW_KEYS = new Set(["date", "amount_minor", "ref"]);

/** match_lines rows as the RPC takes them, or null when any row is malformed. */
function matchRowsOf(value: unknown): { date: string; amount_minor: number; ref: string | null }[] | null {
  if (!Array.isArray(value) || value.length < 1 || value.length > 500) return null;
  const rows: { date: string; amount_minor: number; ref: string | null }[] = [];
  for (const row of value) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) return null;
    const entry = row as Record<string, unknown>;
    if (Object.keys(entry).some((key) => !MATCH_ROW_KEYS.has(key))) return null;
    const { date, amount_minor: amount, ref = null } = entry;
    if (typeof date !== "string" || !isCalendarDate(date)) return null;
    if (typeof amount !== "number" || !Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) >= 1e15) return null;
    if (ref != null && (typeof ref !== "string" || ref.length > 200)) return null;
    rows.push({ date, amount_minor: amount, ref: ref as string | null });
  }
  return rows;
}
