import type { MercurySkipReason } from "./capabilities.ts";
import { dollarsToCents } from "./money.ts";
import { jerusalemDate } from "./dates.ts";
import { redactMercury } from "./redact.ts";
import {
  isCardAccountKind,
  isExpenseCreditKind,
  isVoidMercuryStatus,
  mercuryCategoryHint,
} from "./rules.ts";
import {
  TEXT_LIMITS,
  canonicalLineSchema,
  type CanonicalLine,
  type NormalizeContext,
  type NormalizeResult,
} from "../types.ts";

const KNOWN_STATUSES = new Set(["sent", "pending", "cancelled", "failed", "reversed", "blocked"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringField(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function skip(reason: MercurySkipReason): NormalizeResult {
  return { ok: false, skip: reason };
}

/** Card spend whose account is missing from a non-empty own-account list. The sync must stop. */
export class MercuryCardAccountError extends Error {
  readonly code = "mercury_card_account_missing";

  constructor() {
    super("mercury_card_account_missing");
    this.name = "MercuryCardAccountError";
  }
}

/**
 * The posted currency. Mercury's transaction has no currency field, and the
 * account currency is USD. An explicit currency, or a conversion whose
 * settled currency is not USD, is refused. merchant.currency is the
 * merchant's currency and is not the line.
 */
function settledCurrency(raw: Record<string, unknown>): string {
  const explicit = stringField(raw.currency);
  if (explicit) return explicit.toUpperCase();
  if (isRecord(raw.currencyExchangeInfo)) {
    const settled = stringField(raw.currencyExchangeInfo.convertedToCurrency);
    if (settled) return settled.toUpperCase();
  }
  return "USD";
}

function bounded(value: string | null): string | null {
  if (!value) return null;
  if (value.length > TEXT_LIMITS.externalId) return null;
  return value;
}

/**
 * Pure Mercury line. No clock, no network, no database.
 *
 * Skip order:
 * 1. A treasuryTransfer or internalTransfer is skipped only when its
 *    counterparty id is one of the connected Mercury account ids, the same
 *    gate as card autopay. The kind alone does not skip the line.
 * 2. Any other counterparty id in ownAccountIds is an own-account transfer.
 * 3. Card spend whose accountId is outside a non-empty ownAccountIds throws
 *    mercury_card_account_missing. It is not a silent not_own_account skip.
 * 4. Any other accountId outside ownAccountIds is not one of the connected accounts.
 * 5. A settled currency other than USD is non_usd. A refused amount is
 *    refused_amount. Zero is not_a_line.
 * A transfer whose counterparty is only in ownCounterpartyIds is imported
 * with category_hint העברות. It is not skipped.
 *
 * Treasury yield and dividends are income in הכנסה אחרת. These fixtures only
 * carry "Liquidation of Treasury assets" legs, and this adapter does not
 * call the treasury transactions endpoint.
 * TODO(PR2): import treasury yield and dividends as הכנסה אחרת from that endpoint.
 */
export function normalizeMercury(raw: unknown, ctx: NormalizeContext): NormalizeResult {
  if (!isRecord(raw)) return skip("not_a_line");
  const id = stringField(raw.id);
  if (!id || id.length > TEXT_LIMITS.externalId) return skip("not_a_line");

  const status = stringField(raw.status);
  if (!status) return skip("not_a_line");
  if (!KNOWN_STATUSES.has(status)) return skip("unknown_status");
  if (isVoidMercuryStatus(status)) return skip("void_status");

  const kind = stringField(raw.kind);
  if (!kind || kind.length > TEXT_LIMITS.kind) return skip("not_a_line");

  const counterpartyId = bounded(stringField(raw.counterpartyId));
  const accountId = bounded(stringField(raw.accountId));
  if (stringField(raw.counterpartyId) && !counterpartyId) return skip("not_a_line");
  if (stringField(raw.accountId) && !accountId) return skip("not_a_line");
  if (counterpartyId && ctx.ownAccountIds.includes(counterpartyId)) {
    if (kind === "treasuryTransfer") return skip("treasury_transfer");
    if (kind === "internalTransfer") return skip("internal_transfer");
    return skip("own_account_transfer");
  }
  if (
    isCardAccountKind(kind) &&
    ctx.ownAccountIds.length > 0 &&
    (!accountId || !ctx.ownAccountIds.includes(accountId))
  ) {
    throw new MercuryCardAccountError();
  }
  if (ctx.ownAccountIds.length > 0 && (!accountId || !ctx.ownAccountIds.includes(accountId))) {
    return skip("not_own_account");
  }
  const currency = settledCurrency(raw);
  if (currency !== "USD") return skip("non_usd");

  const createdAt = stringField(raw.createdAt);
  if (!createdAt) return skip("not_a_line");
  let docDate: string;
  try {
    docDate = jerusalemDate(createdAt);
  } catch {
    return skip("not_a_line");
  }

  if (typeof raw.amount !== "number") return skip("refused_amount");
  const signed = dollarsToCents(raw.amount);
  if (signed == null) return skip("refused_amount");
  if (signed === 0) return skip("not_a_line");

  const pending = status === "pending";
  let cashDate: string | null = null;
  if (!pending) {
    const postedAt = stringField(raw.postedAt);
    if (!postedAt) return skip("not_a_line");
    try {
      cashDate = jerusalemDate(postedAt);
    } catch {
      return skip("not_a_line");
    }
  }

  const expenseCredit = isExpenseCreditKind(kind);
  const direction = expenseCredit || signed < 0 ? "expense" : "income";
  const docKind = expenseCredit ? "credit" : signed < 0 ? "expense" : "receipt";
  const name = stringField(raw.counterpartyName);
  if (name && name.length > TEXT_LIMITS.name) return skip("not_a_line");

  const descriptionSource = stringField(raw.bankDescription) ?? name ?? "";
  const description = String(redactMercury(descriptionSource)).slice(0, TEXT_LIMITS.description);
  const wireCategory = stringField(raw.mercuryCategory);
  const providerCategory = wireCategory && wireCategory.length <= TEXT_LIMITS.hint ? wireCategory : null;
  const category = mercuryCategoryHint({
    counterpartyName: name,
    direction,
    counterpartyId,
    ownCounterpartyIds: ctx.ownCounterpartyIds,
  });

  const line: CanonicalLine = {
    source: "mercury",
    external_id: id,
    direction,
    line_status: pending ? "pending" : "posted",
    doc_kind: docKind,
    pnl_role: null,
    currency,
    amount_original: Math.abs(signed),
    amount_negated: signed < 0,
    doc_date: docDate,
    cash_date: cashDate,
    source_account_id: accountId,
    counterparty: name
      ? {
        name,
        external_id: counterpartyId,
        kind: direction === "income" ? "customer" : "supplier",
      }
      : { name: null, external_id: counterpartyId, kind: null },
    description,
    vat: { amount: 0, status: "source" },
    project_hint: null,
    category_hint: category,
    linked_external_id: null,
    provider_meta: { kind, providerCategory },
  };

  const parsed = canonicalLineSchema.safeParse(line);
  if (!parsed.success) return skip("not_a_line");
  return { ok: true, line: parsed.data };
}

/**
 * Pending and posted are assumed to share a Mercury id.
 * The synthetic fixture is the evidence. A different id is the fallback:
 * void the stored row and insert the new one.
 */
export function settlementPlan(
  storedExternalId: string,
  incomingExternalId: string,
): { action: "update" } | { action: "void_and_reinsert"; voidId: string } {
  if (storedExternalId === incomingExternalId) return { action: "update" };
  return { action: "void_and_reinsert", voidId: storedExternalId };
}
