// Cycle 2 reads, cycle 3a single-expense writes, and cycle 4 project/category/sync. Decision 0080.
// Identity is not an argument. The handler signs from the credential row.
// Zod checks write arguments. A failure is the fixed validation message.

import { z } from "zod";
import { MERCURY_SYNC_FUNCTION } from "../_shared/connectors/mercury/capabilities.ts";

export const READ_TOOL_NAMES = [
  "list_projects",
  "list_categories",
  "list_review",
  "get_expense",
  "search_expenses",
  "get_totals",
] as const;

export const WRITE_TOOL_NAMES = [
  "assign_expense",
  "set_expense_category",
  "create_project",
  "create_category",
  "sync_bank",
  "hide_category",
  "undo",
] as const;

const IDENTITY = new Set(["user_id", "p_user", "company_id", "sub", "mcp_tid"]);
const READ_REFUSED = "The read was refused.";
const WRITE_REFUSED = "The write was refused.";
const TOOL_CODES = new Set(["forbidden", "validation", "not_found", "conflict", "already_closed", "refused", "unavailable"]);
const ALLOWED: Record<string, Set<string>> = {
  list_projects: new Set(["from", "to", "basis"]),
  list_categories: new Set(),
  list_review: new Set(["direction", "reason", "supplier", "query", "from", "to", "limit", "offset"]),
  get_expense: new Set(["transaction_id"]),
  search_expenses: new Set(["scope", "query", "limit", "offset"]),
  get_totals: new Set(["from", "to", "basis"]),
  assign_expense: new Set(["idempotency_key", "transaction_id", "project_id", "category_id", "remember"]),
  set_expense_category: new Set(["idempotency_key", "transaction_id", "category_id"]),
  create_project: new Set(["idempotency_key", "name", "status"]),
  create_category: new Set(["idempotency_key", "name", "kind"]),
  sync_bank: new Set(["idempotency_key"]),
  hide_category: new Set(["idempotency_key", "category_id"]),
  undo: new Set(["idempotency_key", "kind", "id"]),
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_TEXT = z.string().regex(UUID);
const IDEMPOTENCY_KEY = z.string().min(1).max(128);
const assignSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  project_id: UUID_TEXT,
  category_id: UUID_TEXT,
  remember: z.boolean().optional(),
}).strict();
const categorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  category_id: UUID_TEXT,
}).strict();
const undoSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  kind: z.enum(["review", "reassign", "project", "category", "category_hidden"]),
  id: UUID_TEXT,
}).strict();
const createProjectSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: z.string().trim().min(2).max(120),
  status: z.enum(["active", "finished"]).optional(),
}).strict();
const createCategorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  name: z.string().trim().min(2).max(120),
  kind: z.enum(["expense", "income"]),
}).strict();
const syncBankSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
}).strict();
const hideCategorySchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  category_id: UUID_TEXT,
}).strict();

export type ToolRpc = (name: string, body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;
export type ToolInvoke = (fn: string, body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;

type ToolResult = {
  isError: boolean;
  structuredContent: { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };
};

function fail(code: string, message: string): ToolResult {
  return { isError: true, structuredContent: { ok: false, error: { code, message } } };
}

function ok(data: unknown): ToolResult {
  return { isError: false, structuredContent: { ok: true, data } };
}

function argsOf(input: unknown, allowed: Set<string>): Record<string, unknown> | ToolResult {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return fail("validation", "validation");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (IDENTITY.has(key) || !allowed.has(key)) return fail("validation", "validation");
  }
  return record;
}

function isFail(value: Record<string, unknown> | ToolResult): value is ToolResult {
  return "isError" in value;
}

function limitOf(value: unknown, fallback: number): number | ToolResult {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    return fail("validation", "validation");
  }
  return value;
}

function offsetOf(value: unknown): number | ToolResult {
  if (value == null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fail("validation", "validation");
  return value;
}

function dateOf(value: unknown): string | null | ToolResult {
  if (value == null) return null;
  if (typeof value !== "string" || !DATE.test(value)) return fail("validation", "validation");
  return value;
}

function textOf(value: unknown): string | null | ToolResult {
  if (value == null) return null;
  if (typeof value !== "string") return fail("validation", "validation");
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

type Review = Record<string, unknown>;

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
      const name = typeof row.supplier_name === "string" ? row.supplier_name : "";
      if (!name.includes(input.supplier)) return false;
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

function projectRow(row: Review) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    budget_agorot: row.budget_agorot ?? null,
    income_agorot: row.income_agorot,
    direct_agorot: row.direct_agorot,
    shared_agorot: row.shared_agorot,
    profit_agorot: row.profit_agorot,
  };
}

function totalsOf(body: Review) {
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
    net_profit_agorot: body.net_profit_agorot,
    active_projects: body.active_projects,
    review_count: body.review_count,
  };
}

