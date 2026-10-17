import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type Ref, type SubmitEvent } from "react";
import type { LoanKind } from "@flow/shared";
import { CalendarIcon } from "../ui/icons";
import { MoneyField, PercentField } from "../ui/money-field";
import { SegmentedControl } from "../ui/segmented-control";
import { DateSheet } from "../ui/date-sheet";
import { TextField } from "../ui/text-field";
import { Button } from "../ui/button";
import { formatDisplay } from "../ui/date-math";
import { RadioRow } from "../ui/radio-row";
import { LOAN_KIND_LABEL } from "./loan-copy";
import { LOAN_KIND_DESCRIPTION } from "./loan-detail-data";
import {
  LOAN_CURRENCY_MARK,
  firstOfNextMonth,
  formatLoanMoney,
  lastPaymentLabel,
  loanFieldErrors,
  loanFinalLine,
  type LoanFinalLine,
  loanPreview,
  minorToInput,
  newLoanKindMonths,
  paymentSplitParts,
  termYearsLabel,
  type LoanCurrency,
  type LoanDraft,
  type LoanField,
  type LoanInsert,
  type LoanPreview,
} from "./loan-form";
import { type LoanProjectField } from "./loan-project-picker";
import { LoanCurrencySwitch, LoanPaymentCard, LoanPickRow, LoanSectionTitle } from "./loan-new-parts";

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
    <div role="radiogroup" aria-label="סוג ההלוואה" className="ui-choice-sheet ui-loan-kinds">
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

/** The card's split line: the label, then the interest and the escrow, each amount LTR on its own. */
function splitNode(kind: LoanKind, figures: ReadyPreview, currency: LoanCurrency): ReactNode {
  const parts = paymentSplitParts(kind, figures.paymentMinor, figures.escrowMinor, currency);
  return (
    <>
      {parts.label} <bdi className="ui-num" dir="ltr">{parts.interest}</bdi> · מסים וביטוח <bdi className="ui-num" dir="ltr">{parts.escrow}</bdi>
    </>
  );
}

