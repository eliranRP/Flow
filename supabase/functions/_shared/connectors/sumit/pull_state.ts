import type { DocKind, SumitDoc } from "../../ledger.ts";
import { PULL_REPEATS, type SumitPullState } from "./machines.ts";

/**
 * What sumit-sync keeps between runs of one documents window, in `connector_connections.settings.pull`
 * (FLOW-1163). Pure: the function reads the row and the database function writes it, in the same
 * transaction as the documents the run stored, so the continuation never points past documents that
 * were not stored. A reconnect replaces the settings, so it drops the pull.
 */
export const PULL_KEY = "pull";
/** Invoice ids a window may keep across its runs, to tell a receipt its invoice was listed. Over it the list is dropped. */
export const INVOICES_CAP = 100_000;
/**
 * Receipts held back until their invoice is listed, and invoice VAT rates kept. Over either bound a run does not fail:
 * a receipt past the bound is stored at once with the company's rate (what a receipt whose invoice never
 * appears gets), and a rate past it is not carried, so receipts of that invoice take the company rate too.
 */
export const DEFERRED_CAP = 1_000;
export const RATES_CAP = 2_000;

export interface Pull {
  v: 1;
  /** SUMIT's company id: a pull belongs to the SUMIT company it was listed from. */
  company: number;
  /** When the window opened (informational). */
  at: string;
  /** The offset the next run continues at, and the id of the row just before it (the check that the list did not shift). A last row with no id leaves null: the next run cannot check, so it starts over and counts toward the stuck rule. */
  start: number;
  anchor: number | null;
  /** Runs in a row that left the continuation where it was (`PULL_REPEATS`). */
  repeats: number;
  /** Ids of the invoices the window's earlier runs listed (a receipt's rate is read from them); null when over INVOICES_CAP. */
  invoices: number[] | null;
  /** VAT rates (basis points) of listed documents that differ from the company's, for receipts linked to them. */
  rates: Record<string, number>;
  /** Receipts whose invoice has not been listed yet: not stored, kept whole. */
  deferred: SumitDoc[];
}

const KINDS: readonly string[] = ["inv", "rec", "invrec", "cred", "exp"] satisfies readonly DocKind[];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

const isInt = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value);
const isText = (value: unknown): value is string => typeof value === "string";
const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const orNull = (test: (v: unknown) => boolean) => (value: unknown): boolean => value === null || test(value);

function isDoc(value: unknown): value is SumitDoc {
  if (!isRecord(value)) return false;
  const nullInt = orNull(isInt);
  return isText(value.key) && isInt(value.sumit_id) && isText(value.kind) && KINDS.includes(value.kind) &&
    isText(value.date) && isNum(value.gross) && isNum(value.wo) && orNull(isNum)(value.vat) &&
    nullInt(value.bud) && orNull(isText)(value.bud_name) && nullInt(value.orig) &&
    nullInt(value.cust) && orNull(isText)(value.cust_name) && nullInt(value.number) && isText(value.desc);
}

/** The pull the settings hold for this SUMIT company, or null: none, another company's, or malformed (then the run starts over). */
export function readPull(settings: Record<string, unknown>, sumitCompanyId: number): Pull | null {
  const raw = settings[PULL_KEY];
  if (!isRecord(raw) || raw.v !== 1 || raw.company !== sumitCompanyId) return null;
  if (!isText(raw.at) || !isInt(raw.start) || raw.start < 1 || (raw.anchor !== null && !isInt(raw.anchor))) return null;
  if (!isInt(raw.repeats) || raw.repeats < 0) return null;
  let invoices: number[] | null = null;
  if (raw.invoices !== null) {
    if (!Array.isArray(raw.invoices) || raw.invoices.length > INVOICES_CAP || !raw.invoices.every(isInt)) return null;
    invoices = raw.invoices as number[];
  }
  if (!isRecord(raw.rates) || Object.keys(raw.rates).length > RATES_CAP) return null;
  if (!Object.entries(raw.rates).every(([id, bp]) => /^[0-9]+$/.test(id) && isInt(bp))) return null;
  if (!Array.isArray(raw.deferred) || raw.deferred.length > DEFERRED_CAP || !raw.deferred.every(isDoc)) return null;
  return {
    v: 1,
    company: raw.company,
    at: raw.at,
    start: raw.start,
    anchor: raw.anchor,
    repeats: raw.repeats,
    invoices,
    rates: raw.rates as Record<string, number>,
    deferred: raw.deferred as SumitDoc[],
  };
}

/** Whether the settings hold a pull key at all, valid or not: a run that finishes clears it. */
export function hasPullKey(settings: Record<string, unknown>): boolean {
  return PULL_KEY in settings;
}

/** The step a pull is in: `fresh` with none. */
export function stateOf(pull: Pull | null): Exclude<SumitPullState, "complete"> {
  if (pull == null) return "fresh";
  if (pull.repeats >= PULL_REPEATS.stuck) return "stuck";
  return pull.repeats === 2 ? "twice" : pull.repeats === 1 ? "once" : "resuming";
}

/** The step the settings hold; `fresh` with no usable pull. */
export function pullState(settings: Record<string, unknown>, sumitCompanyId: number): Exclude<SumitPullState, "complete"> {
  return stateOf(readPull(settings, sumitCompanyId));
}

/**
 * Whether a run skips this connection: `stuck` stops the drain, forced or not, and an unforced run.
 * Only the owner's own forced refresh (not drained) runs it, so the sync stops retrying by itself
 * while the owner can still try (the rule of Mercury's `repeatedPageSkips`).
 */
export function pullSkips(
  settings: Record<string, unknown>,
  sumitCompanyId: number,
  run: { force: boolean; drained: boolean },
): boolean {
  return pullState(settings, sumitCompanyId) === "stuck" && !(run.force && !run.drained);
}
