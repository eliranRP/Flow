// FLOW-141: the forecast write schemas, split out of tools_schemas.ts (800-line limit).
import { z } from "zod";
import { DATE, isCalendarDate } from "./tools_args.ts";

const IDEMPOTENCY_KEY = z.string().min(1).max(128);

// FLOW-141: a month is YYYY-MM; one item's amount, day or "not this month", or its reset (alone).
const forecastMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const setForecastItemSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  month: forecastMonth,
  item_key: z.string().min(1).max(200),
  amount_minor: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).nullable().optional(),
  due_on: z.string().regex(DATE).refine((v) => isCalendarDate(v)).nullable().optional(),
  moved_out: z.boolean().nullable().optional(),
  reset: z.literal(true).optional(),
}).strict().superRefine((body, ctx) => {
  const keys = ["amount_minor", "due_on", "moved_out", "reset"].filter((key) => body[key as keyof typeof body] !== undefined);
  if (keys.length === 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "at least one field" });
  if (body.reset !== undefined && keys.length > 1) ctx.addIssue({ code: z.ZodIssueCode.custom, message: "reset goes alone" });
});
export const resetForecastSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  month: forecastMonth,
}).strict();

/** The forecast tools' argument allow-list, merged into ALLOWED in tools_schemas.ts. */
export const FORECAST_ALLOWED: Record<string, Set<string>> = {
  get_forecast: new Set(["month"]),
  set_forecast_item: new Set(["idempotency_key", "month", "item_key", "amount_minor", "due_on", "moved_out", "reset"]),
  reset_forecast: new Set(["idempotency_key", "month"]),
};
