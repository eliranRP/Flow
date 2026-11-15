import {
  type CrmTally,
  crmEntityDrift,
  definitionOf,
  isSchemaDrift,
  linkedRateBp,
  mapCrmEntity,
  pageShapeDrift,
  type SumitDoc,
} from "../../ledger.ts";
import { PULL_REPEATS, sumitPull, type SumitPullEvent, type SumitPullState } from "./machines.ts";
import { DEFERRED_CAP, INVOICES_CAP, type Pull, RATES_CAP, stateOf } from "./pull_state.ts";

/** Pages of 1,000 rows one run lists (20,000 documents). A longer window takes more runs (FLOW-1163). */
export const SUMIT_PAGE_CAP = 20;
export const SUMIT_PAGE_SIZE = 1000;

/** The rows of a listentities page: `Data` as an array, or its Entities / Data / List array. */
export function extractEntities(data: unknown): unknown[] {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== "object") return [];
  const record = data as Record<string, unknown>;
  for (const key of ["Entities", "Data", "List"]) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function idOf(entity: unknown): number | null {
  if (!entity || typeof entity !== "object") return null;
  const id = (entity as Record<string, unknown>).ID;
  return typeof id === "number" && Number.isSafeInteger(id) ? id : null;
}

/** FLOW-510. Counts of the kinds the sync skipped by design, so a renumbered kind is visible. */
function logSkippedKinds(kinds: Map<string, number>): void {
  if (kinds.size > 0) console.log("sumit-sync kinds not read", JSON.stringify(Object.fromEntries(kinds)));
}

/**
 * FLOW-510. Logs the SUMIT fields that broke (names and counts, never values). Past the isSchemaDrift
 * share it throws sync_schema_drift before anything is written, so the sweep cannot void documents
 * SUMIT still has; below it the broken rows are dropped as before.
 */
function checkDrift(tally: CrmTally): void {
  if (Object.keys(tally.broken).length === 0) return;
  console.error("sumit-sync rows that did not map", JSON.stringify({ mapped: tally.mapped, broken: tally.broken }));
  if (isSchemaDrift(tally)) throw new Error("sync_schema_drift");
}

export interface WindowList {
  /** The documents this run listed (never the row it only checked the continuation against). */
  docs: SumitDoc[];
  /** The window's last page was listed. */
  ended: boolean;
  /** Where the next run continues, for a run that stopped at the page cap; anchor null when the last row has no id. */
  next: { start: number; anchor: number | null } | null;
  /** The continuation did not match the list (it shifted), so the run listed from the first page. */
  restarted: boolean;
  /** Pages fetched, the check page included. */
  reads: number;
}

/**
 * Lists the documents folder page by page (offset paging, 1,000 rows), at most `cap` pages. With a
 * continuation it asks from the row before `resume.start`, which must be the row the last run ended on
 * (`resume.anchor`): if it is not, rows were added or removed ahead of it, the offsets no longer line
 * up, and the run lists from the first page instead (`restarted`). Pure over `fetchPage`: no network.
 */
export async function listWindow(
  fetchPage: (start: number) => Promise<Record<string, unknown>>,
  resume: { start: number; anchor: number | null } | null,
  cap: number = SUMIT_PAGE_CAP,
): Promise<WindowList> {
  let docs: SumitDoc[] = [];
  let tally: CrmTally = { mapped: 0, broken: {} };
  let skippedKinds = new Map<string, number>();
  let reads = 0;
  // A continuation with no anchor cannot be checked: start over (counted as a repeat).
  const checkable = resume != null && resume.anchor != null;
  let restarted = resume != null && !checkable;
  let verify = checkable ? resume.anchor : null;
  let start = checkable ? resume.start - 1 : 0;
  let last: number | null = null;
  let pages = 0;
  while (pages < cap) {
    reads += 1;
    const payload = await fetchPage(start);
    // FLOW-510: a page with a body but no row list means SUMIT changed its shape.
    if (pageShapeDrift(payload)) {
      console.error("sumit-sync page without a row list", JSON.stringify(Object.keys(payload).slice(0, 10)));
      throw new Error("sync_schema_drift");
    }
    const data = payload.Data;
    const entities = extractEntities(data);
    let rows = entities;
    if (verify != null) {
      if (idOf(entities[0]) !== verify) {
        restarted = true;
        verify = null;
        start = 0;
        docs = [];
        tally = { mapped: 0, broken: {} };
        skippedKinds = new Map();
        continue;
      }
      verify = null;
      rows = entities.slice(1);
    }
    pages += 1;
    for (const entity of rows) {
      if (!entity || typeof entity !== "object") continue;
      const record = entity as Record<string, unknown>;
      const mapped = mapCrmEntity(record);
      if (mapped) {
        docs.push(mapped);
        tally.mapped += 1;
        continue;
      }
      const field = crmEntityDrift(record);
      if (field != null) tally.broken[field] = (tally.broken[field] ?? 0) + 1;
      else skippedKinds.set(definitionOf(record), (skippedKinds.get(definitionOf(record)) ?? 0) + 1);
    }
    const hasNext = Boolean(
      data && typeof data === "object" && "HasNextPage" in data && (data as { HasNextPage?: boolean }).HasNextPage,
    );
    if (!hasNext || entities.length === 0) {
      logSkippedKinds(skippedKinds);
      checkDrift(tally);
      return { docs, ended: true, next: null, restarted, reads };
    }
    start += entities.length;
    last = idOf(entities[entities.length - 1]);
  }
  logSkippedKinds(skippedKinds);
  checkDrift(tally);
  return { docs, ended: false, next: { start, anchor: last }, restarted, reads };
}

