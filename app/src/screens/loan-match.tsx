import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState, type RefObject } from "react";
import {
  allocateLoanSplit,
  buildLoanSchedule,
  loanTakesPaymentOn,
  scheduleRowForDate,
  type TransactionLoanSplit,
} from "@flow/shared";
import { BankIcon, AlertIcon } from "../ui/icons";
import { splitCents, withCents } from "../ui/big-number";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { RadioRow } from "../ui/radio-row";
import { TextLink } from "../ui/text-link";
import { useSheetHistory } from "../ui/back";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { useHoldWrites } from "../use-is-viewer";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";
import {
  LOAN_WRITE_KEYS,
  loanSaveFailureText,
  useLoanMatchContext,
  useLoanSplitView,
  type LoadedMatch,
  type LoanChoice,
  type SavePart,
} from "./loan-match-api";

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

/** The matched row's class (loan-match-row.tsx). Kept here so the two files don't import each other. */
export const LOAN_ROW_CLASS_NAME = "ui-loan-row";

/**
 * FLOW-131. A line posted while another write held the loan is flagged even when it
 * fits (`skip locked`, decision 0121). The flag has no reason column, so a busy loan,
 * a payment past the balance and a re-synced amount look the same here: the hint says
 * "may". Saving the split runs the balance check again.
 */
export const LOAN_BUSY_HINT = "ייתכן שהתשלום סומן כי נרשם בזמן עדכון אחר של ההלוואה. שמירת הפיצול תבדוק את היתרה מחדש.";
/** The re-sync flagged the parts because the line's amount changed; the client can tell this one apart. */
export const LOAN_AMOUNT_CHANGED_HINT = "סכום השורה השתנה. בדקו את החלקים ושמרו.";

function asCurrency(currency: string): LoanCurrency | null {
  if (currency === "ILS" || currency === "USD") return currency;
  return null;
}

export function showMoney(minor: bigint, currency: string): string {
  const known = asCurrency(currency);
  if (known) return formatLoanMoney(minor, known);
  return `${currency} ${formatLoanMoney(minor, "ILS").replace("₪", "")}`;
}

/**
 * FLOW-114 option B. An unmatched loan payment offers "שיוך להלוואה" under the category row.
 * A matched one shows as the category row itself (loan-match-row.tsx).
 */
