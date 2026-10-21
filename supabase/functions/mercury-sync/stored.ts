import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../packages/shared/src/database.types.ts";
import { CONNECTOR_RECHECK_LIMIT, type ConfirmResult, type StoredLine } from "../_shared/connectors/engine.ts";
import { getMercuryTransaction, recheckMissingPending } from "../_shared/connectors/mercury/client.ts";
import { addCalendarDays } from "../_shared/connectors/mercury/dates.ts";
import type { TreasuryStoredLine } from "../_shared/connectors/mercury/normalize.ts";
import {
  MERCURY_TREASURY_CANCEL_OF,
  MERCURY_TREASURY_FEE_TYPES,
  MERCURY_TREASURY_OTHER_INCOME_TYPES,
  MERCURY_TREASURY_YIELD_TYPES,
  isVoidMercuryStatus,
} from "../_shared/connectors/mercury/rules.ts";
import { storedLinesFilter } from "../_shared/connectors/mercury/scope.ts";
import type { ConnectorSession } from "../_shared/connectors/types.ts";

/**
 * The stored Mercury lines one connection's run rechecks and voids against (FLOW-938): only lines of
 * that connection's accounts, and lines with no account for one connection of the company (the lowest
 * chosen slot), so one connection's key never voids a line only another connection can see.
 */

type Admin = SupabaseClient<Database>;

/** Which stored lines are this connection's: by account id, plus the lines with no account for one. */
export interface StoredScope {
  accountIds: readonly string[];
  withoutAccount: boolean;
}

const STORED_PAGE = 1000;
// transactions has no source_account_id column (the upsert never stores it), so don't select it.
const STORED_COLUMNS = "external_id, line_status, doc_date, amount_original, provider_meta";

// Treasury lines are not on GET /transaction/{id}, so the recheck of old lines skips them; a
// cancel voids them instead. A line with no kind is still rechecked.
const TREASURY_LINE_KINDS = [
  ...MERCURY_TREASURY_YIELD_TYPES,
  ...MERCURY_TREASURY_OTHER_INCOME_TYPES,
  ...MERCURY_TREASURY_FEE_TYPES,
  "manualAmendmentPosted",
];
const NOT_TREASURY = `provider_meta->>kind.is.null,provider_meta->>kind.not.in.(${TREASURY_LINE_KINDS.join(",")})`;
// The lines a cancel can void, read back a year: a cancel comes within days of its original.
const TREASURY_CANCELLABLE = [...new Set(Object.values(MERCURY_TREASURY_CANCEL_OF))];
const TREASURY_STORED_DAYS = 366;
const TREASURY_STORED_LIMIT = 2000;

interface StoredRow {
  external_id: string;
  line_status: string;
  doc_date: string;
  amount_original: number | null;
  provider_meta: unknown;
}

function checkedAtOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as { checked_at?: unknown }).checked_at;
  return typeof value === "string" && value.length > 0 && value.length <= 40 ? value : null;
}

function kindOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as { kind?: unknown }).kind;
  return typeof value === "string" && value.length > 0 ? value : null;
}

function accountOf(meta: unknown): string | null {
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) return null;
  const value = (meta as { account_id?: unknown }).account_id;
  return typeof value === "string" && value.length > 0 && value.length <= 128 ? value : null;
}

function baseStored(admin: Admin, companyId: string) {
  return admin
    .from("transactions")
    .select(STORED_COLUMNS)
    .eq("company_id", companyId)
    .eq("source", "mercury")
    .is("removed_at", null);
}

type StoredFilter = ReturnType<typeof baseStored>;

async function readPages(
  admin: Admin,
  companyId: string,
  group: string,
  apply: (query: StoredFilter) => StoredFilter,
): Promise<StoredRow[]> {
  const rows: StoredRow[] = [];
  for (let from = 0; from < STORED_PAGE * 20; from += STORED_PAGE) {
    const page = await apply(baseStored(admin, companyId).or(group))
      .order("external_id", { ascending: true })
      .range(from, from + STORED_PAGE - 1);
    if (page.error) throw new Error("could not read stored lines");
    const batch = (page.data ?? []) as StoredRow[];
    rows.push(...batch);
    if (batch.length < STORED_PAGE) return rows;
  }
  throw new Error("could not read stored lines");
}

