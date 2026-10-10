import { useQuery } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type Ref, type SubmitEvent } from "react";
import type { LoanKind } from "@flow/shared";
import { BackIcon, CalendarIcon, ChevronDownIcon, InfoIcon, LoanIcon, PlusIcon, RefreshIcon } from "../ui/icons";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { List, ListRow } from "../ui/list-row";
import { MoneyField, PercentField } from "../ui/money-field";
import { SegmentedControl } from "../ui/segmented-control";
import { Skeleton } from "../ui/skeleton";
import { DateSheet } from "../ui/date-sheet";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { Button } from "../ui/button";
import { useSheetHistory } from "../ui/back";
import { useToast } from "../ui/toast";
import { usePreviewSearch } from "../preview";
import { formatDisplay } from "../ui/date-math";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { useOpenFromQuery } from "../open-from-query";
import { useHoldWrites } from "../use-is-viewer";
import { RadioRow } from "../ui/radio-row";
import { LOAN_KIND_LABEL } from "./loan-copy";
import { LOAN_KIND_DESCRIPTION } from "./loan-detail-data";
import {
  LOAN_CURRENCY_MARK,
  firstOfNextMonth,
  formatLoanMoney,
  loanFieldErrors,
  loanFinalLine,
  loanPreview,
  minorToInput,
  newLoanKindMonths,
  readCompanyLoanCurrency,
  type LoanCurrency,
  type LoanDraft,
  type LoanField,
  type LoanInsert,
  type LoanPreview,
} from "./loan-form";
import { LoanGroupedList, groupLoans, useLoanList, type LoanListRow } from "./loan-list";
import { type LoanProjectField, LoanProjectPicker, type LoanProjectSource, NO_PROJECT, projectNameOf } from "./loan-project-picker";

// Moved to their own files (FLOW-807). Import from those files in new code.
export { type LoanProjectChoice, type LoanProjectField, type LoanProjectSource, LoanProjectPicker } from "./loan-project-picker";

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
  /** FLOW-106 §3.3: the interest-only or amortization months. */
  kindMonths?: string;
};

/** FLOW-106 §3.3: the סוג field. The sheet owns the choice and the picker view, like פרויקט. */
export type LoanKindField = {
  value: LoanKind;
  buttonRef?: Ref<HTMLButtonElement>;
  onOpen: () => void;
};

const LOAN_KINDS: readonly LoanKind[] = ["amortizing", "interest_only", "balloon", "demand"];

