import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useLocation } from "react-router-dom";
import type { TransactionLoanSplit } from "@flow/shared";
import { BankIcon, AlertIcon, PlusIcon } from "../ui/icons";
import { splitCents, withCents } from "../ui/big-number";
import { List, ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { RadioRow } from "../ui/radio-row";
import { TextLink } from "../ui/text-link";
import { Button } from "../ui/button";
import { currencyWord } from "../ui/investment-card";
import { sheetStack, useSheetHistory } from "../ui/back";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { useHoldWrites } from "../use-is-viewer";
import { quickNewPath } from "../open-from-query";
import { formatLoanMoney, type LoanCurrency } from "./loan-form";
import {
  LOAN_WRITE_KEYS,
  loanSaveFailureText,
  useLoanMatchContext,
  useLoanSplitView,
  type LoadedMatch,
  type LoanChoice,
} from "./loan-match-api";
import { loanOffer, sortedOffers, type LoanOffer } from "./loan-match-offer";
import { LoanSplitEditor, type LoanSplitSave } from "./loan-split-editor";

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
/**
 * The re-sync flagged the parts because the line's amount changed; the client can tell this one apart.
 * FLOW-115: the line says why and prints only the change, not both amounts.
 */
export function loanAmountChangedHint(changeMinor: bigint, currency: string): string {
  const change = showMoney(changeMinor < 0n ? -changeMinor : changeMinor, currency);
  return `סכום השורה ${changeMinor < 0n ? "ירד" : "עלה"} ב־${change}, אז החלקים צריכים בדיקה. בדקו ושמרו.`;
}

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
  offers,
  onMatch,
  onOther,
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
  /** FLOW-106 §3.4: what one tap writes per loan, or why the loan cannot take the line. */
  offers?: readonly LoanOffer[];
  onMatch: (loanId: string) => void;
  /** FLOW-106: "פיצול אחר" (fees, several installments, exact parts) opens the split editor. */
  onOther?: () => void;
}) {
  const setSheet = onSheetOpenChange;
  const location = useLocation();
  const localRowRef = useRef<HTMLButtonElement>(null);
  const rowRef = matchButtonRef ?? localRowRef;
  if (readOnly) return null;
  const inCurrency = loans.filter((loan) => loan.currency === lineCurrency);
  const byId = new Map((offers ?? []).map((offer) => [offer.loanId, offer]));
  const order = offers == null ? null : sortedOffers(offers).map((offer) => offer.loanId);
  const selectableLoans = order == null
    ? inCurrency
    : [...inCurrency].sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return (
    <>
      <List>
        <ListRow
          variant="button"
          eyebrow="הלוואה"
          title="שיוך להלוואה"
          hintParts={matchHint == null ? undefined : [matchHint]}
          icon={<BankIcon />}
          chevron
          busy={busy}
          buttonRef={rowRef}
          onClick={() => { if (!busy) setSheet(true); }}
        />
      </List>
      <Sheet open={sheetOpen} onOpenChange={setSheet} title="שיוך להלוואה" returnFocusRef={returnFocus ? rowRef : undefined}>
        {selectableLoans.length === 0 ? (
          // FLOW-115: no loan to pick is not a dead end. The sheet says why and offers the next
          // step, a new loan in Settings → הלוואות (the + sheet's quick action, FLOW-331).
          // FLOW-356: one line (the row's hint already says why) and the 44px tint button.
          <div className="ui-loan-empty">
            <p className="t-hint">{LOAN_EMPTY_NEXT_STEP}</p>
            <div className="ui-empty-action">
              {/* The link replaces the sheet's own history entry, so Back from Loans returns to the line once. */}
              <Button variant="pill" icon={<PlusIcon />} to={quickNewPath("/settings/loans", "", "loan")} replace={sheetStack(location.state).includes("loan-match")}>הלוואה חדשה</Button>
            </div>
          </div>
        ) : (
          <div role="radiogroup" aria-label="הלוואה">
            {selectableLoans.map((loan) => (
              <RadioRow
                key={loan.id}
                layout="picker"
                label={loan.name}
                description={byId.get(loan.id)?.description}
                busy={loan.id === savingId}
                value={loan.id}
                disabled={savingId != null && loan.id !== savingId}
                disabledReason={byId.get(loan.id)?.disabledReason ?? (loan.balanceMinor <= 0n ? "ההלוואה נפרעה" : undefined)}
                selected={false}
                onSelect={() => { onMatch(loan.id); }}
              />
            ))}
          </div>
        )}
        {onOther != null && (offers ?? []).some((offer) => offer.parts != null) ? (
          <TextLink
            className="ui-loan-other"
            tone="quiet"
            chevron={false}
            disabled={savingId != null}
            onClick={onOther}
          >
            פיצול אחר
          </TextLink>
        ) : null}
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
    <List className="ui-loan-list">
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
    <List className="ui-loan-list">
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
  // FLOW-115: Back waits for a save too, like ✕ and Escape below. `match` is read when Back runs.
  const setSheet = useSheetHistory("loan-match", sheetOpen, setSheetOpen, () => !match.isPending);
  const matchRowRef = useRef<HTMLButtonElement>(null);
  const [handedOff, setHandedOff] = useState(false);
  const [editorOpen, setEditorOpen] = useState(false);
  const setEditor = useSheetHistory("loan-split-editor", editorOpen, setEditorOpen);
  const query = useLoanMatchRead(transactionId, split, on && !writesHeld);
  // FLOW-115: after a retry lands, focus moves from the retry link (now gone) to the שיוך row.
  const retried = useRef(false);
  useEffect(() => {
    if (!retried.current || !query.isSuccess) return;
    retried.current = false;
    matchRowRef.current?.focus({ preventScroll: true });
  }, [query.isSuccess, query.dataUpdatedAt]);
  const categories = useQuery({
    queryKey: ["categories", "loan-parts"],
    enabled: editorOpen && api.readCategories != null,
    retry: false,
    queryFn: () => (api.readCategories ?? (() => Promise.resolve([])))(),
  });
  const other = useWrite<LoanSplitSave>({
    failure: failureText,
    success: "התשלום שויך להלוואה",
    keys: [...LOAN_WRITE_KEYS, "categories"],
    onSuccess: () => {
      setHandedOff(true);
      setEditor(false);
      focusLoanRow();
    },
    run: async ({ loanId, parts, keepFeesCategoryId }) => {
      if (writesHeld) throw new Error("preview");
      if (keepFeesCategoryId != null) await api.setFeesCategory?.(loanId, keepFeesCategoryId);
      await api.save(transactionId, loanId, parts);
    },
  });
  const match = useWrite<string>({
    failure: failureText,
    success: "התשלום שויך להלוואה",
    keys: LOAN_WRITE_KEYS,
    // FLOW-115: on a failure, a toast retry's included, focus goes back to the loan that was tapped,
    // still in the sheet. The busy mark may already be gone, so the row is found by its loan id.
    onError: (_error, loanId) => {
      const row = document.querySelector<HTMLElement>(`.ui-pick-row[data-value="${CSS.escape(loanId)}"]`);
      (row ?? matchRowRef.current)?.focus({ preventScroll: true });
    },
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
      if (loan.currency !== loaded.currency) throw new Error("loan_split_currency");
      const parts = offerFor(loaded, loan, transactionId, docDate).parts;
      if (parts == null) throw new Error("date");
      await api.save(transactionId, loan.id, parts);
    },
  });
  // A viewer cannot match, and a matched line shows as the category row instead.
  if (!on || writesHeld || split != null) return null;
  if (query.isLoading) {
    if (!keyedPrincipal) return null;
    return <LoanMatchSkeleton />;
  }
  if (query.isError) {
    if (!keyedPrincipal) return null;
    return (
      <LoanReadError
        label="שיוך להלוואה"
        busy={query.isFetching}
        onRetry={() => {
          retried.current = true;
          void query.refetch().then((result) => {
            // A retry that fails again must not pull focus on a later background success.
            if (result.isError) retried.current = false;
          });
        }}
      />
    );
  }
  const loaded = query.data;
  // The full read found parts: the matched row shows them (an older server without loan_split).
  if (!loaded || loaded.splits.length > 0) return null;
  const offerMatch = keyedPrincipal
    || (categoryId != null && loaded.loans.some((item) => item.categoryIds?.principal === categoryId));
  if (!offerMatch) return null;
  // FLOW-106 §3.4: every loan in the line's currency shows. One that cannot take the line (closed
  // before its date, paid off, a demand loan with a later payment) is disabled with the reason.
  const lineCurrency = loaded.currency;
  const offered = loaded.loans;
  const offers = offered
    .filter((item) => item.currency === lineCurrency)
    .map((item) => offerFor(loaded, item, transactionId, docDate));
  const matchHint = loanMatchHint(offered, lineCurrency);
  const savingId = match.isPending ? match.variables : null;
  const pickable = offers.filter((offer) => offer.parts != null)
    .flatMap((offer) => loaded.loans.filter((item) => item.id === offer.loanId));
  return (
    <>
    <LoanMatchOffer
      lineCurrency={lineCurrency}
      loans={offered}
      busy={match.isPending}
      matchHint={matchHint}
      savingId={savingId}
      sheetOpen={sheetOpen}
      onSheetOpenChange={(next) => {
        // FLOW-115: a dismiss during the save waits for it, as the parts sheet does (0075).
        if (!next && match.isPending) return;
        if (next) setHandedOff(false);
        setSheet(next);
      }}
      returnFocus={!handedOff}
      matchButtonRef={matchRowRef}
      offers={offers}
      onOther={() => {
        setSheet(false);
        setEditor(true);
      }}
      onMatch={(loanId) => {
        if (match.isPending) return;
        match.mutate(loanId);
      }}
    />
    <LoanSplitEditor
      open={editorOpen}
      onOpenChange={setEditor}
      loans={pickable}
      payments={loaded.payments ?? {}}
      line={{ transactionId, docDate, lineMinor: loaded.lineMinor, currency: lineCurrency }}
      categories={categories.data}
      saving={other.isPending}
      returnFocusRef={handedOff ? undefined : matchRowRef}
      onSave={(save) => {
        if (!other.isPending) other.mutate(save);
      }}
    />
    </>
  );
}

