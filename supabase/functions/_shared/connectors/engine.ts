/**
 * Shared sync plan. No provider name and no HTTP. The caller opens the
 * session, passes stored lines, and writes the plan.
 *
 * Every plan calls validate again and builds ownAccountIds from every
 * account the provider returns. A subset would import a transfer to an
 * unconnected org account as income or expense.
 */
import type {
  AccountLabel,
  CanonicalLine,
  ClassifiedError,
  ConnectorPort,
  ConnectorSession,
  FetchSinceResult,
  LineStatus,
} from "./types.ts";

export interface StoredLine {
  externalId: string;
  lineStatus: Extract<LineStatus, "pending" | "posted">;
  docDate: string;
  missingSince: string | null;
}

export type ConfirmResult =
  | { action: "void" }
  | { action: "keep"; missingSince: string }
  | { action: "update"; raw: unknown };

export interface PlanSyncInput {
  port: ConnectorPort;
  session: ConnectorSession;
  cursor: string | null;
  importFrom: string | null;
  lookbackDays: number;
  ownCounterpartyIds: readonly string[];
  vatRateBp: number;
  exemptSupplierNames: readonly string[];
  exemptSupplierIds: readonly string[];
  stored: readonly StoredLine[];
  now: () => Date;
  /**
   * Status recheck for a stored line the fetch did not return.
   * Pending lines, and posted lines older than windowStart. A 404 on a
   * posted line is keep. Widening the fetch date is not this recheck.
   */
  confirmLine?: (line: StoredLine) => Promise<ConfirmResult>;
}

export interface PlannedSkip {
  externalId: string | null;
  reason: string;
}

export interface PlannedSync {
  ok: true;
  accounts: AccountLabel[];
  ownAccountIds: string[];
  lines: CanonicalLine[];
  skips: PlannedSkip[];
  removedIds: string[];
  nextCursor: string | null;
  complete: boolean;
  pendingMissing: { externalId: string; missingSince: string }[];
}

export interface PlannedFailure {
  ok: false;
  error: ClassifiedError;
  /** note_connector_failure code. The class when the provider did not name a narrower one. */
  code: string;
}

function rawId(raw: unknown): string | null {
  if (!raw || typeof raw !== "object" || !("id" in raw)) return null;
  const id = (raw as { id: unknown }).id;
  return typeof id === "string" && id.length > 0 && id.length <= 128 ? id : null;
}

function failure(port: ConnectorPort, error: unknown): PlannedFailure {
  const classified = port.classifyError(error);
  return { ok: false, error: classified, code: classified.code ?? classified.class };
}

/**
 * Validate, then fetch, then normalize. ownAccountIds is every id from
 * this validation, including an account opened since the previous sync.
 */
export async function planConnectorSync(input: PlanSyncInput): Promise<PlannedSync | PlannedFailure> {
  let accounts: AccountLabel[];
  try {
    const validated = await input.port.validate(input.session);
    if (!validated.ok) {
      const classified = {
        class: validated.class,
        retry_after: validated.retry_after,
        ...(validated.code ? { code: validated.code } : {}),
      };
      return { ok: false, error: classified, code: validated.code ?? validated.class };
    }
    accounts = validated.accounts;
  } catch (error) {
    return failure(input.port, error);
  }

  const ownAccountIds = accounts.map((account) => account.id);
  const ctx = {
    ownAccountIds,
    ownCounterpartyIds: input.ownCounterpartyIds,
    vatRateBp: input.vatRateBp,
    exemptSupplierNames: input.exemptSupplierNames,
    exemptSupplierIds: input.exemptSupplierIds,
    linkedDocuments: [],
  };

  let fetched: FetchSinceResult;
  try {
    fetched = await input.port.fetchSince(input.session, {
      cursor: input.cursor,
      importFrom: input.importFrom,
      lookbackDays: input.lookbackDays,
    });
  } catch (error) {
    return failure(input.port, error);
  }

  const lines: CanonicalLine[] = [];
  const skips: PlannedSkip[] = [];
  const seen = new Set<string>();
  for (const raw of fetched.lines) {
    const id = rawId(raw);
    if (id) seen.add(id);
    let normalized;
    try {
      normalized = input.port.normalize(raw, ctx);
    } catch (error) {
      return failure(input.port, error);
    }
    if (normalized.ok) lines.push(normalized.line);
    else skips.push({ externalId: id, reason: normalized.skip });
  }

  const removed = new Set(fetched.removedIds);
  const pendingMissing: { externalId: string; missingSince: string }[] = [];
  if (fetched.complete && input.confirmLine) {
    const windowStart = fetched.windowStart ?? null;
    for (const stored of input.stored) {
      if (seen.has(stored.externalId) || removed.has(stored.externalId)) continue;
      const outsideWindow = windowStart != null && stored.docDate < windowStart;
      if (stored.lineStatus !== "pending" && !outsideWindow) continue;
      let confirmed: ConfirmResult;
      try {
        confirmed = await input.confirmLine(stored);
      } catch (error) {
        return failure(input.port, error);
      }
      if (confirmed.action === "void") {
        removed.add(stored.externalId);
        continue;
      }
      if (confirmed.action === "keep") {
        if (stored.lineStatus === "pending") {
          pendingMissing.push({ externalId: stored.externalId, missingSince: confirmed.missingSince });
        }
        continue;
      }
      const id = rawId(confirmed.raw);
      if (id) seen.add(id);
      try {
        const normalized = input.port.normalize(confirmed.raw, ctx);
        if (normalized.ok) lines.push(normalized.line);
        else skips.push({ externalId: id, reason: normalized.skip });
      } catch (error) {
        return failure(input.port, error);
      }
    }
  }

  return {
    ok: true,
    accounts,
    ownAccountIds,
    lines,
    skips,
    removedIds: [...removed].sort(),
    nextCursor: fetched.nextCursor,
    complete: fetched.complete,
    pendingMissing,
  };
}