async function dashboard(rpc: ToolRpc, from: string | null, to: string | null, basis: string): Promise<ToolResult | Review> {
  const result = await rpc("get_dashboard", { p_from: from, p_to: to, p_basis: basis });
  if (result.status >= 400 || result.json == null || typeof result.json !== "object" || Array.isArray(result.json)) {
    return fail("refused", READ_REFUSED);
  }
  return result.json as Review;
}

function toolSpec(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  write = false,
) {
  return {
    name,
    description,
    inputSchema: { type: "object", properties, additionalProperties: false },
    annotations: write
      ? { readOnlyHint: false, destructiveHint: true, idempotentHint: true }
      : { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
  };
}

export function isWriteTool(name: string): boolean {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

function readTools() {
  return [
    toolSpec("list_projects", "Projects and their profit for a period. Omit both dates for all time.", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
    }),
    toolSpec("list_categories", "The company's categories.", {}),
    toolSpec("list_review", "Open review items. id is the review id. transaction_id is the ledger id.", {
      direction: { type: "string", enum: ["expense", "income"] },
      reason: { type: "string" },
      supplier: { type: "string" },
      query: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_expense", "One ledger row, including its allocations. transaction_id is the ledger id.", {
      transaction_id: { type: "string" },
    }),
    toolSpec("search_expenses", "Search pending review rows, filed rows, or both. id is the ledger id.", {
      scope: { type: "string", enum: ["pending", "filed", "all"] },
      query: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }),
    toolSpec("get_totals", "Company totals for a period. Omit both dates for all time.", {
      from: { type: "string" },
      to: { type: "string" },
      basis: { type: "string", enum: ["cash", "invoiced"] },
    }),
  ];
}

function writeTools() {
  return [
    toolSpec("assign_expense", "Assign one expense to a project and category. An open review is closed.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      project_id: { type: "string" },
      category_id: { type: "string" },
      remember: { type: "boolean" },
    }, true),
    toolSpec("set_expense_category", "Set one expense category. Shares stay. An open review is closed.", {
      idempotency_key: { type: "string" },
      transaction_id: { type: "string" },
      category_id: { type: "string" },
    }, true),
    toolSpec("create_project", "Create a project in the owner's company.", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
      status: { type: "string", enum: ["active", "finished"] },
    }, true),
    toolSpec("create_category", "Create a category in the owner's company.", {
      idempotency_key: { type: "string" },
      name: { type: "string" },
      kind: { type: "string", enum: ["expense", "income"] },
    }, true),
    toolSpec("sync_bank", "Pull the latest Mercury bank lines for this company.", {
      idempotency_key: { type: "string" },
    }, true),
    toolSpec("hide_category", "Hide a category. Undo restores the prior hidden flag.", {
      idempotency_key: { type: "string" },
      category_id: { type: "string" },
    }, true),
    toolSpec("undo", "Undo one assistant write recorded for this user.", {
      idempotency_key: { type: "string" },
      kind: { type: "string", enum: ["review", "reassign", "project", "category", "category_hidden"] },
      id: { type: "string" },
    }, true),
  ];
}

export function toolsFor(scope: string[]) {
  return [
    ...(scope.includes("read") ? readTools() : []),
    ...(scope.includes("write") ? writeTools() : []),
  ];
}

function envelopeOf(json: unknown): ToolResult {
  if (json == null || typeof json !== "object" || Array.isArray(json)) return fail("refused", WRITE_REFUSED);
  const body = json as { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } };
  if (body.ok === true && body.data != null && typeof body.data === "object") return ok(body.data);
  const code = body.error?.code;
  const message = body.error?.message;
  if (body.ok === false && typeof code === "string" && TOOL_CODES.has(code) && typeof message === "string") {
    return fail(code, message);
  }
  return fail("refused", WRITE_REFUSED);
}

async function syncBank(
  key: string,
  rpc: ToolRpc,
  invoke?: ToolInvoke,
): Promise<ToolResult> {
  const begin = await rpc("mcp_sync_bank_begin", { p_idempotency_key: key });
  if (begin.status >= 400) return fail("refused", WRITE_REFUSED);
  const begun = envelopeOf(begin.json);
  if (begun.isError) return begun;
  const state = (begun.structuredContent as { ok: true; data: Record<string, unknown> }).data;
  if (state.state !== "proceed") {
    return ok(state);
  }
  if (!invoke) return fail("unavailable", "unavailable");
  const pulled = await invoke(MERCURY_SYNC_FUNCTION, { force: true });
  if (pulled.status === 429) return fail("unavailable", "retry");
  if (pulled.status === 401) return fail("unavailable", "unavailable");
  const payload = pulled.json != null && typeof pulled.json === "object" && !Array.isArray(pulled.json)
    ? pulled.json as Record<string, unknown>
    : null;
  if (payload?.error === "Mercury is not connected") {
    return fail("not_found", "bank is not connected");
  }
  if (payload?.error === "auth") {
    return fail("refused", "bank key was rejected; reconnect in Settings");
  }
  if (pulled.status === 200 && payload != null) {
    if (payload.skipped === true) return fail("unavailable", "retry");
    if (payload.ok === true) {
      const data = {
        added: typeof payload.inserted === "number" ? payload.inserted : 0,
        duplicates: typeof payload.updated === "number" ? payload.updated : 0,
        removed: typeof payload.removed === "number" ? payload.removed : 0,
        newest_date: typeof payload.newest_date === "string" ? payload.newest_date : null,
      };
      await rpc("mcp_sync_bank_finish", {
        p_idempotency_key: key,
        p_response: { ok: true, data },
      });
      return ok(data);
    }
  }
  return fail("refused", "The bank sync failed.");
}

