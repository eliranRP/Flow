// MCP tools: the zod schemas for split_line parts, shared with assign_expenses' parts rows. Split out
// of tools_schemas.ts (FLOW-949). Each rule names itself, so a refusal carries it as `detail`.

import { z } from "zod";
import { fail, type ToolResult, UUID } from "./tools_args.ts";

const UUID_TEXT = z.string().regex(UUID).transform((id) => id.toLowerCase());
const IDEMPOTENCY_KEY = z.string().min(1).max(128);

/** The refusal for a real duplicate, worded as save_line_split words it. */
export const SAME_PAIR_TWICE = "same category and project twice";

// Each part gives exactly one of amount_minor (cents), percent (up to 4 decimals) or rest: true.
// gross_up (FLOW-946, 0206) marks an opposite-sign part that nets against the line; exact amount
// only. effect ('contra'|'normal', FLOW-947, 0207) is an optional gross-up-only marker (derived).
export const linePartSchema = z.object({
  category_id: UUID_TEXT.optional(),
  project_id: UUID_TEXT.nullable().optional(),
  amount_minor: z.number().int().min(1).max(999_999_999_999_999).optional(),
  percent: z.number().gt(0).max(100).refine((n) => Math.round(n * 10000) / 10000 === n).optional(),
  rest: z.literal(true).optional(),
  gross_up: z.boolean().optional(),
  effect: z.enum(["contra", "normal"]).optional(),
}).strict()
  .refine((part) => [part.amount_minor, part.percent, part.rest].filter((v) => v !== undefined).length === 1, {
    message: "a part gives exactly one of amount_minor, percent or rest",
  })
  .refine((part) => part.rest === true || part.category_id !== undefined, {
    message: "category_id is required unless rest",
  })
  .refine((part) => part.gross_up !== true || part.amount_minor !== undefined, {
    message: "gross_up requires amount_minor",
  })
  .refine((part) => part.effect === undefined || part.gross_up === true, {
    message: "effect only on a gross_up part",
  });

/**
 * Two to 50 parts (or none, to clear), at most one rest, and a category and project pair once per
 * kind of part: one normal and one gross-up part may share a pair (FLOW-949, 0207). Returns the
 * rule that fails, or null.
 */
export function linePartsProblem(parts: z.infer<typeof linePartSchema>[]): string | null {
  if (parts.length === 1 || parts.length > 50) return "parts must be none or 2 to 50";
  if (parts.filter((part) => part.rest).length > 1) return "at most one rest part";
  const seen = new Set<string>();
  for (const part of parts) {
    if (part.category_id === undefined) continue;
    const pair = `${part.category_id.toLowerCase()}|${(part.project_id ?? "").toLowerCase()}|${part.gross_up === true}`;
    if (seen.has(pair)) return SAME_PAIR_TWICE;
    seen.add(pair);
  }
  return null;
}

export const splitLineSchema = z.object({
  idempotency_key: IDEMPOTENCY_KEY,
  transaction_id: UUID_TEXT,
  parts: z.array(linePartSchema),
}).strict().superRefine((body, ctx) => {
  const problem = linePartsProblem(body.parts);
  if (problem != null) ctx.addIssue({ code: "custom", message: problem });
});

/**
 * `validation` with `detail`, the first rule that failed (FLOW-949): a rule's own message, after the
 * path of the part it is about ("parts.1: gross_up requires amount_minor"). `message` stays
 * `validation` for clients that match on it.
 */
export function invalidDetail(error: z.ZodError): ToolResult {
  const issue = error.issues[0];
  if (issue == null) return fail("validation", "validation");
  const reason = issue.code === "unrecognized_keys" ? "unknown field" : issue.message.replace(/^Invalid input: /, "");
  const path = issue.path.filter((key) => typeof key === "number" || /^[A-Za-z0-9_]{1,64}$/.test(String(key))).join(".");
  return fail("validation", "validation", path === "" ? reason : `${path}: ${reason}`);
}
