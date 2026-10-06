import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import {
  allocateLoanSplit,
  buildLoanSchedule,
  LOAN_ESCROW_CATEGORY,
  LOAN_INTEREST_CATEGORY,
  LOAN_PRINCIPAL_CATEGORY,
  scheduleRowForDate,
  type LoanSplitPart,
} from "@flow/shared";
import { BankIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { Button } from "../ui/button";
import { useSheetHistory } from "../ui/back";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { useHoldWrites } from "../use-is-viewer";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";

const PART_LABEL: Record<LoanSplitPart, string> = {
  interest: "ריבית",
  escrow: "מסים וביטוח",
  principal: "קרן",
};

const PART_CATEGORY: Record<LoanSplitPart, string> = {
  interest: LOAN_INTEREST_CATEGORY,
  escrow: LOAN_ESCROW_CATEGORY,
  principal: LOAN_PRINCIPAL_CATEGORY,
};

type SplitRow = {
  id: string;
  part: LoanSplitPart;
  amountMinor: bigint;
  scheduledMinor: bigint;
  needsReview: boolean;
  loanId: string;
};

type LoanChoice = {
  id: string;
  name: string;
  currency: string;
  principalMinor: number;
  annualRatePpm: number;
  termMonths: number;
  startDate: string;
  paymentMinor: number;
  escrowMinor: number;
};

export type LoanBalanceRow = {
  id: string;
  name: string;
  currency: string;
  balanceMinor: bigint;
  flaggedParts: number;
};

function asCurrency(currency: string): LoanCurrency | null {
  if (currency === "ILS" || currency === "USD") return currency;
  return null;
}

function showMoney(minor: bigint, currency: string): string {
  const known = asCurrency(currency);
  if (known) return formatLoanMoney(minor, known);
  return `${currency} ${formatLoanMoney(minor, "ILS").replace("₪", "")}`;
}

export function LoanSplitPanel({
  offerMatch,
  currency,
  parts,
  loans,
  needsReview,
  currencyMismatch,
  busy,
  readOnly = false,
  onMatch,
  onCorrect,
}: {
  offerMatch: boolean;
  currency: string;
  parts: readonly SplitRow[] | null;
  loans: readonly LoanChoice[];
  needsReview: boolean;
  currencyMismatch: boolean;
  busy: boolean;
  /** A viewer can read the split and cannot match or correct it. */
  readOnly?: boolean;
  onMatch: (loanId: string) => void;
  onCorrect: () => void;
}) {
  const [open, setOpen] = useState(false);
  const setSheet = useSheetHistory("loan-match", open, setOpen);
  const rowRef = useRef<HTMLButtonElement>(null);
  if (parts == null && (!offerMatch || readOnly)) return null;
  const ordered = parts == null ? [] : (["interest", "escrow", "principal"] as const).flatMap((part) => {
    const row = parts.find((item) => item.part === part);
    return row ? [row] : [];
  });
  return (
    <>
      <List>
        {ordered.length > 0 ? ordered.map((part) => (
          <ListRow
            key={part.part}
            variant="static"
            title={PART_LABEL[part.part]}
            meta={<bdi className="ui-num ui-loan-amount" dir="ltr">{showMoney(part.amountMinor, currency)}</bdi>}
          />
        )) : (
          <ListRow
            variant="button"
            title="שיוך להלוואה"
            icon={<BankIcon />}
            chevron
            buttonRef={rowRef}
            onClick={() => { if (!readOnly) setSheet(true); }}
          />
        )}
      </List>
      {needsReview ? (
        <div className="ui-stack ui-page-pad">
          <p className="t-hint ui-loan-caution">החלוקה ממתינה לבדיקה.</p>
          {currencyMismatch ? (
            <p className="t-hint">המטבע של השורה לא מתאים להלוואה.</p>
          ) : readOnly ? null : (
            <Button type="button" variant="secondary" busy={busy} onClick={onCorrect}>עדכון החלוקה</Button>
          )}
        </div>
      ) : null}
      {readOnly ? null : (
      <Sheet open={open} onOpenChange={setSheet} title="שיוך להלוואה" returnFocusRef={rowRef}>
        {loans.length === 0 ? (
          <p className="t-hint">אין עדיין הלוואה.</p>
        ) : (
          <List>
            {loans.map((loan) => (
              <ListRow
                key={loan.id}
                variant="button"
                title={loan.name}
                chevron
                onClick={() => {
                  onMatch(loan.id);
                  setSheet(false);
                }}
              />
            ))}
          </List>
        )}
      </Sheet>
      )}
    </>
  );
}

export function LoanBalanceList({ rows }: { rows: readonly LoanBalanceRow[] }) {
  if (rows.length === 0) return null;
  return (
    <List>
      {rows.map((row) => (
        <ListRow
          key={row.id}
          variant="static"
          title={row.name}
          icon={<BankIcon />}
          tone={row.flaggedParts > 0 ? "warning" : undefined}
          hint={row.flaggedParts > 0 ? "ממתין לבדיקה" : undefined}
          meta={<bdi className="ui-num ui-loan-amount" dir="ltr">{showMoney(row.balanceMinor, row.currency)}</bdi>}
        />
      ))}
    </List>
  );
}

function failureText(error: Error): string {
  const code = (error as { code?: string }).code;
  if (code === "42501") return "אין הרשאה לשייך הלוואה.";
  if (error.message.includes("loan_split_currency")) return "המטבע של השורה לא מתאים להלוואה.";
  if (error.message.includes("loan_split_sum")) return "החלוקה לא מסתכמת לשורה.";
  if (error.message === "date") return "התאריך לא על לוח הסילוקין.";
  return "לא הצלחנו לשייך את ההלוואה.";
}

export function LoanTransactionSplit({
  transactionId,
  docDate,
  categoryName,
  direction,
  active,
  readOnly = false,
}: {
  transactionId: string;
  docDate: string;
  categoryName: string;
  direction: string;
  active: boolean;
  /** From the transaction screen. A viewer, and a role that is still loading, pass true. */
  readOnly?: boolean;
}) {
  const holdWrites = useHoldWrites();
  const writesHeld = readOnly || holdWrites;
  const offerMatch = direction !== "income" && categoryName === LOAN_PRINCIPAL_CATEGORY;
  const query = useQuery({
    queryKey: ["loan-split", transactionId],
    enabled: active && direction !== "income",
    retry: false,
    queryFn: () => readLoanMatch(transactionId),
  });
  const match = useWrite<string>({
    failure: failureText,
    success: "התשלום שויך להלוואה",
    keys: ["loan-split", "loans", "txn"],
    run: async (loanId) => {
      if (writesHeld) throw new Error("preview");
      const loaded = query.data;
      if (!loaded) throw new Error("supabase");
      const loan = loaded.loans.find((item) => item.id === loanId);
      if (!loan) throw new Error("supabase");
      await writeSplit(transactionId, docDate, loaded, loan);
    },
  });
  const correct = useWrite({
    failure: failureText,
    success: "החלוקה עודכנה",
    keys: ["loan-split", "loans", "txn"],
    run: async () => {
      if (writesHeld) throw new Error("preview");
      const loaded = query.data;
      if (!loaded || loaded.splits.length !== 3) throw new Error("supabase");
      await correctSplit(transactionId, loaded);
    },
  });
  if (!active || direction === "income") return null;
  const loaded = query.data;
  const parts = loaded && loaded.splits.length === 3 ? loaded.splits : null;
  if (parts == null && !offerMatch) return null;
  const loan = loaded?.loans.find((item) => item.id === parts?.[0]?.loanId);
  const currency = loaded?.currency ?? loan?.currency ?? "ILS";
  return (
    <LoanSplitPanel
      offerMatch={offerMatch}
      currency={currency}
      parts={parts}
      loans={loaded?.loans ?? []}
      needsReview={parts?.some((part) => part.needsReview) ?? false}
      currencyMismatch={loan != null && loan.currency !== currency}
      busy={match.isPending || correct.isPending}
      readOnly={writesHeld}
      onMatch={(loanId) => { if (!writesHeld) match.mutate(loanId); }}
      onCorrect={() => { if (!writesHeld) correct.mutate(); }}
    />
  );
}

export function useLoanBalances(companyId: string | null) {
  return useQuery({
    queryKey: ["loans", companyId],
    enabled: companyId != null,
    retry: false,
    queryFn: async (): Promise<LoanBalanceRow[]> => {
      const supabase = getSupabase();
      if (!supabase || companyId == null) return [];
      const loans = await supabase.from("loans").select("id, name, currency").eq("company_id", companyId);
      assertNoError(loans);
      const balances = await supabase.from("loan_balances").select("loan_id, balance_minor, flagged_parts, currency");
      assertNoError(balances);
      const byLoan = new Map((balances.data ?? []).map((row) => [row.loan_id, row]));
      return (loans.data ?? []).map((loan) => {
        const balance = byLoan.get(loan.id);
        return {
          id: loan.id,
          name: loan.name,
          currency: balance?.currency ?? loan.currency,
          balanceMinor: BigInt(balance?.balance_minor ?? 0),
          flaggedParts: balance?.flagged_parts ?? 0,
        };
      });
    },
  });
}

type LoadedMatch = {
  companyId: string;
  lineMinor: bigint;
  currency: string;
  splits: SplitRow[];
  loans: LoanChoice[];
  categoryIds: Partial<Record<LoanSplitPart, string>>;
};

async function readLoanMatch(transactionId: string): Promise<LoadedMatch> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const txn = await supabase
    .from("transactions")
    .select("company_id, amount_original, currency")
    .eq("id", transactionId)
    .single();
  assertNoError(txn);
  if (!txn.data) throw new Error("supabase");
  const companyId = txn.data.company_id;
  const [splits, loans, categories] = await Promise.all([
    supabase
      .from("loan_splits")
      .select("id, part, amount_minor, scheduled_minor, needs_review, loan_id")
      .eq("transaction_id", transactionId),
    supabase
      .from("loans")
      .select("id, name, currency, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor")
      .eq("company_id", companyId),
    supabase
      .from("categories")
      .select("id, name")
      .eq("company_id", companyId)
      .eq("kind", "expense")
      .in("name", [LOAN_INTEREST_CATEGORY, LOAN_ESCROW_CATEGORY, LOAN_PRINCIPAL_CATEGORY]),
  ]);
  assertNoError(splits);
  assertNoError(loans);
  assertNoError(categories);
  const categoryIds: Partial<Record<LoanSplitPart, string>> = {};
  for (const category of categories.data ?? []) {
    const part = (Object.keys(PART_CATEGORY) as LoanSplitPart[]).find((key) => PART_CATEGORY[key] === category.name);
    if (part) categoryIds[part] = category.id;
  }
  return {
    companyId,
    lineMinor: BigInt(txn.data.amount_original),
    currency: txn.data.currency,
    splits: (splits.data ?? []).map((row) => ({
      id: row.id,
      part: row.part,
      amountMinor: BigInt(row.amount_minor),
      scheduledMinor: BigInt(row.scheduled_minor),
      needsReview: row.needs_review,
      loanId: row.loan_id,
    })),
    loans: (loans.data ?? []).map((loan) => ({
      id: loan.id,
      name: loan.name,
      currency: loan.currency,
      principalMinor: loan.principal_minor,
      annualRatePpm: loan.annual_rate_ppm,
      termMonths: loan.term_months,
      startDate: loan.start_date,
      paymentMinor: loan.payment_minor,
      escrowMinor: loan.escrow_minor,
    })),
    categoryIds,
  };
}

