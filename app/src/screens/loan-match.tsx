import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useRef, useState, type ReactNode, type RefObject } from "react";
import {
  allocateLoanSplit,
  allocateLoanSplitWithFees,
  buildLoanSchedule,
  loanTakesPaymentOn,
  scheduleRowForDate,
  type LoanKind,
  type LoanRate,
  type LoanSplitPart,
  type LoanStatus,
} from "@flow/shared";
import { BankIcon, AlertIcon, EyeOffIcon, HomeIcon, PercentIcon, TagIcon } from "../ui/icons";
import { splitCents, withCents } from "../ui/big-number";
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
  fees: "עמלות",
};

const PART_ICON: Record<LoanSplitPart, () => ReactNode> = {
  interest: () => <PercentIcon />,
  escrow: () => <HomeIcon />,
  principal: () => <BankIcon />,
  fees: () => <TagIcon />,
};

type SplitRow = {
  id: string;
  part: LoanSplitPart;
  amountMinor: bigint;
  scheduledMinor: bigint;
  needsReview: boolean;
  loanId: string;
  /** From get_loan_split. Null when the P&L counts the whole line, not this part. */
  inPnl?: boolean | null;
};

type LoanChoice = {
  id: string;
  name: string;
  currency: string;
  principalMinor: number;
  annualRatePpm: number;
  /** Null for a demand loan only (decision 0132). */
  termMonths: number | null;
  startDate: string;
  /** Null for a demand loan only. */
  paymentMinor: number | null;
  escrowMinor: number;
  balanceMinor: bigint;
  /** Missing reads as amortizing. */
  kind?: LoanKind;
  interestOnlyMonths?: number | null;
  amortizationMonths?: number | null;
  rates?: readonly LoanRate[];
  status?: LoanStatus;
  closedOn?: string | null;
  /** The loan's own category per part (decision 0128). A missing one uses the keyed default. */
  categoryIds?: Partial<Record<LoanSplitPart, string | null>>;
};

export type LoanBalanceRow = {
  id: string;
  name: string;
  currency: string;
  balanceMinor: bigint;
  flaggedParts: number;
  /** FLOW-119. */
  projectId?: string | null;
  projectName?: string | null;
};

/**
 * FLOW-131. A line posted while another write held the loan is flagged even when it
 * fits (`skip locked`, decision 0121). The flag has no reason column, so a busy loan,
 * a payment past the balance and a re-synced amount look the same here: the hint says
 * "may". Clearing runs the balance check again.
 */
export const LOAN_BUSY_HINT = "ייתכן שהתשלום סומן כי נרשם בזמן עדכון אחר של ההלוואה. עדכון החלוקה יבדוק את היתרה מחדש.";
/** The re-sync flagged the parts because the line's amount changed; the client can tell this one apart. */
export const LOAN_AMOUNT_CHANGED_HINT = "סכום השורה השתנה. עדכון החלוקה יחלק אותו מחדש.";