/** The שיוך row while the loans load, at the row's height (FLOW-115). */
export function LoanMatchSkeleton() {
  return (
    <List className="ui-loan-skel">
      <ListRow variant="skeleton" />
    </List>
  );
}

/**
 * FLOW-115: what to do when no loan fits. The line above already names the currency; the new-loan
 * form opens in the company's currency, so this line does not promise another one.
 */
export const LOAN_EMPTY_NEXT_STEP = "אפשר להוסיף הלוואה חדשה, ואז לשייך אליה את התשלום.";

/**
 * FLOW-115: why the match sheet has no loan to pick, on the row's hint only (the sheet does not
 * repeat it, FLOW-356): none offered at all, or none in the line's currency.
 */
export function loanEmptyLine(offered: ReadonlyArray<{ currency: string }>, lineCurrency: string): string {
  return offered.length === 0 ? "אין עדיין הלוואה" : `אין הלוואה ${currencyWord(lineCurrency)}`;
}

/**
 * FLOW-115: the שיוך row always has a hint, so it keeps the skeleton's height when the read lands:
 * the lone loan's name, else how many loans there are, else why there is none.
 */
export function loanMatchHint(offered: ReadonlyArray<{ name: string; currency: string }>, lineCurrency: string): string {
  const loans = offered.filter((loan) => loan.currency === lineCurrency);
  if (loans.length === 1) return loans[0]?.name ?? "";
  if (loans.length === 0) return loanEmptyLine(offered, lineCurrency);
  return `${String(loans.length)} הלוואות`;
}

