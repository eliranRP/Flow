// MCP tools: loan reads (rows, schedules, payments) and the add, update and attach loan writes.
// Split out of tools.ts (FLOW-807). Decision 0080.

import {
  buildLoanSchedule,
  demandAccrual,
  LoanScheduleError,
  monthlyPaymentMinor,
  regularPaymentMinor,
  type DemandPayment,
  type LoanKind,
  type LoanRate,
  type LoanScheduleRow,
} from "../../../packages/shared/src/loan-schedule.ts";
import {
  allocateLoanSplitWithFees,
  firstUnpaidRowIndex,
  loanTakesPaymentOn,
  paidInterestAndPrincipal,
  scheduleRowForDate,
  sumScheduleRows,
} from "../../../packages/shared/src/loan-split.ts";
import type { LoanSplitAmount, LoanStatus, ScheduledSum } from "../../../packages/shared/src/loan-split.ts";
import {
  companyCurrency,
  decimalText,
  envelopeOf,
  fail,
  majorString,
  minorFromMajor,
  named,
  minorFromMajorNonNegative,
  ok,
  ppmFromPercent,
  READ_REFUSED,
  scheduleRowOut,
  todayIso,
  type ToolResult,
  type ToolRpc,
  WRITE_REFUSED,
} from "./tools_args.ts";
import { addLoanSchema, attachLoanSchema, invalidFields, updateLoanSchema } from "./tools_schemas.ts";

// What an amount or percent field takes, for a refusal that names it (FLOW-414).
const ABOVE_ZERO = "an amount above zero, at most two decimals";
const ZERO_OR_MORE = "an amount of zero or more, at most two decimals";
const PERCENT = "a percent from 0 to 100, at most four decimals";

type LoanRow = {
  id: string;
  name: string;
  currency: string;
  principal_minor: number;
  annual_rate_ppm: number;
  /** Null for a demand loan only. */
  term_months: number | null;
  start_date: string;
  /** Null for a demand loan only. */
  payment_minor: number | null;
  escrow_minor: number;
  balance_minor: number;
  flagged_parts?: number;
  flagged_transaction_ids?: string[];
  project_id?: string | null;
  project_name?: string | null;
  status?: LoanStatus;
  closed_on?: string | null;
  interest_category_id?: string | null;
  escrow_category_id?: string | null;
  principal_category_id?: string | null;
  fees_category_id?: string | null;
  /** Absent on a row from before decision 0132: amortizing. */
  kind?: LoanKind;
  interest_only_months?: number | null;
  amortization_months?: number | null;
  rates?: Array<{ id?: string; effective_date: string; annual_rate_ppm: number }>;
};

export function loanKindOf(loan: LoanRow): LoanKind {
  return loan.kind ?? "amortizing";
}

function loanRatesOf(loan: LoanRow): LoanRate[] {
  return (loan.rates ?? []).map((rate) => ({ effectiveDate: rate.effective_date, annualRatePpm: rate.annual_rate_ppm }));
}

/** A stored loan whose terms no longer build a schedule, for example one saved before FLOW-111. */
export function storedLoanSchedule(loan: LoanRow): ReturnType<typeof buildLoanSchedule> | ToolResult {
  if (loanKindOf(loan) === "demand" || loan.term_months == null || loan.payment_minor == null) {
    return fail("refused", "a demand loan has no schedule rows");
  }
  try {
    return buildLoanSchedule({
      principalMinor: BigInt(loan.principal_minor),
      annualRatePpm: loan.annual_rate_ppm,
      termMonths: loan.term_months,
      startDate: loan.start_date,
      paymentMinor: BigInt(loan.payment_minor),
      escrowMinor: BigInt(loan.escrow_minor),
      kind: loanKindOf(loan),
      interestOnlyMonths: loan.interest_only_months ?? null,
      amortizationMonths: loan.amortization_months ?? null,
      rates: loanRatesOf(loan),
    });
  } catch (error) {
    if (error instanceof LoanScheduleError && error.code === "payment_below_interest") {
      return fail("refused", "payment below interest");
    }
    if (error instanceof LoanScheduleError) return fail("refused", "invalid loan terms");
    throw error;
  }
}