function absMinor(value: bigint): bigint {
  return value < 0n ? -value : value;
}

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
  byParts = false,
  loans,
  needsReview,
  amountChanged = false,
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
  /** The P&L counts the line by its parts (get_loan_split). Otherwise the whole line counts. */
  byParts?: boolean;
  loans: readonly LoanChoice[];
  needsReview: boolean;
  /** The parts no longer sum to the line, so the flag came from a re-synced amount. */
  amountChanged?: boolean;
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
  const setSheet = onSheetOpenChange;
  const hintId = useId();
  const localRowRef = useRef<HTMLButtonElement>(null);
  const rowRef = matchButtonRef ?? localRowRef;
  if (parts == null && (!offerMatch || readOnly)) return null;
  const ordered = parts == null ? [] : (["interest", "escrow", "principal", "fees"] as const).flatMap((part) => {
    const row = parts.find((item) => item.part === part);
    return row ? [row] : [];
  });
  const selectableLoans = loans.filter((loan) => loan.currency === lineCurrency);
  const totalMinor = ordered.reduce((sum, part) => sum + part.amountMinor, 0n);
  const countedMinor = ordered.reduce((sum, part) => (part.inPnl === true ? sum + part.amountMinor : sum), 0n);
  const showCounted = byParts && !needsReview;
  return (
    <>
      {ordered.length > 0 ? (
        <>
          <div className="ui-section-head">
            <h2 ref={splitSectionRef} tabIndex={-1} className="ui-focus-title t-title-3">חלוקת התשלום</h2>
          </div>
          {showCounted ? (
            <p className="ui-page-pad t-hint">
              נספר ברווח <bdi className="ui-num" dir="ltr">{showMoney(countedMinor, displayCurrency)}</bdi>
            </p>
          ) : null}
          <List>
            {ordered.map((part) => (
              <ListRow
                key={part.part}
                variant="static"
                icon={PART_ICON[part.part]()}
                title={PART_LABEL[part.part]}
                hint={showCounted && part.inPnl === false ? (
                  <span className="ui-loan-out"><EyeOffIcon size={16} />מחוץ לרווח</span>
                ) : undefined}
                meta={<bdi className="ui-num ui-loan-amount t-amount" dir="ltr">{showMoney(-part.amountMinor, displayCurrency)}</bdi>}
              />
            ))}
            <ListRow
              variant="static"
              className="ui-loan-total"
              icon={<span className="ui-loan-spacer" aria-hidden="true" />}
              title="סה״כ"
              meta={<bdi className="ui-num ui-loan-amount t-amount" dir="ltr">{showMoney(-totalMinor, displayCurrency)}</bdi>}
            />
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
            <>
              <p className="t-hint" id={hintId}>{amountChanged ? LOAN_AMOUNT_CHANGED_HINT : LOAN_BUSY_HINT}</p>
              <Button type="button" variant="secondary" busy={busy} onClick={onCorrect} aria-describedby={hintId}>עדכון החלוקה</Button>
            </>
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

function loanRowHint(row: LoanBalanceRow): string | undefined {
  const project = row.projectName ?? null;
  if (row.flaggedParts > 0) return project == null ? "ממתין לבדיקה" : `ממתין לבדיקה · ${project}`;
  return project ?? undefined;
}

/** A balance with its cents drawn small, ".00" included (FLOW-501, decision 0120). */
function LoanBalance({ minor, currency }: { minor: bigint; currency: string }) {
  const { whole, cents } = splitCents(withCents(showMoney(minor, currency)), "detail");
  return (
    <bdi className="ui-num ui-loan-amount" dir="ltr">
      {whole}
      {cents != null ? <span className="ui-num-cents">{cents}</span> : null}
    </bdi>
  );
}

export function LoanBalanceList({
  rows,
  onOpen,
  rowRef,
}: {
  rows: readonly LoanBalanceRow[];
  /** FLOW-119. The owner opens a loan's project. A viewer gets static rows. */
  onOpen?: (row: LoanBalanceRow) => void;
  rowRef?: (id: string, node: HTMLButtonElement | null) => void;
}) {
  if (rows.length === 0) return null;
  return (
    <List>
      {rows.map((row) => {
        const common = {
          title: row.name,
          icon: <BankIcon />,
          tone: row.flaggedParts > 0 ? ("warning" as const) : undefined,
          hint: loanRowHint(row),
          meta: <LoanBalance minor={row.balanceMinor} currency={row.currency} />,
        };
        return onOpen ? (
          <ListRow
            key={row.id}
            variant="button"
            {...common}
            label={`${row.name}, ${withCents(showMoney(row.balanceMinor, row.currency))}${row.flaggedParts > 0 ? ", ממתין לבדיקה" : ""}, פרויקט: ${row.projectName ?? "ללא פרויקט"}`}
            chevron
            buttonRef={(node) => { rowRef?.(row.id, node); }}
            onClick={() => { onOpen(row); }}
          />
        ) : (
          <ListRow key={row.id} variant="static" {...common} />
        );
      })}
    </List>
  );
}

/** FLOW-119. The loans under a project, on the project screen. Static for everyone. */
export function ProjectLoanList({
  rows,
}: {
  rows: ReadonlyArray<{ id: string; name: string; currency: string; balance_minor: bigint }>;
}) {
  if (rows.length === 0) return null;
  return (
    <List>
      {rows.map((row) => (
        <ListRow
          key={row.id}
          variant="static"
          title={row.name}
          icon={<BankIcon />}
          hint={row.balance_minor <= 0n ? "נפרעה" : undefined}
          meta={<bdi className="ui-num ui-loan-amount" dir="ltr">{showMoney(row.balance_minor, row.currency)}</bdi>}
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
  // The balance check clear_loan_split_review runs again (FLOW-131).
  if (error.message.includes("loan_split_balance")) return "התשלום גבוה מיתרת ההלוואה.";
  return "לא הצלחנו לעדכן את החלוקה.";
}

export function LoanTransactionSplit({
  transactionId,
  docDate,
  loanPart,
  direction,
  active,
  readOnly = false,
}: {
  transactionId: string;
  docDate: string;
  /** `categories.loan_part` of the line's category; null for any other category. */
  loanPart: string | null;
  direction: string;
  active: boolean;
  /** From the transaction screen. A viewer, and a role that is still loading, pass true. */
  readOnly?: boolean;
}) {
  const queryClient = useQueryClient();
  const holdWrites = useHoldWrites();
  const writesHeld = readOnly || holdWrites;
  const offerMatch = direction !== "income" && loanPart === "principal";
  const [sheetOpen, setSheetOpen] = useState(false);
  const setSheet = useSheetHistory("loan-match", sheetOpen, setSheetOpen);
  const splitSectionRef = useRef<HTMLHeadingElement>(null);
  const matchRowRef = useRef<HTMLButtonElement>(null);
  const query = useQuery({
    queryKey: ["loan-split", transactionId],
    enabled: active && direction !== "income",
    retry: false,
    queryFn: () => readLoanMatch(transactionId),
  });
  // The closing sheet can hold or take focus for a few frames, so retry until the heading keeps it.
  const focusSplitSection = () => {
    const started = performance.now();
    const tryFocus = () => {
      const heading = splitSectionRef.current;
      if (heading?.isConnected) heading.focus({ preventScroll: true });
      if (document.activeElement !== heading && performance.now() - started < 1000) {
        requestAnimationFrame(tryFocus);
      }
    };
    tryFocus();
  };
  const match = useWrite<string>({
    failure: failureText,
    success: "התשלום שויך להלוואה",
    keys: ["loan-split", "loans", "txn"],
    onSuccess: () => {
      setSheet(false);
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
      if (!loaded || (loaded.splits.length !== 3 && loaded.splits.length !== 4)) throw new Error("supabase");
      await correctSplit(transactionId, loaded);
    },
  });
  if (!active || direction === "income") return null;
  if (query.isLoading) {
    if (!offerMatch) return null;
    return (
      <List className="ui-loan-skel">
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
  // Three parts, or four with fees (decision 0130; MCP attach_loan_payment writes those).
  const parts = loaded.splits.length === 3 || loaded.splits.length === 4 ? loaded.splits : null;
  if (parts == null && !offerMatch) return null;
  const loan = loaded.loans.find((item) => item.id === parts?.[0]?.loanId);
  // A paid-off or closed loan is offered only for payments on or before the day it ended.
  // A demand loan has no schedule to split by; MCP attach_loan_payment splits it (0132).
  const offered = loaded.loans.filter((item) =>
    item.id === loan?.id || (loanTakesPaymentOn(item, docDate) && item.kind !== "demand"));
  const lineCurrency = loaded.currency;
  const displayCurrency = loan?.currency ?? lineCurrency;
  const currencyLoans = offered.filter((item) => item.currency === lineCurrency);
  const matchHint = currencyLoans.length === 1 ? currencyLoans[0]?.name : undefined;
  const savingId = match.isPending ? match.variables : null;
  return (
    <LoanSplitPanel
      offerMatch={offerMatch && loaded.splits.length === 0}
      lineCurrency={lineCurrency}
      displayCurrency={displayCurrency}
      parts={parts}
      byParts={loaded.byParts}
      loans={offered}
      needsReview={parts?.some((part) => part.needsReview) ?? false}
      amountChanged={parts != null && absMinor(parts.reduce((sum, part) => sum + part.amountMinor, 0n)) !== absMinor(loaded.lineMinor)}
      currencyMismatch={loan != null && loan.currency !== lineCurrency}
      busy={match.isPending || correct.isPending}
      matchHint={matchHint}
      savingId={savingId}
      sheetOpen={sheetOpen}
      onSheetOpenChange={setSheet}
      splitSectionRef={splitSectionRef}
      matchButtonRef={matchRowRef}
      readOnly={writesHeld}
      onMatch={(loanId) => {
        if (writesHeld || match.isPending) return;
        match.mutate(loanId, {
          onError: (error) => {
            if ((error as { code?: string }).code === "23505") {
              setSheet(false);
              void query.refetch().then(() => { requestAnimationFrame(() => { focusSplitSection(); }); });
              return;
            }
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
      const loans = await supabase.from("loans").select("id, name, currency, project_id").eq("company_id", companyId);
      assertNoError(loans);
      const balances = await supabase.from("loan_balances").select("loan_id, balance_minor, flagged_parts, currency");
      assertNoError(balances);
      const byLoan = new Map((balances.data ?? []).map((row) => [row.loan_id, row]));
      const projectIds = [...new Set((loans.data ?? []).flatMap((loan) => (loan.project_id == null ? [] : [loan.project_id])))];
      const projectNames = new Map<string, string>();
      if (projectIds.length > 0) {
        const projects = await supabase.from("projects").select("id, name").in("id", projectIds);
        assertNoError(projects);
        for (const project of projects.data ?? []) projectNames.set(project.id, project.name);
      }
      return (loans.data ?? []).map((loan) => {
        const balance = byLoan.get(loan.id);
        return {
          id: loan.id,
          name: loan.name,
          currency: balance?.currency ?? loan.currency,
          balanceMinor: BigInt(balance?.balance_minor ?? 0),
          flaggedParts: balance?.flagged_parts ?? 0,
          projectId: loan.project_id,
          projectName: loan.project_id == null ? null : (projectNames.get(loan.project_id) ?? null),
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
  byParts: boolean;
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
  const [splits, loans, categories, balances, counted] = await Promise.all([
    supabase
      .from("loan_splits")
      .select("id, part, amount_minor, scheduled_minor, needs_review, loan_id")
      .eq("transaction_id", transactionId),
    supabase
      .from("loans")
      .select("id, name, currency, principal_minor, annual_rate_ppm, term_months, start_date, payment_minor, escrow_minor, status, closed_on, interest_category_id, escrow_category_id, principal_category_id, kind, interest_only_months, amortization_months, loan_rates(effective_date, annual_rate_ppm)")
      .eq("company_id", companyId),
    supabase
      .from("categories")
      .select("id, loan_part")
      .eq("company_id", companyId)
      .eq("kind", "expense")
      .not("loan_part", "is", null),
    supabase
      .from("loan_balances")
      .select("loan_id, balance_minor")
      .eq("company_id", companyId),
    supabase.rpc("get_loan_split", { p_transaction_id: transactionId }),
  ]);
  assertNoError(splits);
  assertNoError(loans);
  assertNoError(categories);
  assertNoError(balances);
  assertNoError(counted);
  const pnl = readCounted(counted.data);
  const balanceByLoan = new Map((balances.data ?? []).map((row) => [row.loan_id, BigInt(row.balance_minor ?? 0)]));
  const categoryIds: Partial<Record<LoanSplitPart, string>> = {};
  for (const category of categories.data ?? []) {
    if (category.loan_part) categoryIds[category.loan_part] = category.id;
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
      inPnl: pnl.parts.get(row.part) ?? null,
    })),
    byParts: pnl.byParts,
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
      kind: loan.kind,
      interestOnlyMonths: loan.interest_only_months,
      amortizationMonths: loan.amortization_months,
      // Test doubles and older rows may leave the embed out.
      rates: (Array.isArray(loan.loan_rates) ? loan.loan_rates : []).map((rate) => ({ effectiveDate: rate.effective_date, annualRatePpm: rate.annual_rate_ppm })),
      status: loan.status,
      closedOn: loan.closed_on,
      categoryIds: {
        interest: loan.interest_category_id,
        escrow: loan.escrow_category_id,
        principal: loan.principal_category_id,
      },
    })),
    categoryIds,
  };
}

/** get_loan_split is null or { by_parts, parts: [{ part, in_pnl }] }. Anything else reads as the whole line. */
function readCounted(data: unknown): { byParts: boolean; parts: Map<string, boolean | null> } {
  const parts = new Map<string, boolean | null>();
  if (data == null || typeof data !== "object") return { byParts: false, parts };
  const value = data as { by_parts?: unknown; parts?: unknown };
  if (Array.isArray(value.parts)) {
    for (const item of value.parts as Array<{ part?: unknown; in_pnl?: unknown }>) {
      if (typeof item.part === "string") parts.set(item.part, typeof item.in_pnl === "boolean" ? item.in_pnl : null);
    }
  }
  return { byParts: value.by_parts === true, parts };
}

async function writeSplit(transactionId: string, docDate: string, loaded: LoadedMatch, loan: LoanChoice): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  if (loan.currency !== loaded.currency) throw new Error("loan_split_currency");
  if (loan.balanceMinor <= 0n) throw new Error("loan_split_over_balance");
  if (loan.kind === "demand" || loan.termMonths == null || loan.paymentMinor == null) throw new Error("date");
  const schedule = buildLoanSchedule({
    principalMinor: BigInt(loan.principalMinor),
    annualRatePpm: loan.annualRatePpm,
    termMonths: loan.termMonths,
    startDate: loan.startDate,
    paymentMinor: BigInt(loan.paymentMinor),
    escrowMinor: BigInt(loan.escrowMinor),
    kind: loan.kind,
    interestOnlyMonths: loan.interestOnlyMonths ?? null,
    amortizationMonths: loan.amortizationMonths ?? null,
    rates: loan.rates ?? [],
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
    const categoryId = loan.categoryIds?.[part.part] ?? loaded.categoryIds[part.part];
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
  let feesMinor = 0n;
  for (const part of loaded.splits) {
    if (part.part === "interest") scheduled.interestMinor = part.scheduledMinor;
    if (part.part === "escrow") scheduled.escrowMinor = part.scheduledMinor;
    if (part.part === "principal") scheduled.principalMinor = part.scheduledMinor;
    if (part.part === "fees") feesMinor = part.amountMinor;
  }
  // A fees part keeps its amount; the rest of the line splits as usual (decision 0130).
  const next = allocateLoanSplitWithFees({ lineMinor: loaded.lineMinor, feesMinor, ...scheduled });
  if (next == null) throw new Error("loan_split_sum");
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
