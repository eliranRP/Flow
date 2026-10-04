import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type Ref, type SubmitEvent } from "react";
import { BankIcon, CalendarIcon, ChevronDownIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { SectionHead } from "../ui/layout";
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
  type LoanInsert,
  type LoanPreview,
} from "./loan-form";

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
}) {
  const panelId = useId();
  const dateLabelId = useId();
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
  const canSave = ready && Object.keys(errors).length === 0;
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
    if (preview.status !== "ready" || Object.keys(errors).length > 0 || busy) return;
    onSave?.(preview.insert);
  }

  function onTerm(raw: string) {
    const negative = raw.trim().startsWith("-");
    const digits = raw.replace(/\D/g, "").slice(0, 4);
    setTerm(negative ? (digits === "" ? "-" : `-${digits}`) : digits);
  }

  return (
    <form className="ui-stack" onSubmit={submit}>
      <TextField
        label="מלווה"
        value={name}
        maxLength={80}
        disabled={busy}
        error={errors.name}
        onChange={(event) => { setName(event.target.value); }}
      />
      <MoneyField
        label="סכום מקורי"
        value={principal}
        prefix={mark}
        disabled={busy}
        keepMinus
        error={errors.principal}
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
        error={errors.rate}
        onValueChange={setRate}
      />
      <TextField
        label="תקופה בחודשים"
        value={term}
        dir="ltr"
        inputMode="numeric"
        numeric
        disabled={busy}
        error={errors.term}
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
        error={errors.escrow}
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
            error={errors.payment}
            onValueChange={(next) => { setPayment(next); }}
            onBlur={() => {
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
      {!advanced && errors.payment ? (
        <p className="ui-field-message" role="alert">{errors.payment}</p>
      ) : null}
      <Button type="submit" buttonRef={saveButtonRef} busy={busy} disabled={!canSave}>שמירה</Button>
    </form>
  );
}

export function LoanSettingsSection({
  companyId,
  companyCurrency,
  blocked,
}: {
  companyId: string | null;
  /** Preview passes this. Live omits it and reads the company's lines. */
  companyCurrency?: LoanCurrency;
  blocked?: () => boolean;
}) {
  const [open, setOpenState] = useState(false);
  const rowRef = useRef<HTMLButtonElement>(null);
  const saveButton = useRef<HTMLButtonElement>(null);
  const posted = useRef(false);
  const draftRef = useRef<LoanSetupInitial | null>(null);
  const keepDraft = useRef(false);
  const clearDraft = useCallback(() => {
    keepDraft.current = false;
    draftRef.current = null;
  }, []);
  const setOpen = useCallback((next: boolean) => {
    if (!next) clearDraft();
    setOpenState(next);
  }, [clearDraft]);
  const setSheet = useSheetHistory("loan-new", open, setOpen);
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
      if ((error as { code?: string }).code === "42501") return "אין הרשאה לשמור הלוואה.";
      return "לא הצלחנו לשמור את ההלוואה.";
    },
    success: "ההלוואה נשמרה",
    keys: [],
    onSuccess: () => {
      clearDraft();
      setSheet(false);
    },
    run: async (row) => {
      const supabase = getSupabase();
      if (!supabase || companyId == null) throw new Error("supabase");
      assertNoError(await supabase.from("loans").insert({ ...row, company_id: companyId }));
    },
  });

  function setLoanSheet(next: boolean) {
    if (next) keepDraft.current = true;
    else clearDraft();
    setSheet(next);
  }

  return (
    <>
      <SectionHead title="הלוואות" />
      <List>
        <ListRow
          variant="button"
          title="הלוואה חדשה"
          icon={<BankIcon />}
          chevron
          buttonRef={rowRef}
          onClick={() => { setLoanSheet(true); }}
        />
      </List>
      <Sheet open={open} onOpenChange={setLoanSheet} title="הלוואה" returnFocusRef={rowRef}>
        {currency == null ? (
          <p role="status">טוען…</p>
        ) : (
          <LoanSetupForm
            companyCurrency={currency}
            initial={draftRef.current ?? undefined}
            busy={save.isPending}
            saveButtonRef={saveButton}
            keepDraft={keepDraft}
            onDraft={(next) => { draftRef.current = next; }}
            onSave={(row) => {
              if (blocked?.()) return;
              if (posted.current || save.isPending) return;
              posted.current = true;
              save.mutate(row, {
                onError: () => { saveButton.current?.focus(); },
                onSettled: () => { posted.current = false; },
              });
            }}
          />
        )}
      </Sheet>
    </>
  );
}