export function useLoanBalances(companyId: string | null) {
  return useQuery({
    queryKey: ["loans", companyId],
    enabled: companyId != null,
    retry: false,
    queryFn: async (): Promise<LoanBalanceRow[]> => {
      const supabase = getSupabase();
      if (!supabase || companyId == null) return [];
      const loans = await supabase.from("loans").select("id, name, currency, project_id, principal_minor").eq("company_id", companyId);
      assertNoError(loans);
      const balances = await supabase.from("loan_balances").select("loan_id, balance_minor, flagged_parts, currency").eq("company_id", companyId);
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
          // No balance row yet (a loan saved after the view was read): nothing is paid, so the principal is left.
          balanceMinor: BigInt(balance?.balance_minor ?? loan.principal_minor),
          flaggedParts: balance?.flagged_parts ?? 0,
          projectId: loan.project_id,
          projectName: loan.project_id == null ? null : (projectNames.get(loan.project_id) ?? null),
        };
      });
    },
  });
}


/** What one tap writes for this loan on this line (loan-match-offer.ts). */
function offerFor(loaded: LoadedMatch, loan: LoanChoice, transactionId: string, docDate: string): LoanOffer {
  return loanOffer(loan, loaded.payments?.[loan.id] ?? [], {
    transactionId,
    docDate,
    lineMinor: loaded.lineMinor,
    currency: loaded.currency,
  });
}