async function callWrite(
  name: typeof WRITE_TOOL_NAMES[number],
  input: unknown,
  rpc: ToolRpc,
  invoke?: ToolInvoke,
): Promise<ToolResult> {
  const args = argsOf(input, ALLOWED[name] ?? new Set());
  if (isFail(args)) return args;
  let rpcName = "mcp_undo";
  let body: Record<string, unknown> = {};
  if (name === "sync_bank") {
    const parsed = syncBankSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    return syncBank(parsed.data.idempotency_key, rpc, invoke);
  }
  if (name === "assign_expense") {
    const parsed = assignSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_assign_expense";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_project_id: parsed.data.project_id,
      p_category_id: parsed.data.category_id,
      p_remember: parsed.data.remember ?? false,
    };
  } else if (name === "set_expense_category") {
    const parsed = categorySchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_set_expense_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_transaction_id: parsed.data.transaction_id,
      p_category_id: parsed.data.category_id,
    };
  } else if (name === "create_project") {
    const parsed = createProjectSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_create_project";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_name: parsed.data.name,
      ...(parsed.data.status == null ? {} : { p_status: parsed.data.status }),
    };
  } else if (name === "create_category") {
    const parsed = createCategorySchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_create_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_name: parsed.data.name,
      p_kind: parsed.data.kind,
    };
  } else if (name === "hide_category") {
    const parsed = hideCategorySchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_hide_category";
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_category_id: parsed.data.category_id,
    };
  } else {
    const parsed = undoSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    body = {
      p_idempotency_key: parsed.data.idempotency_key,
      p_kind: parsed.data.kind,
      p_id: parsed.data.id,
    };
  }
  const result = await rpc(rpcName, body);
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}

export async function callTool(
  name: string,
  input: unknown,
  scope: string[],
  rpc: ToolRpc,
  invoke?: ToolInvoke,
): Promise<ToolResult> {
  const write = (WRITE_TOOL_NAMES as readonly string[]).includes(name);
  const read = (READ_TOOL_NAMES as readonly string[]).includes(name);
  if (!write && !read) return fail("validation", "validation");
  if (write && !scope.includes("write")) return fail("forbidden", "forbidden");
  if (read && !scope.includes("read")) return fail("forbidden", "forbidden");
  if (write) return callWrite(name as typeof WRITE_TOOL_NAMES[number], input, rpc, invoke);
  const args = argsOf(input, ALLOWED[name] ?? new Set());
  if (isFail(args)) return args;

  if (name === "list_projects" || name === "get_totals") {
    const from = dateOf(args.from);
    if (typeof from !== "string" && from != null) return from;
    const to = dateOf(args.to);
    if (typeof to !== "string" && to != null) return to;
    const basis = args.basis == null ? "cash" : args.basis;
    if (basis !== "cash" && basis !== "invoiced") return fail("validation", "validation");
    const body = await dashboard(rpc, from, to, basis);
    if (isFail(body)) return body;
    if (name === "get_totals") return ok(totalsOf(body));
    const projects = Array.isArray(body.projects) ? body.projects as Review[] : [];
    return ok({ projects: projects.map(projectRow) });
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
        return ok({
          total: page.total,
          expenses: page.reviews.map((row) => ({ ...row, id: row.transaction_id })),
        });
      }
      const found = await rpc("search_transactions", {
        p_query: query,
        p_scope: scopeName,
        p_limit: limit,
        p_offset: offset,
      });
      if (found.status >= 400 || found.json == null || typeof found.json !== "object") {
        return fail("refused", READ_REFUSED);
      }
      return ok(found.json);
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
    return ok(filterReviews(listed.json as Review[], {
      direction,
      reason,
      supplier,
      query,
      from,
      to,
      limit,
      offset,
    }));
  }

  const transactionId = args.transaction_id;
  if (typeof transactionId !== "string" || !UUID.test(transactionId)) return fail("validation", "validation");
  const result = await rpc("get_transaction", { p_id: transactionId });
  if (result.status >= 400) return fail("refused", "The read was refused.");
  if (result.json == null) return fail("not_found", "not found");
  return ok(result.json);
}