/** The סוג view inside the new-loan sheet: one row per kind, each with its one-line description. */
export function LoanKindPicker({ selected, onSelect }: { selected: LoanKind; onSelect: (kind: LoanKind) => void }) {
  return (
    <div role="radiogroup" aria-label="סוג ההלוואה">
      {LOAN_KINDS.map((option) => (
        <RadioRow
          key={option}
          value={option}
          label={LOAN_KIND_LABEL[option]}
          description={LOAN_KIND_DESCRIPTION[option]}
          selected={selected === option}
          onSelect={() => { onSelect(option); }}
        />
      ))}
    </div>
  );
}

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
  kind: kindField,
  formId,
  saveInFoot = false,
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
  /** FLOW-106 §3.3. The סוג field; without it the loan is a regular (amortizing) one. */
  kind?: LoanKindField;
  /** The form's id, so a שמירה outside it (the sheet's foot) submits it. */
  formId?: string;
  /** FLOW-347: the sheet pins שמירה in its foot (`LoanSaveButton`), so the form leaves it out. */
  saveInFoot?: boolean;
}) {
  const panelId = useId();
  const dateLabelId = useId();
  const projectLabelId = useId();
  const projectValueId = useId();
  const kindLabelId = useId();
  const kindValueId = useId();
  const kind: LoanKind = kindField?.value ?? "amortizing";
  const demand = kind === "demand";
  const [name, setName] = useState(initial?.name ?? "");
  const [principal, setPrincipal] = useState(initial?.principal ?? "");
  const [rate, setRate] = useState(initial?.rate ?? "");
  const [term, setTerm] = useState(initial?.term ?? "360");
  const [startDate, setStartDate] = useState(initial?.startDate ?? firstOfNextMonth());
  const [escrow, setEscrow] = useState(initial?.escrow ?? "0");
  const [currency, setCurrency] = useState<LoanCurrency>(initial?.currency ?? companyCurrency);
  const [payment, setPayment] = useState<string | null>(initial?.payment ?? null);
  const [kindMonths, setKindMonths] = useState(initial?.kindMonths ?? newLoanKindMonths(kind, initial?.term ?? "360"));
  // A new kind starts its months field at that kind's default (the loan page's defaults).
  const shownKind = useRef(kind);
  useEffect(() => {
    if (shownKind.current === kind) return;
    shownKind.current = kind;
    setKindMonths(newLoanKindMonths(kind, term));
    setTouched((current) => ({ ...current, months: false }));
    // Only a kind change resets the months; the term is read at that moment.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);
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
    kind,
    kindMonths,
  }), [name, principal, rate, term, startDate, escrow, currency, payment, kind, kindMonths]);
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
      kindMonths,
    });
  }, [name, principal, rate, term, startDate, escrow, currency, payment, kindMonths, keepDraft]);

  const formRef = useRef<HTMLFormElement>(null);
  function submit(event: SubmitEvent) {
    event.preventDefault();
    setChecked(true);
    if (invalid && !busy) {
      // FLOW-343: focus (and so scroll to) the first field that needs typing, once its error shows.
      requestAnimationFrame(() => {
        const first = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
        if (!first) return;
        first.focus({ preventScroll: true });
        if (typeof first.scrollIntoView === "function") first.scrollIntoView({ block: "center" });
      });
    }
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
    <form ref={formRef} id={formId} className="ui-stack" onSubmit={submit} onKeyDown={onFormEnter}>
      {kindField ? (
        <div className="ui-field">
          <span id={kindLabelId} className="ui-field-label">סוג</span>
          <button
            type="button"
            ref={kindField.buttonRef}
            className="ui-field-control ui-date-field"
            aria-labelledby={`${kindLabelId} ${kindValueId}`}
            aria-haspopup="dialog"
            disabled={busy}
            onClick={kindField.onOpen}
          >
            <span id={kindValueId} className="ui-pick-value" data-clip-ok="">{LOAN_KIND_LABEL[kind]}</span>
            <ChevronDownIcon size={20} />
          </button>
          <span className="ui-field-message ui-field-message-slot" aria-hidden="true" />
        </div>
      ) : null}
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
      {/* FLOW-115: the currency belongs to the amount, --space-2 under it; a message-height slot keeps the field rhythm. */}
      <div className="ui-loan-amount-field">
      <MoneyField
        label="סכום מקורי"
        value={principal}
        prefix={mark}
        disabled={busy}
        keepMinus
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
      <span className="ui-field-message ui-field-message-slot" aria-hidden="true" />
      </div>
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
      {demand ? null : (
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
      )}
      {kind === "interest_only" || kind === "balloon" ? (
        <TextField
          label={kind === "interest_only" ? "חודשי ריבית בלבד" : "פריסה בחודשים"}
          value={kindMonths}
          dir="ltr"
          inputMode="numeric"
          numeric
          disabled={busy}
          reserveMessage
          enterKeyHint="next"
          error={shownError("months")}
          onBlur={() => { touch("months"); }}
          onChange={(event) => { setKindMonths(event.target.value.replace(/\D/g, "").slice(0, 3)); }}
        />
      ) : null}
      <div className="ui-field">
        <span id={dateLabelId} className="ui-field-label">{demand ? "תאריך התחלה" : "תאריך תשלום ראשון"}</span>
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
        {/* Same rhythm as the fields around it, which reserve their message line. */}
        <span className="ui-field-message ui-field-message-slot" aria-hidden="true" />
      </div>
      <DateSheet
        open={dateOpen}
        onOpenChange={setDateOpen}
        title={demand ? "תאריך התחלה" : "תאריך תשלום ראשון"}
        value={startDate}
        allowFuture
        shortcuts={false}
        disabled={busy}
        onApply={setStartDate}
      />
      {demand ? null : (
      <>
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
      </>
      )}
      {/* FLOW-344 (B): the preview shows only while every field is valid, so it never reads as another loan's payment. */}
      {/* Empty, the region leaves the layout, so the gap above שמירה is the usual one between fields. */}
      <div aria-live="polite" className={canSave && shown ? undefined : "sr-only"}>
        {canSave && shown && demand ? (
          <p className="ui-row-hint">ריבית יומית על היתרה, בלי לוח תשלומים.</p>
        ) : canSave && shown ? (
          <>
          <p>
            {kind === "interest_only" ? "תשלום אחרי חודשי הריבית" : "תשלום חודשי"}{" "}
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
          </>
        ) : null}
      </div>
      {/* FLOW-344: the payment error takes a line only when there is one; the preview above no longer jumps. */}
      {!advanced && !demand && shownError("payment") != null ? (
        <p className="ui-field-message" role="alert">{shownError("payment")}</p>
      ) : null}
      {/* FLOW-115: always tappable; a tap shows each field's error, and each says what to type. */}
      {saveInFoot ? null : <Button type="submit" buttonRef={saveButtonRef} busy={busy}>שמירה</Button>}
    </form>
  );
}