/**
 * A loan as `list_loans` shows it. `payment_minor` is the monthly payment: on an
 * interest_only loan whose interest-only months are the term, the interest at the rate
 * in force today plus escrow, not the stored bullet the schedule pays at the term (FLOW-136).
 */
export function listedLoan(loan: LoanRow): LoanRow {
  if (loan.payment_minor == null || loan.term_months == null) return loan;
  const paymentMinor = monthlyPaymentMinor({
    principalMinor: BigInt(loan.principal_minor),
    annualRatePpm: loan.annual_rate_ppm,
    termMonths: loan.term_months,
    paymentMinor: BigInt(loan.payment_minor),
    escrowMinor: BigInt(loan.escrow_minor),
    kind: loanKindOf(loan),
    interestOnlyMonths: loan.interest_only_months ?? null,
    rates: loanRatesOf(loan),
    asOf: todayIso(),
  });
  return { ...loan, payment_minor: Number(paymentMinor) };
}

export async function loadLoans(rpc: ToolRpc): Promise<ToolResult | LoanRow[]> {
  const result = await rpc("mcp_list_loans", {});
  if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  return result.json as LoanRow[];
}

/** One attached payment of a loan, from `mcp_loan_payments` (oldest first). */
type LoanPaymentRow = {
  transaction_id: string;
  doc_date: string;
  line_status: string;
  needs_review: boolean;
  interest_minor: number;
  escrow_minor: number;
  principal_minor: number;
  fees_minor: number;
};

export async function loadLoanPayments(loanId: string, rpc: ToolRpc): Promise<ToolResult | LoanPaymentRow[]> {
  const result = await rpc("mcp_loan_payments", { p_loan_id: loanId });
  if (result.status >= 400 || !Array.isArray(result.json)) return fail("refused", READ_REFUSED);
  return result.json as LoanPaymentRow[];
}

/** Payments that count: not waiting for review, and not the line being attached. */
export function countedPayments(payments: LoanPaymentRow[], exceptTransactionId: string | null): LoanPaymentRow[] {
  return payments.filter((row) => !row.needs_review && row.transaction_id !== exceptTransactionId);
}

export function demandPaymentsOf(payments: LoanPaymentRow[]): DemandPayment[] {
  return payments.map((row) => ({
    date: row.doc_date,
    interestMinor: BigInt(row.interest_minor),
    escrowMinor: BigInt(row.escrow_minor),
    principalMinor: BigInt(row.principal_minor),
    feesMinor: BigInt(row.fees_minor),
  }));
}

export function demandTermsOf(loan: LoanRow) {
  return {
    principalMinor: BigInt(loan.principal_minor),
    annualRatePpm: loan.annual_rate_ppm,
    startDate: loan.start_date,
    rates: loanRatesOf(loan),
  };
}

