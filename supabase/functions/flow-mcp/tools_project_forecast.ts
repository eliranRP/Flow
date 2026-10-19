// MCP tools: a project's next-month forecast edits (ProfitNext*). One read (the edits that apply to a
// month) and four writes, each mirroring the app's RPC through its mcp_* function (idempotency key,
// undo kind project_forecast). The forecast itself is get_expected_months, each open loan's schedule
// (get_loan_schedule: its interest and escrow rows) and get_project_categories.
import { z } from "zod";
import { envelopeOf, fail, ok, READ_REFUSED, type ToolResult, type ToolRpc, UUID, WRITE_REFUSED } from "./tools_args.ts";

const IDEMPOTENCY_KEY = z.string().min(1).max(128);
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
const PROJECT = z.string().regex(UUID);
const ROW_KEY = z.string().min(1).max(200);
const PACE = z.enum(["once", "month", "2months", "quarter", "year"]);

const readSchema = z.object({ project_id: PROJECT, month: MONTH }).strict();
// A change names its row (row_key); an added line names its category (and may name its direction).
const setSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  project_id: PROJECT,
  month: MONTH,
  row_key: ROW_KEY.optional(),
  category_id: z.string().regex(UUID).optional(),
  direction: z.enum(["income", "expense"]).optional(),
  amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  pace: PACE.optional(),
}).strict().superRefine((body, ctx) => {
  const change = body.row_key !== undefined;
  const add = body.category_id !== undefined;
  if (change === add) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "row_key or category_id" });
  if (change && body.direction !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "direction goes with category_id" });
});
const rowSchema = z.object({ idempotency_key: IDEMPOTENCY_KEY, project_id: PROJECT, month: MONTH, row_key: ROW_KEY }).strict();
const resetSchema = z.object({ idempotency_key: IDEMPOTENCY_KEY, project_id: PROJECT, month: MONTH.optional() }).strict();

/** The tools' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const PROJECT_FORECAST_ALLOWED: Record<string, Set<string>> = {
  get_project_forecast_edits: new Set(["project_id", "month"]),
  set_project_forecast_edit: new Set(["idempotency_key", "project_id", "month", "row_key", "category_id", "direction", "amount_minor", "pace"]),
  remove_project_forecast_row: new Set(["idempotency_key", "project_id", "month", "row_key"]),
  restore_project_forecast_row: new Set(["idempotency_key", "project_id", "month", "row_key"]),
  reset_project_forecast: new Set(["idempotency_key", "project_id", "month"]),
};

export const PROJECT_FORECAST_WRITES = ["set_project_forecast_edit", "remove_project_forecast_row", "restore_project_forecast_row", "reset_project_forecast"] as const;

/** get_project_forecast_edits: project_forecast_edits_for. */
export async function projectForecastRead(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = readSchema.safeParse(args);
  if (!parsed.success) return fail("validation", "validation");
  const result = await rpc("project_forecast_edits_for", { p_project_id: parsed.data.project_id, p_month: parsed.data.month });
  if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  return ok({ project_id: parsed.data.project_id, month: parsed.data.month, edits: result.json });
}

/** The four writes, each to its mcp_* function. */
export async function projectForecastWrite(
  name: typeof PROJECT_FORECAST_WRITES[number],
  args: Record<string, unknown>,
  rpc: ToolRpc,
): Promise<ToolResult> {
  let rpcName: string;
  let body: Record<string, unknown>;
  if (name === "set_project_forecast_edit") {
    const parsed = setSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    const { idempotency_key, project_id, month, ...edit } = parsed.data;
    rpcName = "mcp_set_project_forecast_edit";
    body = { p_idempotency_key: idempotency_key, p_project_id: project_id, p_month: month, p_edit: edit };
  } else if (name === "reset_project_forecast") {
    const parsed = resetSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = "mcp_reset_project_forecast";
    body = { p_idempotency_key: parsed.data.idempotency_key, p_project_id: parsed.data.project_id, p_month: parsed.data.month ?? null };
  } else {
    const parsed = rowSchema.safeParse(args);
    if (!parsed.success) return fail("validation", "validation");
    rpcName = name === "remove_project_forecast_row" ? "mcp_remove_project_forecast_row" : "mcp_restore_project_forecast_row";
    body = { p_idempotency_key: parsed.data.idempotency_key, p_project_id: parsed.data.project_id, p_month: parsed.data.month, p_row_key: parsed.data.row_key };
  }
  const result = await rpc(rpcName, body);
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}