/**
 * FLOW-347: שמירה pinned in the loan sheet's foot, so a long form never needs a scroll to save.
 * It submits the form by id, so Enter and the form's own checks work as before.
 */
export function LoanSaveButton({ formId, busy = false, buttonRef }: { formId: string; busy?: boolean; buttonRef?: Ref<HTMLButtonElement> }) {
  return <Button type="submit" form={formId} full buttonRef={buttonRef} busy={busy}>שמירה</Button>;
}

/** Sample balances for stories and preview. Live omits it and reads `loans`. */
export type LoanRowsSample = readonly LoanListRow[] | "loading" | "error";

export const LOANS_EMPTY_TITLE = "אין הלוואות עדיין";
export const LOANS_EMPTY_OWNER = "הוסיפו הלוואה כדי לפצל כל תשלום לריבית, מסים וביטוח וקרן.";
export const LOANS_EMPTY_VIEWER = "כשיתווספו הלוואות הן יופיעו כאן.";
export const LOANS_ERROR_TITLE = "לא הצלחנו לטעון את ההלוואות";

/**
 * The body of `/settings/loans` (FLOW-501): the balances, then הלוואה חדשה.
 * A viewer reads the balances as static rows and gets no new-loan row (U10).
 * Open loans come first, then "נסגרו (N)", collapsed (FLOW-106). A row opens the loan's page,
 * where its project now lives (FLOW-106 B moved the FLOW-119 sheet there).
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
  const navigate = useNavigate();
  const location = useLocation();
  const search = usePreviewSearch();
  const toast = useToast();
  const savedId = useRef<string | null>(null);
  // The page sits under this list's path: /settings/loans/:id, or /e2e/loans/:id in the dev fixture.
  const loanHref = (id: string) => `${location.pathname.replace(/\/$/, "")}/${encodeURIComponent(id)}${search}`;
  const [open, setOpenState] = useState(false);
  const [view, setView] = useState<"form" | "project" | "kind">("form");
  const [draftProject, setDraftProject] = useState<string | null>(null);
  const [draftKind, setDraftKind] = useState<LoanKind>("amortizing");
  // The picker keeps the form's height, so the sheet does not jump when they swap.
  const [formHeight, setFormHeight] = useState<number | null>(null);
  const formRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLButtonElement>(null);
  const projectFieldRef = useRef<HTMLButtonElement>(null);
  const kindFieldRef = useRef<HTMLButtonElement>(null);
  const sheetTitle = useRef<HTMLHeadingElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const loanFormId = useId();
  const posted = useRef(false);
  const draftRef = useRef<LoanSetupInitial | null>(null);
  const keepDraft = useRef(false);
  const clearDraft = useCallback(() => {
    keepDraft.current = false;
    draftRef.current = null;
    setDraftProject(null);
    setDraftKind("amortizing");
    setView("form");
  }, []);
  const setOpen = useCallback((next: boolean) => {
    if (!next) clearDraft();
    setOpenState(next);
  }, [clearDraft]);
  // Back in the picker view returns to the form, like Escape and חזרה.
  const adoptNew = useRef(false);
  const setSheet = useSheetHistory("loan-new", open, setOpen, () => {
    // FLOW-115: Back during a save waits for it, like ✕ and Escape (0075).
    if (posted.current) return false;
    if (view === "form") return true;
    backToForm();
    return false;
  }, adoptNew);
  const balances = useLoanList(sample == null ? companyId : null);
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
    keys: ["loans", "project"],
    onSuccess: () => {
      posted.current = false;
      clearDraft();
      setSheet(false);
      const id = savedId.current;
      // FLOW-106 B: the toast opens the new loan's page, where its categories are set.
      toast.show({
        message: "ההלוואה נשמרה",
        ...(id == null ? {} : { action: "פתיחה", onAction: () => { void navigate(loanHref(id)); } }),
      });
    },
    run: async (row) => {
      if (holdWrites) throw new Error("preview");
      const supabase = getSupabase();
      if (!supabase || companyId == null) throw new Error("supabase");
      savedId.current = null;
      const inserted = await supabase.from("loans").insert({ ...row, company_id: companyId }).select("id").single();
      assertNoError(inserted);
      savedId.current = typeof inserted.data?.id === "string" ? inserted.data.id : null;
    },
  });

  function setLoanSheet(next: boolean) {
    if (next && holdWrites) return;
    if (next) keepDraft.current = true;
    else clearDraft();
    setSheet(next);
  }

  // FLOW-331: + → הלוואה חדשה lands on /settings/loans with ?new=loan.
  useOpenFromQuery("loan", !holdWrites && currency != null, (sameEntry) => {
    adoptNew.current = sameEntry;
    setLoanSheet(true);
  });

  function openPicker(next: "project" | "kind" = "project") {
    setFormHeight(formRef.current?.offsetHeight ?? null);
    setView(next);
    // The פרויקט field is hidden now. Focus the title, like the change sheet's picker.
    requestAnimationFrame(() => { sheetTitle.current?.focus({ preventScroll: true }); });
  }

  function backToForm() {
    const field = view === "kind" ? kindFieldRef : projectFieldRef;
    setView("form");
    requestAnimationFrame(() => { field.current?.focus({ preventScroll: true }); });
  }

  const picking = view !== "form";
  const loading = sample === "loading" || (sample == null && balances.isLoading);
  const failed = sample === "error" || (sample == null && balances.isError);
  const rows: readonly LoanListRow[] = Array.isArray(sample) ? sample : sample == null ? (balances.data ?? []) : [];
  // Only closed loans: the empty state shows, with "הלוואות שנסגרו (N)" under it (§3.1).
  const empty = !loading && !failed && groupLoans(rows).open.length === 0;
  const newLoanReturn = empty ? emptyButton : rowRef;

  return (
    <>
      {loading ? (
        <>
          <p className="sr-only" role="status">טוען…</p>
          <List className="ui-loan-skel-rows">
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
            // The tint action every empty and error state uses (DESIGN-RULES §2.8, FLOW-334), not a fill.
            <Button
              variant="pill"
              icon={<RefreshIcon />}
              busy={sample == null && balances.isFetching}
              onClick={() => { if (sample == null) void balances.refetch(); }}
            >
              ניסיון חוזר
            </Button>
          )}
        />
      ) : (
        <>
          {empty ? (
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
          ) : null}
          {/* A viewer reads the loan's page too, as static rows. */}
          <LoanGroupedList
            rows={rows}
            onOpen={(row) => { void navigate(loanHref(row.id)); }}
          />
        </>
      )}
      {holdWrites || failed || empty ? null : (
        <List className="ui-loan-new">
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
        title={view === "kind" ? "סוג ההלוואה" : picking ? "פרויקט" : "הלוואה"}
        titleRef={sheetTitle}
        returnFocusRef={newLoanReturn}
        leading={picking ? (
          <IconButton label="חזרה" className="ui-back-btn" onClick={backToForm}>
            <BackIcon />
          </IconButton>
        ) : undefined}
        onEscape={picking ? backToForm : undefined}
        onBeforeClose={() => !posted.current}
        action={currency == null || picking ? undefined : (
          <LoanSaveButton formId={loanFormId} busy={save.isPending} buttonRef={saveButton} />
        )}
      >
        {currency == null ? (
          // FLOW-115: the form's shape while the currency read lands, so the sheet does not jump.
          <div className="ui-stack ui-loan-skeleton" aria-busy="true">
            <p className="sr-only" role="status">טוען…</p>
            <div className="ui-loan-skel-field" key="a">
              <Skeleton width="sm" />
              <Skeleton className="ui-loan-skel-control" />
            </div>
            <div className="ui-loan-skel-field" key="b">
              <Skeleton width="sm" />
              <Skeleton className="ui-loan-skel-control" />
            </div>
            <div className="ui-loan-skel-field" key="c">
              <Skeleton width="sm" />
              <Skeleton className="ui-loan-skel-control" />
            </div>
            <div className="ui-loan-skel-field" key="d">
              <Skeleton width="sm" />
              <Skeleton className="ui-loan-skel-control" />
            </div>
          </div>
        ) : (
          <>
            {view === "kind" ? (
              <div style={formHeight ? { minHeight: formHeight } : undefined}>
                <LoanKindPicker
                  selected={draftKind}
                  onSelect={(next) => {
                    setDraftKind(next);
                    backToForm();
                  }}
                />
              </div>
            ) : null}
            {view === "project" ? (
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
                formId={loanFormId}
                saveInFoot
                keepDraft={keepDraft}
                onDraft={(next) => { draftRef.current = next; }}
                project={{
                  name: projectNameOf(source, draftProject),
                  buttonRef: projectFieldRef,
                  onOpen: () => { openPicker("project"); },
                }}
                kind={{
                  value: draftKind,
                  buttonRef: kindFieldRef,
                  onOpen: () => { openPicker("kind"); },
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
    </>
  );
}