/** The final-payment line: its lead, the times (above twice), and the amount. */
function finalLineNode(line: LoanFinalLine, currency: LoanCurrency): ReactNode {
  return (
    <>
      {line.lead}
      {line.times ? <>{" "}<bdi className="ui-num" dir="ltr">{line.times}</bdi></> : null}
      {", "}
      <bdi className="ui-num" dir="ltr">{formatLoanMoney(line.amountMinor, currency)}</bdi>
    </>
  );
}

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
  const kind: LoanKind = kindField?.value ?? "amortizing";
  const demand = kind === "demand";
  // The sheet's board layout (the kind field is its mark): titled blocks, pick rows, a 2-column pair.
  const sheetMode = kindField != null;
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

  // The payment card: the figures show only while every field is valid (FLOW-344), else zeros or a dash.
  const figures = canSave && shown != null ? shown : null;
  const termNumber = /^\d{1,3}$/.test(term) && Number(term) >= 1 ? Number(term) : null;
  const until = !demand && termNumber != null && /^\d{4}-\d{2}-\d{2}$/.test(startDate)
    ? `תשלום אחרון ${lastPaymentLabel(startDate, termNumber)}`
    : "";
  const interestOnly = kind === "interest_only";

  const rateAndTerm = (
    <>
      <PercentField
        label="ריבית שנתית"
        value={rate}
        decimals={4}
        disabled={busy}
        keepMinus
        reserveMessage={!sheetMode}
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
          reserveMessage={!sheetMode}
          enterKeyHint="next"
          hint={sheetMode ? termYearsLabel(term) : undefined}
          error={shownError("term")}
          onBlur={() => { touch("term"); }}
          onChange={(event) => { onTerm(event.target.value); }}
        />
      )}
    </>
  );

  return (
    <form ref={formRef} id={formId} className="ui-stack ui-loan-form" onSubmit={submit} onKeyDown={onFormEnter}>
      {sheetMode ? <LoanSectionTitle>מלווה ופרויקט</LoanSectionTitle> : null}
      <TextField
        label="מלווה"
        value={name}
        maxLength={80}
        disabled={busy}
        reserveMessage={!sheetMode}
        enterKeyHint="next"
        placeholder={sheetMode ? "למשל: Pinecrest Lending" : undefined}
        error={shownError("name")}
        onBlur={() => { touch("name"); }}
        onChange={(event) => { setName(event.target.value); }}
      />
      {project ? (
        <LoanPickRow
          label="פרויקט"
          value={project.name ?? "ללא פרויקט"}
          empty={project.name == null}
          buttonRef={project.buttonRef}
          disabled={busy}
          onOpen={project.onOpen}
        />
      ) : null}
      {kindField ? (
        <>
          <LoanSectionTitle className="ui-loan-section-gap">תנאים</LoanSectionTitle>
          <LoanPickRow label="סוג" value={LOAN_KIND_LABEL[kind]} buttonRef={kindField.buttonRef} disabled={busy} onOpen={kindField.onOpen} />
        </>
      ) : null}
      {/* FLOW-115: the currency belongs to the amount. In the sheet it sits inside the field; onboarding keeps it under. */}
      {sheetMode ? (
        <MoneyField
          label="סכום מקורי"
          value={principal}
          prefix=""
          disabled={busy}
          keepMinus
          enterKeyHint="next"
          error={shownError("principal")}
          onBlur={() => { touch("principal"); }}
          onValueChange={setPrincipal}
          trailing={<LoanCurrencySwitch value={currency} disabled={busy} onChange={setCurrency} />}
        />
      ) : (
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
      )}
      {sheetMode ? <div className="ui-loan-grid">{rateAndTerm}</div> : rateAndTerm}
      {kind === "interest_only" || kind === "balloon" ? (
        <TextField
          label={interestOnly ? "חודשי ריבית בלבד" : "פריסה לחישוב התשלום (חודשים)"}
          value={kindMonths}
          dir="ltr"
          inputMode="numeric"
          numeric
          disabled={busy}
          reserveMessage={!sheetMode}
          enterKeyHint="next"
          hint={sheetMode ? (interestOnly ? "אחריהם הקרן נפרסת על שאר התקופה" : "היתרה בסוף התקופה תשולם בתשלום אחד") : undefined}
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
        <MoneyField
          label="מסים וביטוח לחודש (escrow)"
          value={escrow}
          prefix={sheetMode ? "" : mark}
          disabled={busy}
          keepMinus
          reserveMessage={!sheetMode}
          enterKeyHint={advanced ? "next" : "done"}
          hint={sheetMode ? "אם נגבים יחד עם התשלום. אחרת השאירו 0" : undefined}
          error={shownError("escrow")}
          onBlur={() => { touch("escrow"); }}
          onValueChange={setEscrow}
        />
      )}
      <LoanPaymentCard
        label={interestOnly ? "תשלום אחרי חודשי הריבית" : "תשלום חודשי"}
        total={demand ? "—" : formatLoanMoney(figures?.paymentMinor ?? 0n, currency)}
        split={demand ? "לפי דרישה: בלי לוח תשלומים קבוע" : figures ? splitNode(kind, figures, currency) : ""}
        until={until}
        note={figures && finalLine ? {
          content: finalLineNode(finalLine, currency),
          caution: finalLine.tone === "caution",
        } : null}
        expanded={advanced}
        controls={panelId}
        disabled={busy}
        changeable={!demand}
        onToggle={() => { setAdvanced((open) => !open); }}
      >
        {advanced && !demand ? (
          <div id={panelId} className="ui-loan-pay-override">
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
      </LoanPaymentCard>
      {/* FLOW-344: the payment error takes a line only when there is one; the card above no longer jumps. */}
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
