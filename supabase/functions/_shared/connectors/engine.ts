/**
 * Shared sync plan. No provider name and no HTTP. The caller opens the
 * session, passes stored lines, and writes the plan.
 *
 * Every plan calls validate again and builds ownAccountIds from every
 * account the provider returns, unless the caller scopes it to the accounts
 * the owner chose (accountScope, FLOW-938): then a transfer to an account
 * left out is money out, and that account's own lines are skipped.
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
  /** Oldest checked_at is rechecked first. Null has never been checked. */
  checkedAt?: string | null;
}

/** Status rechecks per sync. The rest wait for a later run. */
export const CONNECTOR_RECHECK_LIMIT = 50;

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
  /**
   * The accounts the owner chose (FLOW-938). `synced` are this connection's accounts that sync; `own`
   * adds the synced accounts of the company's other connections, so a transfer between any two of
   * them is skipped. Every other account the provider lists is unsynced. Omitted: every account syncs.
   */
  accountScope?: { synced: readonly string[]; own: readonly string[] };
  vatRateBp: number;
  exemptSupplierNames: readonly string[];
  exemptSupplierIds: readonly string[];
  stored: readonly StoredLine[];
  now: () => Date;
  /**
   * Status recheck for a stored line the fetch did not return.
   * Pending lines, and posted lines older than windowStart, capped at
   * CONNECTOR_RECHECK_LIMIT and oldest checkedAt first. A 404 on a
   * posted line is keep. A transient error keeps the line and does not fail
   * the run. A rate limit keeps the line and stops the rechecks for this run
   * (see PlannedSync.rateLimited). Widening the fetch date is not this recheck.
   */
  confirmLine?: (line: StoredLine) => Promise<ConfirmResult>;
  /**
   * Provider-specific voids, such as a treasury cancel of a stored yield.
   * Ids are voided with the upsert. They are not fetched again.
   */
  resolveRemovedIds?: (rawLines: readonly unknown[]) => readonly string[];
  /**
   * Skip reasons that void a stored copy of the same line (FLOW-938). A transfer an earlier run
   * imported as money out, while its other account was not synced, is skipped once that account
   * syncs; its stored copy must go too, or only one side of the transfer stays. `storedIds` returns
   * which of the skipped ids are stored and not voided yet; those are voided with the upsert.
   */
  voidStoredSkips?: {
    reasons: readonly string[];
    storedIds: (ids: readonly string[]) => Promise<readonly string[]>;
  };
}

export interface PlannedSkip {
  externalId: string | null;
  reason: string;
}

export interface PlannedSync {
  ok: true;
  accounts: AccountLabel[];
  /** The organisation's name from this validation, when the provider sent one. */
  org: string | null;
  ownAccountIds: string[];
  lines: CanonicalLine[];
  skips: PlannedSkip[];
  removedIds: string[];
  nextCursor: string | null;
  complete: boolean;
  pendingMissing: { externalId: string; missingSince: string }[];
  rechecked: { externalId: string; checkedAt: string }[];
  /**
   * Set when a recheck hit a rate limit. The run stopped rechecking there;
   * the caller backs off until retryAfter (null when the provider sent none).
   */
  rateLimited: { retryAfter: string | null } | null;
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

function recheckOrder(left: StoredLine, right: StoredLine): number {
  const leftAt = left.checkedAt ?? null;
  const rightAt = right.checkedAt ?? null;
  if (leftAt == null && rightAt != null) return -1;
  if (leftAt != null && rightAt == null) return 1;
  if (leftAt != null && rightAt != null && leftAt !== rightAt) return leftAt < rightAt ? -1 : 1;
  if (left.docDate !== right.docDate) return left.docDate < right.docDate ? -1 : 1;
  return left.externalId < right.externalId ? -1 : 1;
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
  let org: string | null = null;
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
    org = validated.org ?? null;
  } catch (error) {
    return failure(input.port, error);
  }

  const scope = input.accountScope;
  const listed = accounts.map((account) => account.id);
  const ownAccountIds = scope
    ? [...new Set([...scope.synced.filter((id) => listed.includes(id)), ...scope.own])]
    : listed;
  const unsyncedAccountIds = scope ? listed.filter((id) => !ownAccountIds.includes(id)) : [];
  const ctx = {
    ownAccountIds,
    unsyncedAccountIds,
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
  if (input.resolveRemovedIds) {
    for (const id of input.resolveRemovedIds(fetched.lines)) {
      if (id.length > 0 && id.length <= 128) removed.add(id);
    }
  }
  const pendingMissing: { externalId: string; missingSince: string }[] = [];
  const rechecked: { externalId: string; checkedAt: string }[] = [];
  let rateLimited: PlannedSync["rateLimited"] = null;
  if (fetched.complete && input.confirmLine) {
    const windowStart = fetched.windowStart ?? null;
    const candidates = input.stored.filter((stored) => {
      if (seen.has(stored.externalId) || removed.has(stored.externalId)) return false;
      const outsideWindow = windowStart != null && stored.docDate < windowStart;
      return stored.lineStatus === "pending" || outsideWindow;
    });
    candidates.sort(recheckOrder);
    const checkedAt = input.now().toISOString();
    let index = 0;
    for (; index < candidates.length && index < CONNECTOR_RECHECK_LIMIT; index += 1) {
      const stored = candidates[index]!;
      let confirmed: ConfirmResult;
      try {
        confirmed = await input.confirmLine(stored);
      } catch (error) {
        const classified = input.port.classifyError(error);
        if (classified.class === "rate_limited" || classified.class === "transient") {
          if (stored.lineStatus === "pending") {
            pendingMissing.push({
              externalId: stored.externalId,
              missingSince: stored.missingSince ?? checkedAt,
            });
          }
          if (classified.class === "rate_limited") {
            // Back off: every further call would hit the same limit.
            rateLimited = { retryAfter: classified.retry_after };
            index += 1;
            break;
          }
          continue;
        }
        return failure(input.port, error);
      }
      rechecked.push({ externalId: stored.externalId, checkedAt });
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
    // Pending lines not rechecked this run keep their missing clock, so the
    // void wait is not restarted by a rate limit or the recheck cap.
    for (const stored of candidates.slice(index)) {
      if (stored.lineStatus === "pending" && stored.missingSince) {
        pendingMissing.push({ externalId: stored.externalId, missingSince: stored.missingSince });
      }
    }
  }

  if (input.voidStoredSkips) {
    const reasons = new Set(input.voidStoredSkips.reasons);
    const skipped = new Set<string>();
    for (const skip of skips) {
      if (skip.externalId != null && reasons.has(skip.reason) && !removed.has(skip.externalId)) skipped.add(skip.externalId);
    }
    if (skipped.size > 0) {
      let stored: readonly string[];
      try {
        stored = await input.voidStoredSkips.storedIds([...skipped].sort());
      } catch (error) {
        return failure(input.port, error);
      }
      for (const id of stored) {
        if (skipped.has(id)) removed.add(id);
      }
    }
  }

  return {
    ok: true,
    accounts,
    org,
    ownAccountIds,
    lines,
    skips,
    removedIds: [...removed].sort(),
    nextCursor: fetched.nextCursor,
    complete: fetched.complete,
    pendingMissing,
    rechecked,
    rateLimited,
  };
}
