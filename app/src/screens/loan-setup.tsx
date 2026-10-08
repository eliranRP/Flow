import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref, type SubmitEvent } from "react";
import { BackIcon, CalendarIcon, ChevronDownIcon, InfoIcon, LoanIcon, PlusIcon, RefreshIcon } from "../ui/icons";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { RadioRow } from "../ui/radio-row";
import { SearchField } from "../ui/search-field";
import { Skeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import { List, ListRow } from "../ui/list-row";
import { MoneyField, PercentField } from "../ui/money-field";
import { SegmentedControl } from "../ui/segmented-control";
import { DateSheet } from "../ui/date-sheet";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { Button } from "../ui/button";
import { useSheetHistory } from "../ui/back";
import { formatDisplay } from "../ui/date-math";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { useHoldWrites } from "../use-is-viewer";
import {
  LOAN_CURRENCY_MARK,
  firstOfNextMonth,
  formatLoanMoney,
  loanFieldErrors,
  loanFinalLine,
  loanPreview,
  minorToInput,
  readCompanyLoanCurrency,
  type LoanCurrency,
  type LoanDraft,
  type LoanField,
  type LoanInsert,
  type LoanPreview,
} from "./loan-form";
import { LoanBalanceList, LoanReadError, useLoanBalances, type LoanBalanceRow } from "./loan-match";

export type { LoanCurrency } from "./loan-form";

const CURRENCIES: Array<{ value: LoanCurrency; label: string }> = [
  { value: "ILS", label: "₪" },
  { value: "USD", label: "$" },
];

export type LoanSetupInitial = {
  name?: string;
  principal?: string;
  rate?: string;
  term?: string;
  startDate?: string;
  escrow?: string;
  currency?: LoanCurrency;
  payment?: string;
};

type ReadyPreview = Extract<LoanPreview, { status: "ready" }>;

export function LoanSetupForm({
  companyCurrency,
  initial,
  advancedOpen = false,
  busy = false,
  onSave,
  onDraft,
  keepDraft,
  saveButtonRef,
  project,
}: {
  companyCurrency: LoanCurrency;
  initial?: LoanSetupInitial;
  advancedOpen?: boolean;
  busy?: boolean;
  onSave?: (row: Omit<LoanInsert, "company_id">) => void;
  onDraft?: (draft: LoanSetupInitial) => void;
  /** False after the sheet closes, so a late effect cannot write the draft back. */
  keepDraft?: { current: boolean };
  saveButtonRef?: Ref<HTMLButtonElement>;
  /** FLOW-119. The project field. The sheet owns the choice and the picker view. */
  project?: LoanProjectField;
}) {
  const panelId = useId();
  const dateLabelId = useId();
  const projectLabelId = useId();
  const projectValueId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [principal, setPrincipal] = useState(initial?.principal ?? "");
  const [rate, setRate] = useState(initial?.rate ?? "");
  const [term, setTerm] = useState(initial?.term ?? "360");
  const [startDate, setStartDate] = useState(initial?.startDate ?? firstOfNextMonth());
  const [escrow, setEscrow] = useState(initial?.escrow ?? "0");
  const [currency, setCurrency] = useState<LoanCurrency>(initial?.currency ?? companyCurrency);
  const [payment, setPayment] = useState<string | null>(initial?.payment ?? null);
  const [advanced, setAdvanced] = useState(advancedOpen || initial?.payment != null);
  const [dateOpen, setDateOpen] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<LoanField, boolean>>>({});
  const [checked, setChecked] = useState(false);
  const lastReady = useRef<ReadyPreview | null>(null);
  const draft = useMemo<LoanDraft>(() => ({
    name,
    principal,
    rate,
    term,
    startDate,
    escrow,
    currency,
    payment,
  }), [name, principal, rate, term, startDate, escrow, currency, payment]);
  const preview = useMemo(() => loanPreview(draft), [draft]);
  if (preview.status === "ready") lastReady.current = preview;
  const shown = preview.status === "ready" ? preview : lastReady.current;
  const errors = useMemo(() => loanFieldErrors(draft, preview), [draft, preview]);
  const mark = LOAN_CURRENCY_MARK[currency];
  const ready = preview.status === "ready";
  const invalid = Object.keys(errors).length > 0;
  const canSave = ready && !invalid;
  function shownError(field: LoanField): string | undefined {
    if (!checked && touched[field] !== true) return undefined;
    return errors[field];
  }
  function touch(field: LoanField) {
    setTouched((current) => (current[field] === true ? current : { ...current, [field]: true }));
  }
  const finalLine = shown == null ? null : loanFinalLine(shown);
  const computedPayment = shown == null ? "" : minorToInput(shown.paymentMinor);
  const shownPayment = payment != null ? payment : computedPayment;
  const onDraftRef = useRef(onDraft);
  onDraftRef.current = onDraft;

  useEffect(() => {
    if (keepDraft != null && !keepDraft.current) return;
    onDraftRef.current?.({
      name,
      principal,
      rate,
      term,
      startDate,
      escrow,
      currency,
      payment: payment ?? undefined,
    });
  }, [name, principal, rate, term, startDate, escrow, currency, payment, keepDraft]);

  function submit(event: SubmitEvent) {
    event.preventDefault();
    setChecked(true);
    if (!canSave || busy) return;
    onSave?.(preview.insert);
  }

  function onTerm(raw: string) {
    const negative = raw.trim().startsWith("-");
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    setTerm(negative ? (digits === "" ? "-" : `-${digits}`) : digits);
  }

  function onFormEnter(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key !== "Enter") return;
    // Enter that commits an IME composition (Gboard, Hebrew predictive text) is not "next".
    if (event.nativeEvent.isComposing) return;
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    const fields = [...event.currentTarget.querySelectorAll<HTMLInputElement>("input:not([disabled])")];
    const index = fields.indexOf(target);
    if (index < 0 || index >= fields.length - 1) return;
    event.preventDefault();
    fields[index + 1]?.focus();
  }

  return (
    <form className="ui-stack" onSubmit={submit} onKeyDown={onFormEnter}>
      <TextField
        label="מלווה"
        value={name}
        maxLength={80}
        disabled={busy}
        reserveMessage
        enterKeyHint="next"
        error={shownError("name")}
        onBlur={() => { touch("name"); }}
        onChange={(event) => { setName(event.target.value); }}
      />
      {project ? (
        <div className="ui-field">
          <span id={projectLabelId} className="ui-field-label">פרויקט</span>
          <button
            type="button"
            ref={project.buttonRef}
            className="ui-field-control ui-date-field"
            aria-labelledby={`${projectLabelId} ${projectValueId}`}
            aria-haspopup="dialog"
            disabled={busy}
            onClick={project.onOpen}
          >
            <span id={projectValueId} className="ui-pick-value" data-empty={project.name == null ? "true" : "false"} data-clip-ok="">
              {project.name ?? NO_PROJECT}
            </span>
            <ChevronDownIcon size={20} />
          </button>
          {/* Same rhythm as the fields around it, which reserve their message line. */}
          <span className="ui-field-message ui-field-message-slot" aria-hidden="true" />
        </div>
      ) : null}
      <MoneyField
        label="סכום מקורי"
        value={principal}
        prefix={mark}
        disabled={busy}
        keepMinus
        reserveMessage
        enterKeyHint="next"
        error={shownError("principal")}
        onBlur={() => { touch("principal"); }}
        onValueChange={setPrincipal}
      />
      <SegmentedControl
        label="מטבע"
        showLabel={false}
        value={currency}
        options={CURRENCIES}
        disabled={busy}
        onChange={setCurrency}
      />
      <PercentField
        label="ריבית שנתית"
        value={rate}
        decimals={4}
        disabled={busy}
        keepMinus
        reserveMessage
        enterKeyHint="next"
        error={shownError("rate")}
        onBlur={() => { touch("rate"); }}
        onValueChange={setRate}
      />
      <TextField
        label="תקופה בחודשים"
        value={term}
        dir="ltr"
        inputMode="numeric"
        numeric
        disabled={busy}
        reserveMessage
        enterKeyHint="next"
        error={shownError("term")}
        onBlur={() => { touch("term"); }}
        onChange={(event) => { onTerm(event.target.value); }}
      />
      <div className="ui-field">
        <span id={dateLabelId} className="ui-field-label">תאריך תשלום ראשון</span>
        <button
          type="button"
          className="ui-field-control ui-date-field"
          aria-labelledby={dateLabelId}
          aria-haspopup="dialog"
          disabled={busy}
          onClick={() => { setDateOpen(true); }}
        >
          <bdi className="ui-num" dir="ltr">{formatDisplay(startDate)}</bdi>
          <CalendarIcon size={20} />
        </button>
      </div>
      <DateSheet
        open={dateOpen}
        onOpenChange={setDateOpen}
        title="תאריך תשלום ראשון"
        value={startDate}
        allowFuture
        shortcuts={false}
        disabled={busy}
        onApply={setStartDate}
      />
      <MoneyField
        label="מסים וביטוח לחודש"
        value={escrow}
        prefix={mark}
        disabled={busy}
        keepMinus
        reserveMessage
        enterKeyHint={advanced ? "next" : "done"}
        error={shownError("escrow")}
        onBlur={() => { touch("escrow"); }}
        onValueChange={setEscrow}
      />
      <TextLink
        chevron={false}
        expanded={advanced}
        controls={panelId}
        disabled={busy}
        trailing={<ChevronDownIcon size={16} />}
        onClick={() => { setAdvanced((open) => !open); }}
      >
        עוד
      </TextLink>
      {advanced ? (
        <div id={panelId}>
          <MoneyField
            label="תשלום חודשי"
            value={shownPayment}
            prefix={mark}
            disabled={busy}
            keepMinus
            reserveMessage
            enterKeyHint="done"
            error={shownError("payment")}
            onValueChange={(next) => { setPayment(next); }}
            onBlur={() => {
              touch("payment");
              setPayment((current) => (current == null || current.trim() === "" ? null : current));
            }}
          />
        </div>
      ) : null}
      {shown ? (
        <div aria-live="polite">
          <p>
            תשלום חודשי{" "}
            <bdi className="ui-num" dir="ltr">{formatLoanMoney(shown.paymentMinor, currency)}</bdi>
          </p>
          <p>
            ריבית כוללת{" "}
            <bdi className="ui-num" dir="ltr">{formatLoanMoney(shown.interestMinor, currency)}</bdi>
          </p>
          {finalLine ? (
            <p className={finalLine.tone === "caution" ? "t-hint ui-loan-caution" : undefined}>
              {finalLine.lead}
              {finalLine.times ? (
                <>
                  {" "}
                  <bdi className="ui-num" dir="ltr">{finalLine.times}</bdi>
                </>
              ) : null}
              {", "}
              <bdi className="ui-num" dir="ltr">{formatLoanMoney(finalLine.amountMinor, currency)}</bdi>
            </p>
          ) : null}
        </div>
      ) : null}
      {!advanced ? (
        <p className="ui-field-message ui-field-message-slot" role={shownError("payment") ? "alert" : undefined}>
          {shownError("payment") ?? ""}
        </p>
      ) : null}
      <Button type="submit" buttonRef={saveButtonRef} busy={busy} disabled={!ready && !invalid}>שמירה</Button>
    </form>
  );
}

