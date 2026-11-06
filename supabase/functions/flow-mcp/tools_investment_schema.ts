// set_project_investment's arguments (FLOW-404, decision 0143; units and land FLOW-450; the selling
// cost FLOW-1068), apart from tools_schemas.ts to keep it under the file-size limit.
import { z } from "zod";
import { isCalendarDate } from "./tools_args.ts";
import { IDEMPOTENCY_KEY, UUID_TEXT } from "./tools_schemas.ts";

const INVESTMENT_AMOUNT = z.number().int().min(0).max(999_999_999_999_999);
export const INVESTMENT_KEYS = ["currency", "purchase_minor", "arv_minor", "value_minor", "value_date", "units", "land_minor", "selling_cost_bp"] as const;
export const setProjectInvestmentSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  project_id: UUID_TEXT,
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  purchase_minor: INVESTMENT_AMOUNT.nullable().optional(),
  arv_minor: INVESTMENT_AMOUNT.nullable().optional(),
  value_minor: INVESTMENT_AMOUNT.nullable().optional(),
  value_date: z.string().refine((v) => isCalendarDate(v)).nullable().optional(),
  units: z.number().int().min(1).max(9999).nullable().optional(),
  land_minor: INVESTMENT_AMOUNT.nullable().optional(),
  // The costs of selling, basis points of the ARV (800 = 8%); null is the default 8%.
  selling_cost_bp: z.number().int().min(0).max(3000).nullable().optional(),
}).strict().refine((v) => INVESTMENT_KEYS.some((k) => v[k] !== undefined));
