import { useQuery } from "@tanstack/react-query";
import { useId, useMemo, useRef, useState, type SubmitEvent } from "react";
import { BankIcon, ChevronDownIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { SectionHead } from "../ui/layout";
import { MoneyField, PercentField } from "../ui/money-field";
import { SelectField } from "../ui/select-field";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";
import { TextLink } from "../ui/text-link";
import { Button } from "../ui/button";
import { useSheetHistory } from "../ui/back";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import {
  LOAN_CURRENCY_MARK,
  firstOfNextMonth,
  formatLoanMoney,
  loanErrorText,
  loanPreview,
  minorToInput,
  readCompanyLoanCurrency,
  type LoanCurrency,
  type LoanDraft,
  type LoanInsert,
} from "./loan-form";

export type { LoanCurrency } from "./loan-form";

const CURRENCIES: Array<{ value: LoanCurrency; label: string }> = [
  { value: "ILS", label: "שקל (₪)" },
  { value: "USD", label: "דולר ($)" },
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

export function LoanSetupForm({
  companyCurrency,
  initial,
  advancedOpen = false,
  busy = false,
  onSave,
}: {
  companyCurrency: LoanCurrency;
  initial?: LoanSetupInitial;
  advancedOpen?: boolean;
  busy?: boolean;
  onSave?: (row: Omit<LoanInsert, "company_id">) => void;
}) {
  const panelId = useId();
  const [name, setName] = useState(initial?.name ?? "");
  const [principal, setPrincipal] = useState(initial?.principal ?? "");
  const [rate, setRate] = useState(initial?.rate ?? "");
  const [term, setTerm] = useState(initial?.term ?? "360");
  const [startDate, setStartDate] = useState(initial?.startDate ?? firstOfNextMonth());
  const [escrow, setEscrow] = useState(initial?.escrow ?? "0");
  const [currency, setCurrency] = useState<LoanCurrency>(initial?.currency ?? companyCurrency);
  const [payment, setPayment] = useState<string | null>(initial?.payment ?? null);
  const [advanced, setAdvanced] = useState(advancedOpen || initial?.payment != null);
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
  const mark = LOAN_CURRENCY_MARK[currency];
  const ready = preview.status === "ready";
  const nameOk = name.trim().length >= 1 && name.trim().length <= 80;
  const canSave = ready && nameOk && !busy;
  const errorCode = preview.status === "error" ? preview.code : null;
  const paymentError = errorCode === "payment_below_interest" ? loanErrorText(errorCode) : undefined;
  const termError = errorCode === "term" ? loanErrorText(errorCode) : undefined;
  const rateError = errorCode === "rate" ? loanErrorText(errorCode) : undefined;
  const dateError = errorCode === "start_date" ? loanErrorText(errorCode) : undefined;
  const shownPayment = payment ?? (ready ? minorToInput(preview.paymentMinor) : "");

  function submit(event: SubmitEvent) {
    event.preventDefault();
    if (preview.status !== "ready" || !nameOk || busy) return;
    onSave?.(preview.insert);
  }

  return (
    <form className="ui-stack" onSubmit={submit}>
      <TextField
        label="מלווה"
        value={name}
        maxLength={80}
        onChange={(event) => { setName(event.target.value); }}
      />
      <MoneyField label="סכום מקורי" value={principal} prefix={mark} onValueChange={setPrincipal} />
      <PercentField
        label="ריבית שנתית"
        value={rate}
        decimals={3}
        error={rateError}
        onValueChange={setRate}
      />
      <TextField
        label="תקופה בחודשים"
        value={term}
        dir="ltr"
        inputMode="numeric"
        error={termError}
        onChange={(event) => {
          setTerm(event.target.value.replace(/\D/g, "").slice(0, 3));
        }}
      />
      <TextField
        label="תאריך תשלום ראשון"
        type="date"
        dir="ltr"
        value={startDate}
        error={dateError}
        onChange={(event) => { setStartDate(event.target.value); }}
      />
      <MoneyField
        label="מסים וביטוח לחודש"
        value={escrow}
        prefix={mark}
        onValueChange={setEscrow}
      />
      <SelectField
        label="מטבע"
        value={currency}
        options={CURRENCIES}
        onChange={(event) => { setCurrency(event.target.value as LoanCurrency); }}
      />
      <TextLink
        chevron={false}
        expanded={advanced}
        controls={panelId}
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
            error={paymentError}
            onValueChange={(next) => { setPayment(next === "" ? null : next); }}
          />
        </div>
      ) : null}
      {ready ? (
        <div aria-live="polite">
          <p>
            תשלום חודשי{" "}
            <bdi className="ui-num" dir="ltr">{formatLoanMoney(preview.paymentMinor, currency)}</bdi>
          </p>
          <p>
            ריבית כוללת{" "}
            <bdi className="ui-num" dir="ltr">{formatLoanMoney(preview.interestMinor, currency)}</bdi>
          </p>
          {preview.balloon ? (
            <p>
              התשלום האחרון גבוה יותר,{" "}
              <bdi className="ui-num" dir="ltr">{formatLoanMoney(preview.balloon.amountMinor, currency)}</bdi>
            </p>
          ) : preview.adjustedFinalMinor != null ? (
            <p>
              תשלום אחרון מותאם,{" "}
              <bdi className="ui-num" dir="ltr">{formatLoanMoney(preview.adjustedFinalMinor, currency)}</bdi>
            </p>
          ) : null}
        </div>
      ) : errorCode === "payment_below_interest" && !advanced ? (
        <p className="ui-field-message" role="alert">{loanErrorText(errorCode)}</p>
      ) : null}
      <Button type="submit" busy={busy} disabled={!canSave}>שמירה</Button>
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
  const [open, setOpen] = useState(false);
  const setSheet = useSheetHistory("loan-new", open, setOpen);
  const rowRef = useRef<HTMLButtonElement>(null);
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
    onSuccess: () => { setSheet(false); },
    run: async (row) => {
      const supabase = getSupabase();
      if (!supabase || companyId == null) throw new Error("supabase");
      assertNoError(await supabase.from("loans").insert({ ...row, company_id: companyId }));
    },
  });

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
          onClick={() => { setSheet(true); }}
        />
      </List>
      <Sheet open={open} onOpenChange={setSheet} title="הלוואה" returnFocusRef={rowRef}>
        {currency == null ? (
          <p role="status">טוען…</p>
        ) : (
          <LoanSetupForm
            key={currency}
            companyCurrency={currency}
            busy={save.isPending}
            onSave={(row) => {
              if (blocked?.()) return;
              save.mutate(row);
            }}
          />
        )}
      </Sheet>
    </>
  );
}
