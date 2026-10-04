import type { Direction } from "../types.ts";

/**
 * Loan servicers, matched on the normalised counterparty name.
 * The match is a prefix: NEWREZ-EXAMPLE, Lakeview Loan Servicing, Servease.
 */
export const MERCURY_LOAN_COUNTERPARTY_PREFIXES = ["NEWREZ", "LAKEVIEW LOAN", "SERVEASE"] as const;

/** Seeded expense category. excluded_from_pnl. The engine matches kind and name. */
export const MERCURY_LOAN_CATEGORY = "תשלומי הלוואה";

/** Counterparty names, after the same normalisation, that are cashback income. */
export const MERCURY_CASHBACK_COUNTERPARTIES = ["MERCURY IO CASHBACK"] as const;

/** Seeded income category. It stays in P&L. VAT stays 0. Cashback and treasury yield use it. */
export const MERCURY_CASHBACK_CATEGORY = "הכנסה אחרת";

/** Treasury ledger types that are cash yield. They import as income. */
export const MERCURY_TREASURY_YIELD_TYPES = ["interestPosted", "dividendPosted"] as const;

/**
 * Transfer to an own account that is not in the connected set.
 * Expense and income categories share this name. Both are off P&L.
 */
export const MERCURY_TRANSFER_CATEGORY = "העברות";

/**
 * A card refund stays an expense with doc_kind credit.
 * debitCardCredit is the debit-card twin of creditCardCredit.
 */
export const MERCURY_CARD_REFUND_KINDS = ["creditCardCredit", "debitCardCredit"] as const;

/**
 * A fee rebate, and a reversal of a fee, are expense credits.
 * They are not income. A rebate reversal is the fee coming back, so it
 * follows the sign instead of this list.
 */
export const MERCURY_FEE_CREDIT_KINDS = [
  "cardInternationalTransactionFeeRebate",
  "cardInternationalTransactionFeeReversal",
] as const;

/** Card spend and card fees post on a card or checking account the connection must list. */
export const MERCURY_CARD_ACCOUNT_KINDS = [
  "creditCardTransaction",
  "debitCardTransaction",
  "creditCardCredit",
  "debitCardCredit",
  "cardInternationalTransactionFee",
  "cardInternationalTransactionFeeRebate",
  "cardInternationalTransactionFeeReversal",
  "cardInternationalTransactionFeeRebateReversal",
] as const;

export const MERCURY_VOID_STATUSES = ["cancelled", "failed", "reversed", "blocked"] as const;

export function isVoidMercuryStatus(status: string): boolean {
  return (MERCURY_VOID_STATUSES as readonly string[]).includes(status);
}

export function isCardRefundKind(kind: string): boolean {
  return (MERCURY_CARD_REFUND_KINDS as readonly string[]).includes(kind);
}

export function isExpenseCreditKind(kind: string): boolean {
  return isCardRefundKind(kind) || (MERCURY_FEE_CREDIT_KINDS as readonly string[]).includes(kind);
}

export function isCardAccountKind(kind: string): boolean {
  return (MERCURY_CARD_ACCOUNT_KINDS as readonly string[]).includes(kind);
}

export function isTreasuryYieldType(type: string): boolean {
  return (MERCURY_TREASURY_YIELD_TYPES as readonly string[]).includes(type);
}

/** Trim, collapse whitespace, and compare case-insensitively. */
export function normaliseCounterpartyName(name: string): string {
  return name.normalize("NFKC").replace(/\s+/g, " ").trim().toUpperCase();
}

export function mercuryCategoryHint(input: {
  counterpartyName: string | null;
  direction: Direction;
  counterpartyId: string | null;
  ownCounterpartyIds: readonly string[];
}): string | null {
  const normalised = input.counterpartyName ? normaliseCounterpartyName(input.counterpartyName) : "";
  if (input.direction === "expense" && normalised) {
    for (const prefix of MERCURY_LOAN_COUNTERPARTY_PREFIXES) {
      if (normalised.startsWith(prefix)) return MERCURY_LOAN_CATEGORY;
    }
  }
  if (
    input.direction === "income" &&
    (MERCURY_CASHBACK_COUNTERPARTIES as readonly string[]).includes(normalised)
  ) {
    return MERCURY_CASHBACK_CATEGORY;
  }
  if (input.counterpartyId && input.ownCounterpartyIds.includes(input.counterpartyId)) {
    return MERCURY_TRANSFER_CATEGORY;
  }
  return null;
}