export async function loadStored(
  admin: Admin,
  companyId: string,
  missing: Record<string, string>,
  windowStart: string,
  scope: StoredScope,
): Promise<{ stored: StoredLine[]; treasury: TreasuryStoredLine[] }> {
  const group = storedLinesFilter(scope.accountIds, scope.withoutAccount);
  if (group == null) return { stored: [], treasury: [] };
  // One or-group per request: the treasury kinds and the scope are both or-groups, so they nest in one and().
  const oldLines = `and(or(${NOT_TREASURY}),or(${group}))`;
  const pending = await readPages(admin, companyId, group, (query) => query.eq("line_status", "pending"));
  const unchecked = await admin
    .from("transactions")
    .select(STORED_COLUMNS)
    .eq("company_id", companyId)
    .eq("source", "mercury")
    .eq("line_status", "posted")
    .is("removed_at", null)
    .lt("doc_date", windowStart)
    .or(oldLines)
    .filter("provider_meta->>checked_at", "is", null)
    .order("doc_date", { ascending: true })
    .limit(CONNECTOR_RECHECK_LIMIT);
  if (unchecked.error) throw new Error("could not read stored lines");
  const oldRows = (unchecked.data ?? []) as StoredRow[];
  if (oldRows.length < CONNECTOR_RECHECK_LIMIT) {
    const checked = await admin
      .from("transactions")
      .select(STORED_COLUMNS)
      .eq("company_id", companyId)
      .eq("source", "mercury")
      .eq("line_status", "posted")
      .is("removed_at", null)
      .lt("doc_date", windowStart)
      .or(oldLines)
      .not("provider_meta->>checked_at", "is", null)
      .order("provider_meta->>checked_at", { ascending: true })
      .limit(CONNECTOR_RECHECK_LIMIT - oldRows.length);
    if (checked.error) throw new Error("could not read stored lines");
    oldRows.push(...(checked.data ?? []) as StoredRow[]);
  }
  // Bounded by date and count, so a long history neither throws nor is read in full (FLOW-509).
  const treasuryRead = await baseStored(admin, companyId)
    .or(group)
    .eq("line_status", "posted")
    .in("provider_meta->>kind", TREASURY_CANCELLABLE)
    .gte("doc_date", addCalendarDays(windowStart, -TREASURY_STORED_DAYS))
    .order("doc_date", { ascending: false })
    .order("external_id", { ascending: true })
    .limit(TREASURY_STORED_LIMIT);
  if (treasuryRead.error) throw new Error("could not read stored lines");
  const treasury = (treasuryRead.data ?? []) as StoredRow[];

  const stored: StoredLine[] = [];
  const seen = new Set<string>();
  for (const row of [...pending, ...oldRows]) {
    if (row.line_status !== "pending" && row.line_status !== "posted") continue;
    if (typeof row.external_id !== "string" || typeof row.doc_date !== "string" || seen.has(row.external_id)) continue;
    seen.add(row.external_id);
    stored.push({
      externalId: row.external_id,
      lineStatus: row.line_status,
      docDate: row.doc_date,
      missingSince: missing[row.external_id] ?? null,
      checkedAt: checkedAtOf(row.provider_meta),
    });
  }
  const yields: TreasuryStoredLine[] = [];
  const seenYields = new Set<string>();
  for (const row of treasury) {
    const kind = kindOf(row.provider_meta);
    if (!kind || typeof row.external_id !== "string" || typeof row.amount_original !== "number") continue;
    if (seenYields.has(row.external_id)) continue;
    seenYields.add(row.external_id);
    yields.push({
      externalId: row.external_id,
      kind,
      amountCents: Math.abs(row.amount_original),
      accountId: accountOf(row.provider_meta),
      docDate: row.doc_date,
    });
  }
  return { stored, treasury: yields };
}

export async function confirmStored(session: ConnectorSession, line: StoredLine, now: Date): Promise<ConfirmResult> {
  if (line.lineStatus === "pending") {
    const since = line.missingSince ?? now.toISOString();
    const result = await recheckMissingPending(session, line.externalId, since, now);
    if (result.action === "keep") return { action: "keep", missingSince: since };
    if (result.action === "void") return { action: "void" };
    return { action: "update", raw: result.raw };
  }
  const raw = await getMercuryTransaction(session, line.externalId);
  if (raw == null) return { action: "keep", missingSince: line.missingSince ?? now.toISOString() };
  const status = isRecord(raw) && typeof raw.status === "string" ? raw.status : "";
  if (isVoidMercuryStatus(status)) return { action: "void" };
  return { action: "update", raw };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