export function LoanMatchOffer({
  lineCurrency,
  loans,
  busy,
  matchHint,
  savingId = null,
  sheetOpen,
  onSheetOpenChange,
  matchButtonRef,
  readOnly = false,
  returnFocus = true,
  onMatch,
}: {
  lineCurrency: string;
  loans: readonly LoanChoice[];
  busy: boolean;
  matchHint?: string;
  savingId?: string | null;
  sheetOpen: boolean;
  onSheetOpenChange: (open: boolean) => void;
  matchButtonRef?: RefObject<HTMLButtonElement | null>;
  /** A viewer cannot match: nothing shows. */
  readOnly?: boolean;
  /** False once a match landed: focus goes to the new loan row, not back to this one. */
  returnFocus?: boolean;
  onMatch: (loanId: string) => void;
}) {
  const setSheet = onSheetOpenChange;
  const localRowRef = useRef<HTMLButtonElement>(null);
  const rowRef = matchButtonRef ?? localRowRef;
  if (readOnly) return null;
  const selectableLoans = loans.filter((loan) => loan.currency === lineCurrency);
  return (
    <>
      <List>
        <ListRow
          variant="button"
          eyebrow="הלוואה"
          title="שיוך להלוואה"
          hint={matchHint}
          icon={<BankIcon />}
          chevron
          busy={busy}
          buttonRef={rowRef}
          onClick={() => { if (!busy) setSheet(true); }}
        />
      </List>
      <Sheet open={sheetOpen} onOpenChange={setSheet} title="שיוך להלוואה" returnFocusRef={returnFocus ? rowRef : undefined}>
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

/**
 * After a match the category row becomes the loan row (loan-match-row.tsx). The closing sheet can
 * hold focus for a few frames, so retry until the row keeps it.
 */
function focusLoanRow() {
  const started = performance.now();
  const tryFocus = () => {
    const row = document.querySelector<HTMLElement>(`button.${LOAN_ROW_CLASS_NAME}`);
    if (row?.isConnected) row.focus({ preventScroll: true });
    if ((row == null || document.activeElement !== row) && performance.now() - started < 1000) {
      requestAnimationFrame(tryFocus);
    }
  };
  requestAnimationFrame(tryFocus);
}

function failureText(error: Error): string {
  if ((error as { code?: string }).code === "42501") return "אין הרשאה לשייך הלוואה.";
  if (error.message === "date") return "התאריך לא על לוח הסילוקין.";
  return loanSaveFailureText(error, "לא הצלחנו לשייך את ההלוואה.");
}

/**
 * The match offer and its read, shared with the matched row (loan-match-row.tsx). When get_transaction
 * said whether the line has a split, the read skips the split reads; a matched line reads nothing.
 */
export function useLoanMatchRead(
  transactionId: string,
  split: TransactionLoanSplit | null | undefined,
  enabled: boolean,
) {
  const { api } = useLoanMatchContext();
  return useQuery({
    queryKey: ["loan-split", transactionId],
    enabled: enabled && split == null,
    retry: false,
    queryFn: () => api.read(transactionId, split === null),
  });
}

export function LoanTransactionSplit({
  transactionId,
  docDate,
  loanPart,
  categoryId = null,
  direction,
  active,
  readOnly = false,
  split: serverSplit,
}: {
  transactionId: string;
  docDate: string;
  /** `categories.loan_part` of the line's category; null for any other category. */
  loanPart: string | null;
  /** The line's category. A loan's own principal category also offers the match (FLOW-134). */
  categoryId?: string | null;
  direction: string;
  active: boolean;
  /** From the transaction screen. A viewer, and a role that is still loading, pass true. */
  readOnly?: boolean;
  /** get_transaction's loan_split (FLOW-114). Undefined when the server did not send it. */
  split?: TransactionLoanSplit | null;
}) {
  const queryClient = useQueryClient();
  const holdWrites = useHoldWrites();
  const { api, sample } = useLoanMatchContext();
  const split = useLoanSplitView(serverSplit);
  const on = (active || sample != null) && direction !== "income";
  const writesHeld = readOnly || holdWrites;
  // The keyed principal category offers the match before the loans load; a loan's own principal
  // category offers it once they have (FLOW-134).
  const keyedPrincipal = direction !== "income" && loanPart === "principal";
  const [sheetOpen, setSheetOpen] = useState(false);
  const setSheet = useSheetHistory("loan-match", sheetOpen, setSheetOpen);
  const matchRowRef = useRef<HTMLButtonElement>(null);
  const [handedOff, setHandedOff] = useState(false);
  const query = useLoanMatchRead(transactionId, split, on && !writesHeld);
  const match = useWrite<string>({
    failure: failureText,
    success: "התשלום שויך להלוואה",
    keys: LOAN_WRITE_KEYS,
    onSuccess: () => {
      setHandedOff(true);
      setSheet(false);
      focusLoanRow();
    },
    run: async (loanId) => {
      if (writesHeld) throw new Error("preview");
      const loaded = queryClient.getQueryData<LoadedMatch>(["loan-split", transactionId]);
      if (!loaded) throw new Error("supabase");
      const loan = loaded.loans.find((item) => item.id === loanId);
      if (!loan) throw new Error("supabase");
      await api.save(transactionId, loan.id, matchParts(docDate, loaded, loan));
    },
  });
  // A viewer cannot match, and a matched line shows as the category row instead.
  if (!on || writesHeld || split != null) return null;
  if (query.isLoading) {
    if (!keyedPrincipal) return null;
    return (
      <List className="ui-loan-skel">
        <ListRow variant="skeleton" />
      </List>
    );
  }
  if (query.isError) {
    if (!keyedPrincipal) return null;
    return (
      <LoanReadError
        label="שיוך להלוואה"
        busy={query.isFetching}
        onRetry={() => { void query.refetch(); }}
      />
    );
  }
  const loaded = query.data;
  // The full read found parts: the matched row shows them (an older server without loan_split).
  if (!loaded || loaded.splits.length > 0) return null;
  const offerMatch = keyedPrincipal
    || (categoryId != null && loaded.loans.some((item) => item.categoryIds?.principal === categoryId));
  if (!offerMatch) return null;
  // A paid-off or closed loan is offered only for payments on or before the day it ended.
  // A demand loan has no schedule to split by; MCP attach_loan_payment splits it (0132).
  const offered = loaded.loans.filter((item) => loanTakesPaymentOn(item, docDate) && item.kind !== "demand");
  const lineCurrency = loaded.currency;
  const currencyLoans = offered.filter((item) => item.currency === lineCurrency);
  const matchHint = currencyLoans.length === 1 ? currencyLoans[0]?.name : undefined;
  const savingId = match.isPending ? match.variables : null;
  return (
    <LoanMatchOffer
      lineCurrency={lineCurrency}
      loans={offered}
      busy={match.isPending}
      matchHint={matchHint}
      savingId={savingId}
      sheetOpen={sheetOpen}
      onSheetOpenChange={(next) => {
        if (next) setHandedOff(false);
        setSheet(next);
      }}
      returnFocus={!handedOff}
      matchButtonRef={matchRowRef}
      onMatch={(loanId) => {
        if (match.isPending) return;
        match.mutate(loanId, {
          onError: () => {
            const row = document.querySelector<HTMLElement>(".ui-pick-row[aria-busy=\"true\"]");
            (row ?? matchRowRef.current)?.focus({ preventScroll: true });
          },
        });
      }}
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


/** The schedule row's parts for the line's date, checked here first, then sent in one save_loan_split. */
function matchParts(docDate: string, loaded: LoadedMatch, loan: LoanChoice): SavePart[] {
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
  // The server files each part under the loan's category, else the keyed default (0128).
  return parts.map((part) => ({
    part: part.part,
    amount_minor: Number(part.amountMinor),
    scheduled_minor: Number(part.scheduledMinor),
  }));
}