export async function addLoanWrite(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = addLoanSchema.safeParse(args);
  if (!parsed.success) return invalidFields(parsed.error);
  const kind = parsed.data.kind ?? "amortizing";
  const principalMinor = named(minorFromMajor(parsed.data.principal), "principal", ABOVE_ZERO);
  if (typeof principalMinor !== "bigint") return principalMinor;
  const ratePpm = named(ppmFromPercent(parsed.data.annual_rate_percent), "annual_rate_percent", PERCENT);
  if (typeof ratePpm !== "number") return ratePpm;
  const escrowMinor = named(minorFromMajorNonNegative(parsed.data.escrow, 0n), "escrow", ZERO_OR_MORE);
  if (typeof escrowMinor !== "bigint") return escrowMinor;
  // A demand loan has no term and no fixed payment (decision 0132).
  let paymentMinor: bigint | null = null;
  let preview: LoanScheduleRow[] = [];
  if (kind === "demand") {
    try {
      demandAccrual({ principalMinor, annualRatePpm: ratePpm, startDate: parsed.data.start_date }, [], parsed.data.start_date);
    } catch (error) {
      if (error instanceof LoanScheduleError) return fail("validation", error.code);
      return fail("validation", "validation");
    }
  } else {
    const termMonths = parsed.data.term_months ?? 0;
    const kindFields = {
      kind,
      interestOnlyMonths: parsed.data.interest_only_months ?? null,
      amortizationMonths: parsed.data.amortization_months ?? null,
    };
    if (parsed.data.payment == null) {
      try {
        paymentMinor = regularPaymentMinor({ principalMinor, annualRatePpm: ratePpm, termMonths, escrowMinor, ...kindFields });
      } catch (error) {
        if (error instanceof LoanScheduleError) return fail("validation", error.code);
        return fail("validation", "validation");
      }
    } else {
      const given = named(minorFromMajor(parsed.data.payment), "payment", ABOVE_ZERO);
      if (typeof given !== "bigint") return given;
      paymentMinor = given;
    }
    try {
      preview = buildLoanSchedule({
        principalMinor,
        annualRatePpm: ratePpm,
        termMonths,
        startDate: parsed.data.start_date,
        paymentMinor,
        escrowMinor,
        ...kindFields,
      }).rows.slice(0, 3);
    } catch (error) {
      if (error instanceof LoanScheduleError) return fail("validation", error.code);
      return fail("validation", "validation");
    }
  }
  let currency = parsed.data.currency;
  if (currency == null) {
    const defaulted = await companyCurrency(rpc);
    if (typeof defaulted !== "string") return defaulted;
    currency = defaulted;
  }
  const result = await rpc("mcp_add_loan", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_name: parsed.data.name,
    p_principal_minor: Number(principalMinor),
    p_annual_rate_ppm: ratePpm,
    p_term_months: parsed.data.term_months ?? null,
    p_start_date: parsed.data.start_date,
    p_payment_minor: paymentMinor == null ? null : Number(paymentMinor),
    p_escrow_minor: Number(escrowMinor),
    p_currency: currency,
    ...(parsed.data.project_id == null ? {} : { p_project_id: parsed.data.project_id }),
    // Sent only for a new kind, so an amortizing loan's call is the same as before.
    ...(kind === "amortizing" ? {} : {
      p_kind: kind,
      p_interest_only_months: parsed.data.interest_only_months ?? null,
      p_amortization_months: parsed.data.amortization_months ?? null,
    }),
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  const wrapped = envelopeOf(result.json);
  if (wrapped.isError) return wrapped;
  const data = (wrapped.structuredContent as { ok: true; data: Record<string, unknown> }).data;
  return ok({
    ...data,
    payment: paymentMinor == null ? null : majorString(paymentMinor),
    payment_minor: paymentMinor == null ? null : Number(paymentMinor),
    schedule_preview: preview.map(scheduleRowOut),
  });
}

export async function updateLoanWrite(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = updateLoanSchema.safeParse(args);
  if (!parsed.success) return invalidFields(parsed.error);
  const patch: Record<string, unknown> = {};
  if (parsed.data.name != null) patch.name = parsed.data.name;
  if (parsed.data.principal != null) {
    const minor = named(minorFromMajor(parsed.data.principal), "principal", ABOVE_ZERO);
    if (typeof minor !== "bigint") return minor;
    patch.principal_minor = Number(minor);
  }
  if (parsed.data.annual_rate_percent != null) {
    const ppm = named(ppmFromPercent(parsed.data.annual_rate_percent), "annual_rate_percent", PERCENT);
    if (typeof ppm !== "number") return ppm;
    patch.annual_rate_ppm = ppm;
  }
  if (parsed.data.term_months != null) patch.term_months = parsed.data.term_months;
  if (parsed.data.start_date != null) patch.start_date = parsed.data.start_date;
  if (parsed.data.payment != null) {
    const minor = named(minorFromMajor(parsed.data.payment), "payment", ABOVE_ZERO);
    if (typeof minor !== "bigint") return minor;
    patch.payment_minor = Number(minor);
  }
  if (parsed.data.escrow != null) {
    const minor = named(minorFromMajorNonNegative(parsed.data.escrow), "escrow", ZERO_OR_MORE);
    if (typeof minor !== "bigint") return minor;
    patch.escrow_minor = Number(minor);
  }
  if (parsed.data.project_id !== undefined) patch.project_id = parsed.data.project_id;
  if (parsed.data.status != null) patch.status = parsed.data.status;
  if (parsed.data.closed_on !== undefined) patch.closed_on = parsed.data.closed_on;
  for (const key of ["interest_category_id", "escrow_category_id", "principal_category_id", "fees_category_id"] as const) {
    if (parsed.data[key] !== undefined) patch[key] = parsed.data[key];
  }
  // A kind change clears the fields the new kind does not have (decision 0132).
  if (parsed.data.interest_only_months !== undefined) patch.interest_only_months = parsed.data.interest_only_months;
  if (parsed.data.amortization_months !== undefined) patch.amortization_months = parsed.data.amortization_months;
  if (parsed.data.kind != null) {
    patch.kind = parsed.data.kind;
    if (parsed.data.kind !== "interest_only") patch.interest_only_months = null;
    if (parsed.data.kind !== "balloon") patch.amortization_months = null;
    if (parsed.data.kind === "demand") {
      patch.term_months = null;
      patch.payment_minor = null;
      patch.escrow_minor = 0;
    }
  }
  if (Object.keys(patch).length === 0) return fail("validation", "arguments: nothing to change");
  const result = await rpc("mcp_update_loan", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_loan_id: parsed.data.loan_id,
    p_patch: patch,
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  return envelopeOf(result.json);
}

/** The exact parts of attach_loan_payment, in minor units. Fees, when given, are above zero. */
type ExactLoanParts = { interest: bigint; escrow: bigint; principal: bigint; fees: bigint | null };

/** More than two decimals: exact loan parts and fees are not rounded, they are refused. */
function hasSubCent(value: number | string): boolean {
  return /\.\d{3,}$/.test(decimalText(value).trim().replace(/[\s,]/g, ""));
}

/** An exact amount: two decimals at most, above zero when `positive`. A refusal names `field`. */
function exactMinorOf(value: number | string, positive: boolean, field: string): bigint | ToolResult {
  const takes = `${positive ? ABOVE_ZERO : ZERO_OR_MORE}, not rounded`;
  if (hasSubCent(value)) return fail("validation", `${field}: ${takes}`);
  return named(positive ? minorFromMajor(value) : minorFromMajorNonNegative(value), field, takes);
}

function exactLoanPartsOf(parts: {
  interest: number | string;
  escrow: number | string;
  principal: number | string;
  fees?: number | string;
}): ExactLoanParts | ToolResult {
  const interest = exactMinorOf(parts.interest, false, "parts.interest");
  if (typeof interest !== "bigint") return interest;
  const escrow = exactMinorOf(parts.escrow, false, "parts.escrow");
  if (typeof escrow !== "bigint") return escrow;
  const principal = exactMinorOf(parts.principal, false, "parts.principal");
  if (typeof principal !== "bigint") return principal;
  if (parts.fees === undefined) return { interest, escrow, principal, fees: null };
  const fees = exactMinorOf(parts.fees, true, "parts.fees");
  if (typeof fees !== "bigint") return fees;
  return { interest, escrow, principal, fees };
}

/**
 * Whether this line is already split on this loan (`split`), and the principal it already
 * counts toward the loan's balance: a replay of the same attach then sees the balance as it
 * was the first time, so installments start on the same row and the payload rebuilds the
 * same. A split that needs review does not count in the balance, so it adds nothing.
 */
async function principalAlreadyAttached(
  transactionId: string,
  loanId: string,
  rpc: ToolRpc,
): Promise<{ split: boolean; principalMinor: bigint } | ToolResult> {
  const result = await rpc("get_loan_split", { p_transaction_id: transactionId });
  if (result.status >= 400) return fail("refused", READ_REFUSED);
  const split = result.json as { loan_id?: unknown; needs_review?: unknown; parts?: unknown } | null;
  if (split == null || typeof split !== "object" || split.loan_id !== loanId) {
    return { split: false, principalMinor: 0n };
  }
  if (split.needs_review === true || !Array.isArray(split.parts)) return { split: true, principalMinor: 0n };
  for (const part of split.parts as Array<{ part?: unknown; amount_minor?: unknown }>) {
    if (part.part === "principal" && typeof part.amount_minor === "number") {
      return { split: true, principalMinor: BigInt(part.amount_minor) };
    }
  }
  return { split: true, principalMinor: 0n };
}

export async function attachLoanWrite(args: Record<string, unknown>, rpc: ToolRpc): Promise<ToolResult> {
  const parsed = attachLoanSchema.safeParse(args);
  if (!parsed.success) return invalidFields(parsed.error);
  // Amounts are checked before anything is read: fees above zero, exact parts zero or more.
  let feesMinor = 0n;
  if (parsed.data.fees !== undefined) {
    const fees = exactMinorOf(parsed.data.fees, true, "fees");
    if (typeof fees !== "bigint") return fees;
    feesMinor = fees;
  }
  let exact: ExactLoanParts | null = null;
  if (parsed.data.parts !== undefined) {
    const given = exactLoanPartsOf(parsed.data.parts);
    if (!("interest" in given)) return given;
    exact = given;
  }
  const txnResult = await rpc("get_transaction", { p_id: parsed.data.transaction_id });
  if (txnResult.status >= 400) return fail("refused", READ_REFUSED);
  if (txnResult.json == null || typeof txnResult.json !== "object" || Array.isArray(txnResult.json)) {
    return fail("not_found", "not found");
  }
  const txn = txnResult.json as Record<string, unknown>;
  const docDate = typeof txn.doc_date === "string" ? txn.doc_date : null;
  const lineMinorRaw = txn.amount_original;
  const currency = typeof txn.currency === "string" ? txn.currency : null;
  if (docDate == null || typeof lineMinorRaw !== "number" || currency == null) {
    return fail("refused", WRITE_REFUSED);
  }
  const lineMinor = BigInt(lineMinorRaw);
  const loans = await loadLoans(rpc);
  if (!Array.isArray(loans)) return loans;
  const loan = loans.find((row) => row.id === parsed.data.loan_id);
  if (loan == null) return fail("refused", "loan not found");
  if (loan.currency !== currency) return fail("refused", "loan currency mismatch");
  if (!loanTakesPaymentOn({ status: loan.status, closedOn: loan.closed_on }, docDate)) {
    return fail("refused", "loan closed");
  }
  const attached = await principalAlreadyAttached(parsed.data.transaction_id, loan.id, rpc);
  if (!("split" in attached)) return attached;
  // The balance before this line's own split, if it is already attached (an idempotent replay).
  let balanceMinor = BigInt(loan.balance_minor) + attached.principalMinor;
  if (balanceMinor <= 0n) return fail("refused", "loan balance exceeded");
  // The scheduled figures: several rows from the first unpaid one, the row for the date, or
  // for a demand loan the interest accrued since the last payment (decision 0132).
  let scheduled: ScheduledSum | null;
  if (loanKindOf(loan) === "demand") {
    if (parsed.data.installments !== undefined) return fail("refused", "a demand loan has no schedule rows");
    if (docDate < loan.start_date) return fail("refused", "payment before the loan start");
    const payments = await loadLoanPayments(loan.id, rpc);
    if (!Array.isArray(payments)) return payments;
    const counted = countedPayments(payments, parsed.data.transaction_id);
    // Interest runs from the last payment, so payments are attached in date order. A line
    // already split on this loan is a replay (or a refused re-attach): the database answers
    // it, and the payments dated after it do not change its accrual.
    if (!attached.split && counted.some((row) => row.doc_date > docDate)) {
      return fail("refused", "a later payment is already attached");
    }
    // The interest accrued since the last payment, plus what earlier payments left unpaid.
    const accrual = demandAccrual(demandTermsOf(loan), demandPaymentsOf(counted), docDate);
    // Pending payments lower it too, so two quick attaches do not both take the same principal.
    if (accrual.balanceMinor < balanceMinor) balanceMinor = accrual.balanceMinor;
    if (balanceMinor <= 0n) return fail("refused", "loan balance exceeded");
    const left = lineMinor - feesMinor - accrual.interestMinor;
    scheduled = {
      interestMinor: accrual.interestMinor,
      escrowMinor: 0n,
      principalMinor: left < 0n ? 0n : left,
    };
  } else {
    const schedule = storedLoanSchedule(loan);
    if (!("rows" in schedule)) return schedule;
    if (parsed.data.installments !== undefined) {
      // FLOW-135 N1: interest plus principal paid so far, pending lines too (decision 0132).
      const payments = await loadLoanPayments(loan.id, rpc);
      if (!Array.isArray(payments)) return payments;
      const paidMinor = paidInterestAndPrincipal(payments.map((row) => ({
        transactionId: row.transaction_id,
        interestMinor: BigInt(row.interest_minor),
        principalMinor: BigInt(row.principal_minor),
        needsReview: row.needs_review,
      })), parsed.data.transaction_id);
      const start = firstUnpaidRowIndex(schedule.rows, paidMinor);
      scheduled = start < 0 ? null : sumScheduleRows(schedule.rows, start, parsed.data.installments);
      if (scheduled == null) return fail("refused", "not enough schedule rows");
    } else {
      scheduled = scheduleRowForDate(schedule.rows, docDate);
      // FLOW-135 N3: exact parts need no row; their scheduled figures are then 0.
      if (scheduled == null && exact != null) scheduled = { interestMinor: 0n, escrowMinor: 0n, principalMinor: 0n };
      if (scheduled == null) return fail("refused", "no schedule row for this date");
    }
  }
  let parts: readonly LoanSplitAmount[];
  if (exact != null) {
    if (exact.interest + exact.escrow + exact.principal + (exact.fees ?? 0n) !== lineMinor) {
      return fail("refused", "parts don't add up");
    }
    parts = [
      { part: "interest", amountMinor: exact.interest, scheduledMinor: scheduled.interestMinor },
      { part: "escrow", amountMinor: exact.escrow, scheduledMinor: scheduled.escrowMinor },
      { part: "principal", amountMinor: exact.principal, scheduledMinor: scheduled.principalMinor },
      ...(exact.fees == null ? [] : [{ part: "fees" as const, amountMinor: exact.fees, scheduledMinor: exact.fees }]),
    ];
  } else {
    const allocated = allocateLoanSplitWithFees({
      lineMinor,
      feesMinor,
      interestMinor: scheduled.interestMinor,
      escrowMinor: scheduled.escrowMinor,
      principalMinor: scheduled.principalMinor,
    });
    if (allocated == null) return fail("refused", "fees exceed the line");
    parts = allocated;
  }
  const principalPart = parts.find((part) => part.part === "principal")?.amountMinor ?? 0n;
  if (principalPart > balanceMinor) return fail("refused", "loan balance exceeded");
  // Fees go to this call's category, else the loan's. There is no default (decision 0130).
  const hasFees = parts.some((part) => part.part === "fees");
  const callFeesCategory = parsed.data.fees_category_id ?? null;
  if (hasFees && callFeesCategory == null && (loan.fees_category_id ?? null) == null) {
    return fail("refused", "fees category required");
  }
  const payload = parts.map((part) => ({
    part: part.part,
    amount_minor: Number(part.amountMinor),
    scheduled_minor: Number(part.scheduledMinor),
    ...(part.part === "fees" && callFeesCategory != null ? { category_id: callFeesCategory } : {}),
  }));
  const result = await rpc("mcp_attach_loan_payment", {
    p_idempotency_key: parsed.data.idempotency_key,
    p_transaction_id: parsed.data.transaction_id,
    p_loan_id: parsed.data.loan_id,
    p_parts: payload,
  });
  if (result.status >= 400) return fail("refused", WRITE_REFUSED);
  const wrapped = envelopeOf(result.json);
  if (wrapped.isError) return wrapped;
  return ok({
    ...(wrapped.structuredContent as { ok: true; data: Record<string, unknown> }).data,
    parts: payload.map((part) => ({
      part: part.part,
      ...("category_id" in part ? { category_id: part.category_id } : {}),
      amount: majorString(BigInt(part.amount_minor)),
      scheduled: majorString(BigInt(part.scheduled_minor)),
      amount_minor: part.amount_minor,
      scheduled_minor: part.scheduled_minor,
    })),
  });
}
