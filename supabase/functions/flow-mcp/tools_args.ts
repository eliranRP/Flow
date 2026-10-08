// MCP tools: the shared result type, refusal codes and argument readers (dates, limits, money).
// Split out of tools.ts (FLOW-807). Decision 0080.

import { LOAN_TERM_MONTHS_MAX, type LoanScheduleRow } from "../../../packages/shared/src/loan-schedule.ts";
import { parseDecimalHalfEven } from "../../../packages/shared/src/money.ts";

const IDENTITY = new Set(["user_id", "p_user", "company_id", "sub", "mcp_tid"]);
export const READ_REFUSED = "The read was refused.";
export const WRITE_REFUSED = "The write was refused.";
const TOOL_CODES = new Set(["forbidden", "validation", "not_found", "conflict", "already_closed", "refused", "unavailable"]);
export const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type ToolRpc = (name: string, body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;
export type ToolInvoke = (fn: string, body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;
/** Keeps work running after the response is sent (EdgeRuntime.waitUntil). */
export type ToolDefer = (work: Promise<unknown>) => void;

export type ToolResult = {
  isError: boolean;
  structuredContent: { ok: true; data: unknown } | { ok: false; error: { code: string; message: string } };
};

export function fail(code: string, message: string): ToolResult {
  return { isError: true, structuredContent: { ok: false, error: { code, message } } };
}

export function ok(data: unknown): ToolResult {
  return { isError: false, structuredContent: { ok: true, data } };
}

export function argsOf(input: unknown, allowed: Set<string>): Record<string, unknown> | ToolResult {
  if (input == null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return fail("validation", "validation");
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (IDENTITY.has(key) || !allowed.has(key)) return fail("validation", "validation");
  }
  return record;
}

export function isFail(value: Record<string, unknown> | ToolResult): value is ToolResult {
  return "isError" in value;
}

export function limitOf(value: unknown, fallback: number): number | ToolResult {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 100) {
    return fail("validation", "validation");
  }
  return value;
}

/** FLOW-304. A line's bank details. Every field is null when the provider gave none. */
export const NO_LINE_META = {
  method: null,
  card_last4: null,
  memo: null,
  account: null,
  counterparty: null,
  bank_description: null,
} as const;

/**
 * Bank details for these ledger ids, keyed by id. A failed read fails the tool, so a
 * row never looks like it has no bank details when the read was refused.
 */
export async function lineMetaOf(rpc: ToolRpc, ids: string[]): Promise<Map<string, Record<string, unknown>> | ToolResult> {
  const wanted = [...new Set(ids.filter((id) => UUID.test(id)))];
  const found = new Map<string, Record<string, unknown>>();
  if (wanted.length === 0) return found;
  const result = await rpc("get_line_meta", { p_ids: wanted });
  if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  for (const row of result.json as unknown[]) {
    if (row == null || typeof row !== "object" || Array.isArray(row)) continue;
    const { transaction_id: id, ...meta } = row as Record<string, unknown>;
    if (typeof id === "string") found.set(id, { ...NO_LINE_META, ...meta });
  }
  return found;
}

/** Adds meta to each row, read by the row's ledger id. */
export async function withLineMeta<T extends Record<string, unknown>>(
  rpc: ToolRpc,
  rows: T[],
  idOf: (row: T) => unknown,
): Promise<Array<T & { meta: Record<string, unknown> }> | ToolResult> {
  const metas = await lineMetaOf(rpc, rows.map(idOf).filter((id): id is string => typeof id === "string"));
  if (!(metas instanceof Map)) return metas;
  return rows.map((row) => {
    const id = idOf(row);
    return { ...row, meta: (typeof id === "string" ? metas.get(id) : undefined) ?? { ...NO_LINE_META } };
  });
}

export function offsetOf(value: unknown): number | ToolResult {
  if (value == null) return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return fail("validation", "validation");
  return value;
}

export function dateOf(value: unknown): string | null | ToolResult {
  if (value == null) return null;
  if (typeof value !== "string" || !DATE.test(value)) return fail("validation", "validation");
  return value;
}

/** get_profit_months refuses a range of this many calendar months or more, as the RPC does. */
export const PROFIT_MONTHS_MAX = 240;

/** Calendar months from the month of `from` to the month of `to`, both YYYY-MM-DD. */
export function monthsBetween(from: string, to: string): number {
  return (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
}

export function textOf(value: unknown): string | null | ToolResult {
  if (value == null) return null;
  if (typeof value !== "string") return fail("validation", "validation");
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

const SAFE_MINOR = BigInt(Number.MAX_SAFE_INTEGER);

export function decimalText(value: number | string): string {
  return typeof value === "string" ? value : Object.is(value, -0) ? "0" : value.toString();
}

export function minorFromMajor(value: unknown): bigint | ToolResult {
  if (typeof value !== "number" && typeof value !== "string") return fail("validation", "validation");
  try {
    const minor = parseDecimalHalfEven(decimalText(value).trim().replace(/[\s,]/g, ""), 2);
    if (minor <= 0n || minor > SAFE_MINOR) return fail("validation", "validation");
    return minor;
  } catch {
    return fail("validation", "validation");
  }
}

/** An optional amount in major units: null when absent, else as minorFromMajorNonNegative. */
export function minorFromMajorOrNull(value: unknown): bigint | null | ToolResult {
  if (value == null) return null;
  return minorFromMajorNonNegative(value);
}

export function minorFromMajorNonNegative(value: unknown, fallback = 0n): bigint | ToolResult {
  if (value == null) return fallback;
  if (typeof value !== "number" && typeof value !== "string") return fail("validation", "validation");
  try {
    const minor = parseDecimalHalfEven(decimalText(value).trim().replace(/[\s,]/g, ""), 2);
    if (minor < 0n || minor > SAFE_MINOR) return fail("validation", "validation");
    return minor;
  } catch {
    return fail("validation", "validation");
  }
}

export function ppmFromPercent(value: unknown): number | ToolResult {
  if (typeof value !== "number" && typeof value !== "string") return fail("validation", "validation");
  const text = decimalText(value).trim();
  if (text.endsWith(".")) return fail("validation", "validation");
  try {
    const ppm = parseDecimalHalfEven(text, 4);
    if (ppm < 0n || ppm > 1_000_000n) return fail("validation", "validation");
    return Number(ppm);
  } catch {
    return fail("validation", "validation");
  }
}

export function scheduleLimitOf(value: unknown, fallback: number): number | ToolResult {
  if (value == null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > LOAN_TERM_MONTHS_MAX) {
    return fail("validation", "validation");
  }
  return value;
}

export function majorString(minor: bigint): string {
  const whole = minor / 100n;
  const frac = minor % 100n;
  if (frac === 0n) return whole.toString();
  return `${whole.toString()}.${frac.toString().padStart(2, "0")}`;
}

export function scheduleRowOut(row: LoanScheduleRow) {
  return {
    date: row.dueDate,
    payment: majorString(row.paymentMinor),
    interest: majorString(row.interestMinor),
    escrow: majorString(row.escrowMinor),
    principal: majorString(row.principalMinor),
    balance: majorString(row.balanceMinor),
    payment_minor: Number(row.paymentMinor),
    interest_minor: Number(row.interestMinor),
    escrow_minor: Number(row.escrowMinor),
    principal_minor: Number(row.principalMinor),
    balance_minor: Number(row.balanceMinor),
  };
}

/** A real calendar day as YYYY-MM-DD (2026-02-30 is not one). */
export function isCalendarDate(value: unknown): value is string {
  if (typeof value !== "string" || !DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return !Number.isNaN(time) && new Date(time).toISOString().slice(0, 10) === value;
}

/** Today in UTC, as YYYY-MM-DD: a demand loan's interest accrues to it. */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function companyCurrency(rpc: ToolRpc): Promise<string | ToolResult> {
  const result = await rpc("mcp_company_loan_currency", {});
  if (result.status >= 400 || typeof result.json !== "string") return fail("refused", READ_REFUSED);
  return result.json;
}

export function envelopeOf(json: unknown, refused = WRITE_REFUSED): ToolResult {
  if (json == null || typeof json !== "object" || Array.isArray(json)) return fail("refused", refused);
  const body = json as { ok?: unknown; data?: unknown; error?: { code?: unknown; message?: unknown } };
  if (body.ok === true && body.data != null && typeof body.data === "object") return ok(body.data);
  const code = body.error?.code;
  const message = body.error?.message;
  if (body.ok === false && typeof code === "string" && TOOL_CODES.has(code) && typeof message === "string") {
    return fail(code, message);
  }
  return fail("refused", refused);
}