const NO_PROJECT = "ללא פרויקט";
/** More projects than this get a search field (guide §7.12). */
const PROJECT_SEARCH_FROM = 8;
const projectSkeleton = ["a", "b", "c", "d"] as const;

export type LoanProjectChoice = { id: string; name: string; status?: "active" | "finished"; code?: string | null };

export type LoanProjectField = {
  /** null shows ללא פרויקט. */
  name: string | null;
  onOpen: () => void;
  buttonRef?: Ref<HTMLButtonElement>;
};

/** Where the picker's projects come from: the dashboard in the app, a list in stories. */
export type LoanProjectSource = {
  rows: readonly LoanProjectChoice[];
  loading?: boolean;
  error?: boolean;
  retrying?: boolean;
  onRetry?: () => void;
};

/** FLOW-119. ללא פרויקט first, then active projects and the current one even if finished. */
export function LoanProjectPicker({
  source,
  selectedId,
  saving,
  onSelect,
}: {
  source: LoanProjectSource;
  selectedId: string | null;
  /** The row being written. Absent when nothing is saving. */
  saving?: { id: string | null };
  onSelect: (id: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const loading = source.loading === true;
  const failed = !loading && source.error === true;
  const listed = source.rows.filter((row) => row.status !== "finished" || row.id === selectedId);
  const needle = query.trim();
  const searchable = !loading && !failed && listed.length > PROJECT_SEARCH_FROM;
  const lowered = needle.toLowerCase();
  const shown = searchable && needle !== ""
    ? listed.filter((row) => row.name.includes(needle) || (row.code ?? "").toLowerCase().includes(lowered))
    : listed;
  // "או קוד" only once a project has a code to search by.
  const withCodes = listed.some((row) => row.code != null && row.code !== "");
  const busy = saving != null;
  return (
    <div className="ui-change-picker">
      {searchable ? (
        <SearchField
          label="חיפוש פרויקט"
          value={query}
          onChange={setQuery}
          placeholder={withCodes ? "חיפוש פרויקט או קוד" : "חיפוש פרויקט"}
          autoFocus={false}
        />
      ) : null}
      <div role="radiogroup" aria-label="פרויקט">
        <RadioRow
          layout="picker"
          label={NO_PROJECT}
          selected={selectedId == null}
          busy={busy && saving.id == null}
          disabled={busy && saving.id != null}
          onSelect={() => { onSelect(null); }}
        />
        {loading || failed ? null : shown.map((row) => (
          <RadioRow
            key={row.id}
            layout="picker"
            label={row.name}
            code={row.code ?? undefined}
            description={row.status === "finished" ? "הסתיים" : undefined}
            selected={row.id === selectedId}
            busy={busy && saving.id === row.id}
            disabled={busy && saving.id !== row.id}
            onSelect={() => { onSelect(row.id); }}
          />
        ))}
      </div>
      {loading ? (
        <div aria-busy="true">
          <p className="sr-only" role="status">טוען…</p>
          {projectSkeleton.map((key) => (
            <div className="ui-radio-row" key={key} aria-hidden="true">
              <Skeleton width="md" />
            </div>
          ))}
        </div>
      ) : null}
      {failed ? (
        <LoanReadError label="פרויקטים" busy={source.retrying === true} onRetry={() => { source.onRetry?.(); }} />
      ) : null}
      {!loading && !failed && listed.length === 0 ? <p className="t-hint">אין עדיין פרויקטים.</p> : null}
      {searchable && needle !== "" && shown.length === 0 ? <p className="t-hint">לא נמצא פרויקט בשם הזה</p> : null}
    </div>
  );
}

function projectNameOf(source: LoanProjectSource, id: string | null): string | null {
  if (id == null) return null;
  return source.rows.find((row) => row.id === id)?.name ?? null;
}

function projectFailure(error: Error): string {
  const code = (error as { code?: string }).code;
  if (code === "42501") return "אין הרשאה לעדכן הלוואה.";
  if (code === "23503") return "הפרויקט לא נמצא.";
  return "לא הצלחנו לעדכן את הפרויקט.";
}

/** FLOW-119. An existing loan: the sheet is the picker, and a tap saves (0075). */
function LoanProjectSheet({
  loan,
  open,
  onOpenChange,
  source,
  returnFocusRef,
  busyRef,
}: {
  loan: LoanBalanceRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: LoanProjectSource;
  returnFocusRef: { current: HTMLElement | null };
  /** True while a tap is saving. The parent's Back handler waits on it. */
  busyRef?: { current: boolean };
}) {
  const toast = useToast();
  const holdWrites = useHoldWrites();
  const [picked, setPicked] = useState<string | null>(loan?.projectId ?? null);
  const [saving, setSaving] = useState<{ id: string | null } | undefined>(undefined);
  useEffect(() => {
    if (open) setPicked(loan?.projectId ?? null);
  }, [open, loan?.id, loan?.projectId]);
  const save = useWrite<{ loanId: string; projectId: string | null }>({
    failure: projectFailure,
    keys: ["loans", "project"],
    onSuccess: ({ projectId }) => {
      toast.show({ message: projectId == null ? "ההלוואה הוסרה מהפרויקט" : "ההלוואה שויכה לפרויקט" });
      onOpenChange(false);
    },
    run: async ({ loanId, projectId }) => {
      if (holdWrites) throw new Error("preview");
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase.from("loans").update({ project_id: projectId }).eq("id", loanId).select("id");
      assertNoError(result);
      // RLS filters a refused row without an error: no row back is a refusal.
      if ((result.data ?? []).length === 0) throw Object.assign(new Error("refused"), { code: "42501" });
    },
  });
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && saving != null) return;
        onOpenChange(next);
      }}
      title="פרויקט"
      hint={loan?.name}
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-fit"
    >
      <LoanProjectPicker
        source={source}
        selectedId={picked}
        saving={saving}
        onSelect={(id) => {
          if (loan == null || saving != null) return;
          if (id === (loan.projectId ?? null)) {
            onOpenChange(false);
            return;
          }
          const previous = picked;
          setPicked(id);
          setSaving({ id });
          if (busyRef) busyRef.current = true;
          save.mutate({ loanId: loan.id, projectId: id }, {
            onError: () => { setPicked(previous); },
            onSettled: () => {
              if (busyRef) busyRef.current = false;
              setSaving(undefined);
            },
          });
        }}
      />
    </Sheet>
  );
}

