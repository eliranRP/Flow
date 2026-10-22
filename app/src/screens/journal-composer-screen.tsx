import { formatAmountText } from "@flow/shared";
import { useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { dayMonth, copySideText, composerHold, legNote, legsFromEntry, legsFromJournal, bookingPayload, composerRefusal, nextLeg, type ComposerAccount, type ComposerLeg, type JournalCopies, type JournalSuggestion, type SavedBooking } from "../line-composer";
import { COMPOSER_KEYS, liveComposerApi, useComposerAccountsQuery, useJournalCopiesQuery, useJournalSuggestionQuery, type ComposerApi } from "../line-composer-api";
import { useLineJournalQuery, type LineJournal } from "../line-journal";
import { usePreviewSearch, useHomePreview } from "../preview";
import { projectChoices } from "../project-groups";
import { screenPhase, type ScreenPhase } from "../query-phase";
import { useDashboardQuery, useInvalidateBooks, useLineMetaQuery, useTransactionQuery } from "../use-books";
import { useWriteGate } from "../use-is-viewer";
import { isTransientWriteError } from "../use-write";
import { Amount } from "../ui/amount";
import { useGoBack } from "../ui/back";
import { Button } from "../ui/button";
import type { ChangeChoice } from "../ui/change-sheet-copy";
import { IconButton } from "../ui/icon-button";
import { CloseIcon } from "../ui/icons";
import { AccountPickSheet, ComposerAddLeg, ComposerBankLeg, ComposerLegCard, ComposerStart, ComposerStatus, CopySheet, ProjectPickSheet, type ComposerStartKind, type CopyOption } from "../ui/journal-composer";
import { ScreenState } from "../ui/screen-state";
import { useToast } from "../ui/toast";

/**
 * FLOW-955 (board LedgerComposer, owner 2026-10-22). `/transactions/:id/journal`: the line's journal
 * entry, פקודת יומן, opened from עריכה on its card. The bank line stays (שורה 1); every other line is an
 * account, a project, an amount and a side. It starts from Jev's suggestion (the party's most common
 * booking, scaled), from a booked line of the same party (כמו תנועה קודמת), or from scratch, and saves
 * through `save_line_journal` once חובה equals זכות. ביטול on the toast saves the split before back.
 */

export type ComposerLine = {
  id: string;
  party: string;
  docDate: string;
  direction: "income" | "expense";
  currency: string;
  bankAccountId: string;
  /** The line's signed bank movement: money in is positive (a debit). */
  bankMinor: bigint;
  bankName: string;
  /** The line counts as income: its figure is green. Other money in reads "+" in the text colour. */
  income: boolean;
};

export type ComposerState = { start: ComposerStartKind; legs: ComposerLeg[]; copied: string | null };

/** Where the composer opens: the entry booked now when it has two lines or more, else Jev's suggestion, else the line as booked. */
export function initialComposer(current: ComposerLeg[], suggestion: JournalSuggestion | null): ComposerState {
  if (current.length < 2 && suggestion != null) return { start: "jev", legs: legsFromEntry(suggestion.legs), copied: null };
  return { start: "free", legs: current, copied: null };
}

/** What the line's journal gives the composer: the bank leg and the other legs as lines. */
export function composerLineFrom(journal: LineJournal): { bank: { accountId: string; minor: bigint } | null; legs: ComposerLeg[]; income: boolean } {
  const bank = journal.legs.find((leg) => leg.is_bank);
  return {
    bank: bank ? { accountId: bank.account_id, minor: bank.amount_minor } : null,
    legs: legsFromJournal(journal.legs),
    income: journal.legs.some((leg) => leg.in_pnl && leg.account_type === "income"),
  };
}

function startNote(state: ComposerState, suggestion: JournalSuggestion | null, copies: JournalCopies | null, party: string): string {
  if (state.start === "jev" && suggestion != null) {
    const basis = suggestion.basis_count === 1 ? "תנועה קודמת אחת" : `${String(suggestion.basis_count)} תנועות קודמות`;
    return `✦ הצעה של Jev · על בסיס ${basis} של ${suggestion.party_name ?? party}`;
  }
  if (state.start === "copy") {
    const copy = copies?.lines.find((line) => line.transaction_id === state.copied);
    return `מועתק מ־${copies?.party_name ?? party}${copy ? ` · ${dayMonth(copy.doc_date)}` : ""} · הסכומים הותאמו`;
  }
  return "עריכה חופשית";
}

type PickTarget = { key: string; kind: "account" | "project" } | null;

export function JournalComposer({
  line,
  accounts,
  projects,
  suggestion,
  copies,
  initial,
  api,
  backTo,
  initialSheet = false,
  initialSaving = false,
  initialError = null,
}: {
  line: ComposerLine;
  accounts: readonly ComposerAccount[];
  projects: ChangeChoice[];
  suggestion: JournalSuggestion | null;
  copies: JournalCopies | null;
  initial: ComposerState;
  api: ComposerApi;
  backTo: string;
  /** Stories: the copy sheet open on load. */
  initialSheet?: boolean;
  /** Stories: a save in flight. */
  initialSaving?: boolean;
  /** Stories: a save the server refused. */
  initialError?: string | null;
}) {
  const [state, setState] = useState<ComposerState>(initial);
  const [sheet, setSheet] = useState(initialSheet);
  const [target, setTarget] = useState<PickTarget>(null);
  const [saving, setSaving] = useState(initialSaving);
  const [error, setError] = useState<string | null>(initialError);
  const opener = useRef<HTMLElement | null>(null);
  const toast = useToast();
  const goBack = useGoBack();
  const invalidate = useInvalidateBooks();
  const money = (minor: bigint) => formatAmountText(minor, line.currency, { detail: true });
  const accountOf = useMemo(() => new Map(accounts.map((account) => [account.id, account])), [accounts]);
  const projectName = (id: string | null) => (id == null ? null : projects.find((project) => project.id === id)?.name ?? null);
  const hold = composerHold(line.bankMinor, state.legs);
  const copyOptions: CopyOption[] = (copies?.lines ?? []).map((copy) => ({
    id: copy.transaction_id,
    title: `${copies?.party_name ?? line.party} · ${dayMonth(copy.doc_date)}`,
    amount: formatAmountText(copy.amount_gross < 0n ? -copy.amount_gross : copy.amount_gross, line.currency, { detail: true, direction: line.direction, plus: line.direction === "income" }),
    income: line.income,
    debit: copySideText(copy, "debit", money),
    credit: copySideText(copy, "credit", money),
  }));
  const targetLeg = target == null ? null : state.legs.find((leg) => leg.key === target.key) ?? null;
  const targetNo = targetLeg == null ? 0 : state.legs.indexOf(targetLeg) + 2;

  const setLegs = (legs: ComposerLeg[]) => { setState((value) => ({ ...value, legs })); setError(null); };
  const update = (key: string, change: Partial<ComposerLeg>) => {
    setLegs(state.legs.map((leg) => (leg.key === key ? { ...leg, ...change } : leg)));
  };

  async function save() {
    if (saving || hold.kind !== "balanced") return;
    const legs = bookingPayload(line.bankAccountId, line.bankMinor, state.legs);
    if (legs == null) return;
    setSaving(true);
    setError(null);
    let saved: SavedBooking;
    try {
      saved = await api.save(legs);
    } catch (caught) {
      setSaving(false);
      const failure = caught instanceof Error ? caught : new Error(String(caught));
      if (isTransientWriteError(failure)) {
        toast.show({ tone: "bad", message: "לא הצלחנו לשמור את הפקודה.", action: "ניסיון חוזר", onAction: () => { void save(); } });
      } else {
        setError(composerRefusal(failure.message));
      }
      return;
    }
    setSaving(false);
    await invalidate(COMPOSER_KEYS);
    toast.show({
      message: "הפקודה נשמרה",
      action: "ביטול",
      onAction: () => {
        void api.undo(saved).then(
          async () => { await invalidate(COMPOSER_KEYS); toast.show({ message: "הפקודה הקודמת חזרה" }); },
          () => { toast.show({ tone: "bad", message: "לא הצלחנו לבטל." }); },
        );
      },
    });
    goBack(backTo);
  }

  const figure = line.direction === "income"
    ? <Amount agorot={line.bankMinor} presentation="detail" currency={line.currency} income={line.income} direction="income" />
    : <Amount agorot={line.bankMinor} presentation="detail" currency={line.currency} />;

  return (
    <div className="ui-jc">
      <header className="ui-jc-top">
        <div className="ui-jc-top-row">
          <IconButton label="סגירה" disabled={saving} onClick={() => { goBack(backTo); }}><CloseIcon /></IconButton>
          <h1 className="ui-jc-title">פקודת יומן</h1>
          <span aria-hidden="true" />
        </div>
        <div className="ui-jc-line">
          <p className="ui-jc-meta">
            {`${line.party} · `}
            <bdi dir="ltr">{dayMonth(line.docDate)}</bdi>
            {line.direction === "income" ? " · נכנס" : " · יצא"}
          </p>
          <p className="ui-jc-figure">{figure}</p>
        </div>
        <ComposerStart
          value={state.start}
          jev={suggestion != null}
          copy={copyOptions.length > 0}
          note={startNote(state, suggestion, copies, line.party)}
          disabled={saving}
          onJev={() => { if (suggestion != null) { setState({ start: "jev", legs: legsFromEntry(suggestion.legs), copied: null }); setError(null); } }}
          onCopy={() => { setSheet(true); }}
          onClear={() => { setState({ start: "free", legs: [nextLeg(line.bankMinor, [])].map((leg) => ({ ...leg, amount: "" })), copied: null }); setError(null); }}
        />
        <ComposerStatus hold={hold} currency={line.currency} />
      </header>
      <fieldset className="ui-jc-body" disabled={saving}>
        <ComposerBankLeg name={line.bankName} side={line.bankMinor > 0n ? "debit" : "credit"} amount={line.bankMinor < 0n ? -line.bankMinor : line.bankMinor} currency={line.currency} />
        {state.legs.map((leg, index) => {
          const account = leg.accountId == null ? undefined : accountOf.get(leg.accountId);
          return (
            <ComposerLegCard
              key={leg.key}
              index={index + 2}
              account={account?.name ?? (leg.accountId == null ? null : "חשבון")}
              project={projectName(leg.projectId)}
              amount={leg.amount}
              side={leg.side}
              note={legNote(account)}
              disabled={saving}
              onAccount={(button) => { opener.current = button; setTarget({ key: leg.key, kind: "account" }); }}
              onProject={(button) => { opener.current = button; setTarget({ key: leg.key, kind: "project" }); }}
              onAmount={(value) => { update(leg.key, { amount: value }); }}
              onSide={(side) => { update(leg.key, { side }); }}
              onRemove={() => { setLegs(state.legs.filter((item) => item.key !== leg.key)); }}
            />
          );
        })}
        <ComposerAddLeg disabled={saving} onAdd={() => { setLegs([...state.legs, nextLeg(line.bankMinor, state.legs)]); }} />
        <p className="ui-jc-footnote">כל שורה היא חשבון וסכום. הפקודה נשמרת כשהחובה שווה לזכות. רק הכנסות והוצאות נספרות ברווח. בבנק נשארת תנועה אחת.</p>
      </fieldset>
      <div className="ui-jc-foot">
        {error != null ? <p className="ui-jc-error" role="alert">{error}</p> : null}
        <Button variant="primary" full busy={saving} disabled={saving || hold.kind !== "balanced"} onClick={() => { void save(); }}>שמירת הפקודה</Button>
      </div>
      <AccountPickSheet
        open={target?.kind === "account"}
        onOpenChange={(open) => { if (!open) setTarget(null); }}
        title={`חשבון · שורה ${String(targetNo)}`}
        accounts={accounts}
        selectedId={targetLeg?.accountId ?? null}
        returnFocusRef={opener}
        onPick={(id) => { if (targetLeg != null) update(targetLeg.key, { accountId: id }); }}
      />
      <ProjectPickSheet
        open={target?.kind === "project"}
        onOpenChange={(open) => { if (!open) setTarget(null); }}
        title={`פרויקט · שורה ${String(targetNo)}`}
        projects={projects}
        selectedId={targetLeg?.projectId ?? null}
        returnFocusRef={opener}
        onPick={(id) => { if (targetLeg != null) update(targetLeg.key, { projectId: id }); }}
      />
      <CopySheet
        open={sheet}
        onOpenChange={setSheet}
        party={copies?.party_name ?? line.party}
        options={copyOptions}
        selectedId={state.start === "copy" ? state.copied : null}
        onPick={(id) => {
          const copy = copies?.lines.find((item) => item.transaction_id === id);
          if (copy != null) setState({ start: "copy", legs: legsFromEntry(copy.scaled), copied: id });
          setError(null);
        }}
      />
    </div>
  );
}

export type JournalComposerSample = {
  line: ComposerLine;
  accounts: ComposerAccount[];
  projects: ChangeChoice[];
  suggestion: JournalSuggestion | null;
  copies: JournalCopies | null;
  initial: ComposerState;
  sheet?: boolean;
  saving?: boolean;
  error?: string;
  api?: ComposerApi;
};

/** `/transactions/:transactionId/journal`. A viewer is sent back to the line. */
export function JournalComposerScreen({ sample }: { sample?: JournalComposerSample } = {}) {
  const { transactionId = "" } = useParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const live = sample == null;
  const backTo = `/transactions/${transactionId}${search}`;
  const writeGate = useWriteGate(`/transactions/${transactionId}`);
  const txn = useTransactionQuery(live ? transactionId : "");
  const journal = useLineJournalQuery(transactionId, live);
  const accounts = useComposerAccountsQuery(live);
  const dashboard = useDashboardQuery(live);
  const suggestion = useJournalSuggestionQuery(transactionId, live);
  const copies = useJournalCopiesQuery(transactionId, live);
  const meta = useLineMetaQuery(live ? transactionId : null, live);
  const api = useMemo(() => sample?.api ?? liveComposerApi(transactionId), [sample?.api, transactionId]);
  if (sample) {
    return (
      <JournalComposer
        line={sample.line}
        accounts={sample.accounts}
        projects={sample.projects}
        suggestion={sample.suggestion}
        copies={sample.copies}
        initial={sample.initial}
        api={api}
        backTo={backTo}
        initialSheet={sample.sheet === true}
        initialSaving={sample.saving === true}
        initialError={sample.error ?? null}
      />
    );
  }
  if (writeGate === "wait") return null;
  if (writeGate !== "show") return writeGate;
  const queries = [txn, journal, accounts, dashboard, suggestion, copies];
  const phases = queries.map((query) => screenPhase(preview, query));
  const phase: ScreenPhase = phases.find((item) => item.kind === "error")
    ?? phases.find((item) => item.kind === "loading")
    ?? { kind: "ready" };
  const read = journal.data != null ? composerLineFrom(journal.data) : null;
  if (phase.kind !== "ready" || txn.data == null || read?.bank == null) {
    return (
      <ScreenState
        title="פקודת יומן"
        backTo={backTo}
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        onRetry={() => { for (const query of queries) void query.refetch(); }}
        empty={<p className="ui-page-pad t-caption t-muted">לתנועה הזו אין עדיין פקודה.</p>}
      />
    );
  }
  const detail = txn.data;
  const line: ComposerLine = {
    id: detail.id,
    party: detail.supplier_name ?? detail.customer_name ?? detail.description,
    docDate: detail.doc_date,
    direction: detail.direction === "income" ? "income" : "expense",
    currency: detail.currency ?? "ILS",
    bankAccountId: read.bank.accountId,
    bankMinor: read.bank.minor,
    bankName: meta.data?.account ?? "בנק",
    income: read.income,
  };
  return (
    <JournalComposer
      key={transactionId}
      line={line}
      accounts={accounts.data ?? []}
      projects={projectChoices(dashboard.data)}
      suggestion={suggestion.data ?? null}
      copies={copies.data ?? null}
      initial={initialComposer(read.legs, suggestion.data ?? null)}
      api={api}
      backTo={backTo}
    />
  );
}
