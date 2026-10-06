import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type RefObject } from "react";
import {
  allocateLoanSplit,
  buildLoanSchedule,
  LOAN_ESCROW_CATEGORY,
  LOAN_INTEREST_CATEGORY,
  LOAN_PRINCIPAL_CATEGORY,
  scheduleRowForDate,
  type LoanSplitPart,
} from "@flow/shared";
import { BankIcon, AlertIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { Button } from "../ui/button";
import { RadioRow } from "../ui/radio-row";
import { TextLink } from "../ui/text-link";
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
  balanceMinor: bigint;
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
  lineCurrency,
  displayCurrency,
  parts,
  loans,
  needsReview,
  currencyMismatch,
  busy,
  matchHint,
  savingId = null,
  sheetOpen,
  onSheetOpenChange,
  splitSectionRef,
  matchButtonRef,
  readOnly = false,
  onMatch,
  onCorrect,
}: {
  offerMatch: boolean;
  lineCurrency: string;
  displayCurrency: string;
  parts: readonly SplitRow[] | null;
  loans: readonly LoanChoice[];
  needsReview: boolean;
  currencyMismatch: boolean;
  busy: boolean;
  matchHint?: string;
  savingId?: string | null;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  splitSectionRef: RefObject<HTMLHeadingElement | null>;
  matchButtonRef?: RefObject<HTMLButtonElement | null>;
  /** A viewer can read the split and cannot match or correct it. */
  readOnly?: boolean;
  onMatch: (loanId: string) => void;
  onCorrect: () => void;
}) {
  const setSheet = useSheetHistory("loan-match", sheetOpen, onSheetOpenChange);
  const localRowRef = useRef<HTMLButtonElement>(null);
  const rowRef = matchButtonRef ?? localRowRef;
  if (parts == null && (!offerMatch || readOnly)) return null;
  const ordered = parts == null ? [] : (["interest", "escrow", "principal"] as const).flatMap((part) => {
    const row = parts.find((item) => item.part === part);
    return row ? [row] : [];
  });
  const selectableLoans = loans.filter((loan) => loan.currency === lineCurrency);
  return (
    <>
      {ordered.length > 0 ? (
        <>
          <h2 ref={splitSectionRef} tabIndex={-1} className="ui-focus-title t-title-3 ui-page-pad">
            חלוקת התשלום
          </h2>
          <List>
            {ordered.map((part) => (
              <ListRow
                key={part.part}
                variant="static"
                title={PART_LABEL[part.part]}
                meta={<bdi className="ui-num ui-loan-amount" dir="ltr">{showMoney(part.amountMinor, displayCurrency)}</bdi>}
              />
            ))}
          </List>
        </>
      ) : (
        <List>
          <ListRow
            variant="button"
            title="שיוך להלוואה"
            hint={matchHint}
            icon={<BankIcon />}
            chevron
            busy={busy}
            buttonRef={rowRef}
            onClick={() => { if (!readOnly && !busy) setSheet(true); }}
          />
        </List>
      )}
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
      <Sheet open={sheetOpen} onOpenChange={setSheet} title="שיוך להלוואה" returnFocusRef={rowRef}>
        {selectableLoans.length === 0 ? (
          <p className="t-hint">אין עדיין הלוואה.</p>
        ) : (
          <div role="radiogroup" aria-label="הלוואה">
            {selectableLoans.map((loan) => (
              <RadioRow
                key={loan.id}
                layout="picker"
                label={loan.name}
                busy={loan.id === savingId}
                disabled={savingId != null && loan.id !== savingId}
                disabledReason={loan.balanceMinor <= 0n ? "ההלוואה נפרעה" : undefined}
                selected={false}
                onSelect={() => { onMatch(loan.id); }}
              />
            ))}
          </div>
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

export function LoanReadError({ label, busy, onRetry }: { label: string; busy: boolean; onRetry: () => void }) {
  const retryRef = useRef<HTMLButtonElement>(null);
  return (
    <List>
      <ListRow
        variant="static"
        title={label}
        icon={<AlertIcon size={24} />}
        tone="muted"
        describeHint
        hintStatus
        hint="לא הצלחנו לטעון."
        action={(
          <TextLink
            size="label"
            chevron={false}
            label={`ניסיון חוזר: ${label}`}
            busy={busy}
            buttonRef={retryRef}
            onClick={onRetry}
          >
            ניסיון חוזר
          </TextLink>
        )}
      />
    </List>
  );
}

function failureText(error: Error): string {
  const code = (error as { code?: string }).code;
  if (code === "42501") return "אין הרשאה לשייך הלוואה.";
  if (code === "23505") return "התשלום כבר שויך להלוואה.";
  if (error.message === "loan_split_over_balance") return "התשלום גבוה מיתרת ההלוואה.";
  if (error.message.includes("loan_split_currency")) return "המטבע של השורה לא מתאים להלוואה.";
  if (error.message.includes("loan_split_sum")) return "החלוקה לא מסתכמת לשורה.";
  if (error.message === "date") return "התאריך לא על לוח הסילוקין.";
  return "לא הצלחנו לשייך את ההלוואה.";
}

function correctFailureText(error: Error): string {
  const code = (error as { code?: string }).code;
  if (code === "42501") return "אין הרשאה לעדכן את החלוקה.";
  if (error.message.includes("loan_split_currency")) return "המטבע של השורה לא מתאים להלוואה.";
  if (error.message.includes("loan_split_sum")) return "החלוקה לא מסתכמת לשורה.";
  return "לא הצלחנו לעדכן את החלוקה.";
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
  const queryClient = useQueryClient();
  const holdWrites = useHoldWrites();
  const writesHeld = readOnly || holdWrites;
  const offerMatch = direction !== "income" && categoryName === LOAN_PRINCIPAL_CATEGORY;
  const [sheetOpen, setSheetOpen] = useState(false);
  const splitSectionRef = useRef<HTMLHeadingElement>(null);
  const matchRowRef = useRef<HTMLButtonElement>(null);
  const query = useQuery({
    queryKey: ["loan-split", transactionId],
    enabled: active && direction !== "income",
    retry: false,
    queryFn: () => readLoanMatch(transactionId),
  });
  const focusSplitSection = () => {
    splitSectionRef.current?.focus({ preventScroll: true });
  };
  const match = useWrite<string>({
    failure: failureText,
    success: "התשלום שויך להלוואה",
    keys: ["loan-split", "loans", "txn"],
    onSuccess: () => {
      setSheetOpen(false);
      void query.refetch().then(() => {
        requestAnimationFrame(() => { focusSplitSection(); });
      });
    },
    run: async (loanId) => {
      if (writesHeld) throw new Error("preview");
      const loaded = queryClient.getQueryData<LoadedMatch>(["loan-split", transactionId]);
      if (!loaded) throw new Error("supabase");
      const loan = loaded.loans.find((item) => item.id === loanId);
      if (!loan) throw new Error("supabase");
      await writeSplit(transactionId, docDate, loaded, loan);
    },
  });
  const correct = useWrite({
    failure: correctFailureText,
    success: "החלוקה עודכנה",
    keys: ["loan-split", "loans", "txn"],
    onSuccess: () => {
      void query.refetch().then(() => {
        requestAnimationFrame(() => { focusSplitSection(); });
      });
    },
    run: async () => {
      if (writesHeld) throw new Error("preview");
      const loaded = queryClient.getQueryData<LoadedMatch>(["loan-split", transactionId]);
      if (!loaded || loaded.splits.length !== 3) throw new Error("supabase");
      await correctSplit(transactionId, loaded);
    },
  });
  if (!active || direction === "income") return null;
  if (query.isLoading) {
    if (!offerMatch) return null;
    return (
      <List>
        <ListRow variant="skeleton" />
      </List>
    );
  }
  if (query.isError) {
    if (!offerMatch) return null;
    return (
      <LoanReadError
        label="שיוך להלוואה"
        busy={query.isFetching}
        onRetry={() => { void query.refetch(); }}
      />
    );
  }
  const loaded = query.data;
  if (!loaded) return null;
  const parts = loaded.splits.length === 3 ? loaded.splits : null;
  if (parts == null && !offerMatch) return null;
  const loan = loaded.loans.find((item) => item.id === parts?.[0]?.loanId);
  const lineCurrency = loaded.currency;
  const displayCurrency = loan?.currency ?? lineCurrency;
  const currencyLoans = loaded.loans.filter((item) => item.currency === lineCurrency);
  const matchHint = currencyLoans.length === 1 ? currencyLoans[0]?.name : undefined;
  const savingId = match.isPending ? match.variables : null;
  return (
    <LoanSplitPanel
      offerMatch={offerMatch && loaded.splits.length === 0}
      lineCurrency={lineCurrency}
      displayCurrency={displayCurrency}
      parts={parts}
      loans={loaded.loans}
      needsReview={parts?.some((part) => part.needsReview) ?? false}
      currencyMismatch={loan != null && loan.currency !== lineCurrency}
      busy={match.isPending || correct.isPending}
      matchHint={matchHint}
      savingId={savingId}
      sheetOpen={sheetOpen}
      onSheetOpenChange={setSheetOpen}
      splitSectionRef={splitSectionRef}
      matchButtonRef={matchRowRef}
      readOnly={writesHeld}
      onMatch={(loanId) => {
        if (writesHeld || match.isPending) return;
        match.mutate(loanId, {
          onError: (error) => {
            if ((error as { code?: string }).code === "23505") void query.refetch();
            const row = document.querySelector<HTMLElement>(".ui-pick-row[aria-busy=\"true\"]");
            (row ?? matchRowRef.current)?.focus({ preventScroll: true });
          },
        });
      }}
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
  const [splits, loans, categories, balances] = await Promise.all([
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
    supabase
      .from("loan_balances")
      .select("loan_id, balance_minor")
      .eq("company_id", companyId),
  ]);
  assertNoError(splits);
  assertNoError(loans);
  assertNoError(categories);
  assertNoError(balances);
  const balanceByLoan = new Map((balances.data ?? []).map((row) => [row.loan_id, BigInt(row.balance_minor ?? 0)]));
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
      balanceMinor: balanceByLoan.get(loan.id) ?? 0n,
    })),
    categoryIds,
  };
}

async function writeSplit(transactionId: string, docDate: string, loaded: LoadedMatch, loan: LoanChoice): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  if (loan.currency !== loaded.currency) throw new Error("loan_split_currency");
  if (loan.balanceMinor <= 0n) throw new Error("loan_split_over_balance");
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
  const principalPart = parts.find((part) => part.part === "principal")?.amountMinor ?? 0n;
  if (principalPart > loan.balanceMinor) throw new Error("loan_split_over_balance");
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