async function writeSplit(transactionId: string, docDate: string, loaded: LoadedMatch, loan: LoanChoice): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  if (loan.currency !== loaded.currency) throw new Error("loan_split_currency");
  const schedule = buildLoanSchedule({
    principalMinor: BigInt(loan.principalMinor),
    annualRatePpm: loan.annualRatePpm,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    paymentMinor: BigInt(loan.paymentMinor),
    escrowMinor: BigInt(loan.escrowMinor),
  });
  const row = scheduleRowForDate(schedule.rows, docDate);
  if (!row) throw new Error("date");
  const parts = allocateLoanSplit({
    lineMinor: loaded.lineMinor,
    interestMinor: row.interestMinor,
    escrowMinor: row.escrowMinor,
    principalMinor: row.principalMinor,
  });
  const rows = parts.map((part) => {
    const categoryId = loaded.categoryIds[part.part];
    if (!categoryId) throw new Error("supabase");
    return {
      company_id: loaded.companyId,
      loan_id: loan.id,
      transaction_id: transactionId,
      part: part.part,
      amount_minor: Number(part.amountMinor),
      scheduled_minor: Number(part.scheduledMinor),
      category_id: categoryId,
    };
  });
  assertNoError(await supabase.from("loan_splits").insert(rows));
}

async function correctSplit(transactionId: string, loaded: LoadedMatch): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const loan = loaded.loans.find((item) => item.id === loaded.splits[0]?.loanId);
  if (loan && loan.currency !== loaded.currency) throw new Error("loan_split_currency");
  const scheduled = {
    interestMinor: 0n,
    escrowMinor: 0n,
    principalMinor: 0n,
  };
  for (const part of loaded.splits) {
    if (part.part === "interest") scheduled.interestMinor = part.scheduledMinor;
    if (part.part === "escrow") scheduled.escrowMinor = part.scheduledMinor;
    if (part.part === "principal") scheduled.principalMinor = part.scheduledMinor;
  }
  const next = allocateLoanSplit({ lineMinor: loaded.lineMinor, ...scheduled });
  for (const part of next) {
    const row = loaded.splits.find((item) => item.part === part.part);
    if (!row) throw new Error("supabase");
    assertNoError(await supabase
      .from("loan_splits")
      .update({ amount_minor: Number(part.amountMinor) })
      .eq("id", row.id));
  }
  assertNoError(await supabase.rpc("clear_loan_split_review", { p_transaction_id: transactionId }));
}