/** Sample balances for stories and preview. Live omits it and reads `loans`. */
export type LoanRowsSample = readonly LoanBalanceRow[] | "loading" | "error";

export const LOANS_EMPTY_TITLE = "אין הלוואות עדיין";
export const LOANS_EMPTY_OWNER = "הוסיפו הלוואה כדי לפצל כל תשלום לריבית, מסים וביטוח וקרן.";
export const LOANS_EMPTY_VIEWER = "כשיתווספו הלוואות הן יופיעו כאן.";
export const LOANS_ERROR_TITLE = "לא הצלחנו לטעון את ההלוואות";

/**
 * The body of `/settings/loans` (FLOW-501): the balances, then הלוואה חדשה.
 * A viewer reads the balances as static rows and gets no new-loan row (U10).
 * A row tap opens the project sheet (FLOW-119) until FLOW-110's detail page.
 */
export function LoanSettingsSection({
  companyId,
  companyCurrency,
  blocked,
  projects,
  sample,
}: {
  companyId: string | null;
  /** Preview passes this. Live omits it and reads the company's lines. */
  companyCurrency?: LoanCurrency;
  blocked?: () => boolean;
  /** FLOW-119. The projects the loan can sit under. */
  projects?: LoanProjectSource;
  sample?: LoanRowsSample;
}) {
  const source: LoanProjectSource = projects ?? { rows: [] };
  const [open, setOpenState] = useState(false);
  const [view, setView] = useState<"form" | "project">("form");
  const [draftProject, setDraftProject] = useState<string | null>(null);
  // The picker keeps the form's height, so the sheet does not jump when they swap.
  const [formHeight, setFormHeight] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const projectFieldRef = useRef<HTMLButtonElement>(null);
  const sheetTitle = useRef<HTMLHeadingElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const posted = useRef(false);
  const draftRef = useRef<LoanSetupInitial | null>(null);
  const keepDraft = useRef(false);
  const clearDraft = useCallback(() => {
    keepDraft.current = false;
    draftRef.current = null;
    setDraftProject(null);
    setView("form");
  }, []);
  const setOpen = useCallback((next: boolean) => {
    if (!next) clearDraft();
    setOpenState(next);
  }, [clearDraft]);
  // Back in the picker view returns to the form, like Escape and חזרה.
  const setSheet = useSheetHistory("loan-new", open, setOpen, () => {
    if (view !== "project") return true;
    backToForm();
    return false;
  });
  const [editing, setEditing] = useState<LoanBalanceRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const editBusy = useRef(false);
  // Back during a save waits for it, like ✕ and Escape (0075).
  const setEditSheet = useSheetHistory("loan-project", editOpen, setEditOpen, () => !editBusy.current);
  const loanRows = useRef(new Map<string, HTMLButtonElement>());
  const editReturn = useRef<HTMLElement | null>(null);
  const balances = useLoanBalances(sample == null ? companyId : null);
  const holdWrites = useHoldWrites();
  const emptyButton = useRef<HTMLButtonElement>(null);
  const query = useQuery({
    queryKey: ["loan-currency", companyId],
    enabled: companyCurrency == null && companyId != null,
    retry: false,
    queryFn: readCompanyLoanCurrency,
  });
  const currency: LoanCurrency | null = companyCurrency
    ?? query.data
    ?? (query.isFetched || companyId == null ? "ILS" : null);
  const save = useWrite<Omit<LoanInsert, "company_id">>({
    failure: (error) => {
      const code = (error as { code?: string }).code;
      if (code === "42501") return "אין הרשאה לשמור הלוואה.";
      if (code === "23503") return "הפרויקט לא נמצא.";
      return "לא הצלחנו לשמור את ההלוואה.";
    },
    success: "ההלוואה נשמרה",
    keys: ["loans", "project"],
    onSuccess: () => {
      clearDraft();
      setSheet(false);
    },
    run: async (row) => {
      if (holdWrites) throw new Error("preview");
      const supabase = getSupabase();
      if (!supabase || companyId == null) throw new Error("supabase");
      assertNoError(await supabase.from("loans").insert({ ...row, company_id: companyId }));
    },
  });

  function setLoanSheet(next: boolean) {
    if (next && holdWrites) return;
    if (next) keepDraft.current = true;
    else clearDraft();
    setSheet(next);
  }

  function openPicker() {
    setFormHeight(formRef.current?.offsetHeight ?? null);
    setView("project");
    // The פרויקט field is hidden now. Focus the title, like the change sheet's picker.
    requestAnimationFrame(() => { sheetTitle.current?.focus({ preventScroll: true }); });
  }

  function backToForm() {
    setView("form");
    requestAnimationFrame(() => { projectFieldRef.current?.focus({ preventScroll: true }); });
  }

  const picking = view === "project";
  const loading = sample === "loading" || (sample == null && balances.isLoading);
  const failed = sample === "error" || (sample == null && balances.isError);
  const rows: readonly LoanBalanceRow[] = Array.isArray(sample) ? sample : sample == null ? (balances.data ?? []) : [];
  const empty = !loading && !failed && rows.length === 0;
  const newLoanReturn = empty ? emptyButton : rowRef;

  return (
    <>
      {loading ? (
        <>
          <p className="sr-only" role="status">טוען…</p>
          <List>
            <ListRow variant="skeleton" />
            <ListRow variant="skeleton" />
          </List>
        </>
      ) : failed ? (
        <EmptyState
          icon={<InfoIcon size={36} />}
          title={LOANS_ERROR_TITLE}
          body="נסו שוב בעוד רגע"
          action={(
            <Button
              variant="pill"
              className="ui-btn-retry"
              icon={<RefreshIcon />}
              busy={sample == null && balances.isFetching}
              onClick={() => { if (sample == null) void balances.refetch(); }}
            >
              ניסיון חוזר
            </Button>
          )}
        />
      ) : empty ? (
        <EmptyState
          icon={<LoanIcon />}
          title={LOANS_EMPTY_TITLE}
          body={holdWrites ? LOANS_EMPTY_VIEWER : LOANS_EMPTY_OWNER}
          action={holdWrites ? undefined : (
            <Button variant="pill" icon={<PlusIcon />} buttonRef={emptyButton} onClick={() => { setLoanSheet(true); }}>
              הלוואה חדשה
            </Button>
          )}
        />
      ) : (
        <LoanBalanceList
          rows={rows}
          onOpen={holdWrites ? undefined : (row) => {
            if (blocked?.()) return;
            editReturn.current = loanRows.current.get(row.id) ?? null;
            setEditing(row);
            setEditSheet(true);
          }}
          rowRef={(id, node) => {
            if (node) loanRows.current.set(id, node);
            else loanRows.current.delete(id);
          }}
        />
      )}
      {holdWrites || failed || empty ? null : (
        <List>
          <ListRow
            variant="button"
            title="הלוואה חדשה"
            icon={<LoanIcon />}
            chevron
            buttonRef={rowRef}
            onClick={() => { setLoanSheet(true); }}
          />
        </List>
      )}
      <Sheet
        open={holdWrites ? false : open}
        onOpenChange={setLoanSheet}
        title={picking ? "פרויקט" : "הלוואה"}
        titleRef={sheetTitle}
        returnFocusRef={newLoanReturn}
        leading={picking ? (
          <IconButton label="חזרה" onClick={backToForm}>
            <BackIcon />
          </IconButton>
        ) : undefined}
        onEscape={picking ? backToForm : undefined}
      >
        {currency == null ? (
          <p role="status">טוען…</p>
        ) : (
          <>
            {picking ? (
              <div style={formHeight ? { minHeight: formHeight } : undefined}>
                <LoanProjectPicker
                  source={source}
                  selectedId={draftProject}
                  onSelect={(id) => {
                    setDraftProject(id);
                    backToForm();
                  }}
                />
              </div>
            ) : null}
            <div hidden={picking} ref={formRef}>
              <LoanSetupForm
                companyCurrency={currency}
                initial={draftRef.current ?? undefined}
                busy={save.isPending}
                saveButtonRef={saveButton}
                keepDraft={keepDraft}
                onDraft={(next) => { draftRef.current = next; }}
                project={{
                  name: projectNameOf(source, draftProject),
                  buttonRef: projectFieldRef,
                  onOpen: openPicker,
                }}
                onSave={(row) => {
                  if (holdWrites || blocked?.()) return;
                  if (posted.current || save.isPending) return;
                  posted.current = true;
                  save.mutate({ ...row, project_id: draftProject }, {
                    onError: (error) => {
                      if ((error as { code?: string }).code === "23503") setDraftProject(null);
                      saveButton.current?.focus();
                    },
                    onSettled: () => { posted.current = false; },
                  });
                }}
              />
            </div>
          </>
        )}
      </Sheet>
      {holdWrites ? null : (
        <LoanProjectSheet
          loan={editing}
          open={editOpen}
          onOpenChange={setEditSheet}
          source={source}
          returnFocusRef={editReturn}
          busyRef={editBusy}
        />
      )}
    </>
  );
}