export type RunPlan =
  | { kind: "fail"; code: "sync_page_cap" }
  | {
    kind: "store";
    /** The documents to store now (a partial run keeps back the receipts whose invoice is not listed yet). */
    batch: SumitDoc[];
    /** Documents deriveLine reads a receipt's invoice from: the batch, and the earlier runs' invoice rates. */
    lookup: Map<number, SumitDoc>;
    /** `plain` is upsert_sumit_documents as before; `window` is upsert_sumit_window (partial runs, and the run that ends a pull). */
    path: "plain" | "window";
    /** Whether the database may sweep: only a window listed whole in this one run. A resumed window never sweeps. */
    complete: boolean;
    /** The continuation to store with the documents; null clears it. */
    pull: Pull | null;
    event: SumitPullEvent;
    before: Exclude<SumitPullState, "complete">;
    after: SumitPullState;
  };

/**
 * What a run does with what it listed (decision 0266: the move comes from `sumitPull`).
 * - The window ended: a window listed whole in this one run may sweep, as always. One that took more
 *   runs stores and never sweeps (the list has no stable order).
 * - The window did not end: store the batch, never sweep, and keep the continuation, the invoice ids listed so
 *   far, the VAT rates a receipt needs from an invoice listed earlier, and the receipts whose invoice
 *   is not listed yet. A continuation that cannot be kept (no id on the last row, over a bound) fails
 *   the run as before, storing nothing.
 */
export function planRun(input: {
  pull: Pull | null;
  hasPullKey: boolean;
  list: WindowList;
  companyRateBp: number;
  sumitCompanyId: number;
  now: string;
  /** Invoice ids a window may keep across its runs (INVOICES_CAP; a test lowers it). */
  invoicesCap?: number;
}): RunPlan {
  const { pull, list } = input;
  const prev = list.restarted ? null : pull;
  const before = stateOf(pull);
  const candidates = [...(prev?.deferred ?? []), ...list.docs];
  const own = new Map(candidates.map((doc) => [doc.sumit_id, doc]));
  const rates: Record<string, number> = { ...(prev?.rates ?? {}) };
  for (const doc of list.docs) {
    if (doc.kind !== "inv" && doc.kind !== "invrec") continue;
    const bp = doc.gross === 0 ? input.companyRateBp : linkedRateBp(doc, input.companyRateBp);
    const key = String(doc.sumit_id);
    if (bp === input.companyRateBp) delete rates[key];
    // Past RATES_CAP a rate is not carried: receipts of that invoice take the company rate.
    else if (key in rates || Object.keys(rates).length < RATES_CAP) rates[key] = bp;
  }
  const lookup = new Map(own);
  for (const [id, bp] of Object.entries(rates)) {
    if (lookup.has(Number(id))) continue;
    lookup.set(Number(id), stub(Number(id), bp));
  }

  if (list.ended) {
    // A window that took more than one run never sweeps: the list has no stable order, so a document no
    // run listed could be one that moved between runs, and a wrong removal deletes a real line.
    const complete = prev == null;
    return {
      kind: "store",
      batch: candidates,
      lookup,
      path: prev == null && !input.hasPullKey ? "plain" : "window",
      complete,
      pull: null,
      event: "finished",
      before,
      after: sumitPull.next(before, "finished"),
    };
  }

  // Not reachable (a run that did not end has a continuation), kept so the type narrows.
  if (list.next == null) return { kind: "fail", code: "sync_page_cap" };
  const earlier = prev == null ? new Set<number>() : prev.invoices == null ? null : new Set(prev.invoices);
  const resolvable = (orig: number): boolean => own.has(orig) || String(orig) in rates || (earlier?.has(orig) ?? false);
  // The first DEFERRED_CAP receipts whose invoice is not listed yet wait for it; the rest are stored now
  // with the company rate and are not re-rated later (the documented trade, FLOW-1163).
  const deferred = candidates.filter((doc) => doc.kind === "rec" && doc.orig != null && !resolvable(doc.orig)).slice(0, DEFERRED_CAP);
  const held = new Set(deferred.map((doc) => doc.sumit_id));
  let invoices: number[] | null = null;
  if (earlier != null) {
    const all = new Set([...earlier, ...candidates.filter((doc) => doc.kind === "inv" || doc.kind === "invrec").map((doc) => doc.sumit_id)]);
    if (all.size <= (input.invoicesCap ?? INVOICES_CAP)) invoices = [...all].sort((a, b) => a - b);
  }
  const event: SumitPullEvent = list.restarted ? "repeated" : "capped";
  const after = sumitPull.next(before, event);
  if (after === "fresh" || after === "complete") return { kind: "fail", code: "sync_page_cap" };
  return {
    kind: "store",
    batch: candidates.filter((doc) => !held.has(doc.sumit_id)),
    lookup,
    path: "window",
    complete: false,
    pull: {
      v: 1,
      company: input.sumitCompanyId,
      at: prev?.at ?? input.now,
      start: list.next.start,
      anchor: list.next.anchor,
      repeats: PULL_REPEATS[after],
      invoices,
      rates,
      deferred,
    },
    event,
    before,
    after,
  };
}

/** An invoice stood in for by its VAT rate alone: `linkedRateBp` reads the rate a receipt takes from it. */
function stub(id: number, bp: number): SumitDoc {
  return {
    key: `sumit:${id}`,
    sumit_id: id,
    kind: "inv",
    date: "1970-01-01",
    gross: 1,
    wo: 1,
    vat: bp / 100,
    bud: null,
    bud_name: null,
    orig: null,
    cust: null,
    cust_name: null,
    number: null,
    desc: "",
  };
}
