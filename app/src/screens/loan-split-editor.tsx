import { useEffect, useId, useState, type RefObject } from "react";
import type { LoanSplitPart } from "@flow/shared";
import { Button } from "../ui/button";
import { formatDisplay } from "../ui/date-math";
import { LOAN_PART_LABEL, LOAN_PART_ORDER } from "../ui/loan-parts-sheet";
import { MoneyField } from "../ui/money-field";
import { SegmentedControl } from "../ui/segmented-control";
import { SelectField } from "../ui/select-field";
import { Sheet } from "../ui/sheet";
import { Stepper } from "../ui/stepper";
import { Toggle } from "../ui/toggle";
import { partCategoryOptions, type LoanCategory, type LoanPayment } from "./loan-detail-data";
import { minorToInput } from "./loan-form";
import { showMoney } from "./loan-match";
import type { LoanChoice, SavePart } from "./loan-match-api";
import { LOAN_INSTALLMENTS_MAX, type OfferLine } from "./loan-match-offer";
import {
  checkExact,
  exactParts,
  minorOfInput,
  scheduleParts,
  schedulePlan,
  toSaveParts,
  type ExactDraft,
} from "./loan-split-draft";

type Mode = "schedule" | "exact";

export type LoanSplitSave = {
  loanId: string;
  parts: SavePart[];
  /** "לשמור להלוואה הזו": the fees category to keep on the loan, else null. */
  keepFeesCategoryId: string | null;
};

function draftFrom(parts: ReadonlyArray<{ part: LoanSplitPart; amountMinor: bigint }>): ExactDraft {
  const draft: ExactDraft = {};
  for (const part of parts) draft[part.part] = minorToInput(part.amountMinor);
  return draft;
}

/**
 * FLOW-106 §3.4, "חלוקת התשלום": a loan payment split other than the one tap. לפי הלוח covers
 * 1 to 12 installments with optional fees off the top (a demand loan: its accrued interest, and no
 * installments); סכומים מדויקים takes the lender's own parts. Fees name their category, and
 * "לשמור להלוואה הזו" keeps it on the loan. One שמירה, as the matched split's sheet has.
 */
export function LoanSplitEditor({
  open,
  onOpenChange,
  loans,
  payments,
  line,
  categories,
  saving = false,
  onSave,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The loans that can take the line, in the match sheet's order. */
  loans: readonly LoanChoice[];
  payments: Readonly<Record<string, readonly LoanPayment[]>>;
  line: OfferLine;
  /** Undefined while the categories load. */
  categories: readonly LoanCategory[] | undefined;
  saving?: boolean;
  onSave: (save: LoanSplitSave) => void;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const problemId = useId();
  const [loanId, setLoanId] = useState(loans[0]?.id ?? "");
  const [mode, setMode] = useState<Mode>("schedule");
  const [count, setCount] = useState(1);
  const [feesRaw, setFeesRaw] = useState("");
  const [exact, setExact] = useState<ExactDraft>({});
  const [feesCategoryId, setFeesCategoryId] = useState<string | null>(null);
  const [keep, setKeep] = useState(true);
  // Each open starts on the first loan, by the schedule, with no fees.
  useEffect(() => {
    if (!open) return;
    const first = loans[0];
    setLoanId(first?.id ?? "");
    setMode("schedule");
    setCount(1);
    setFeesRaw("");
    setExact({});
    setFeesCategoryId(first?.categoryIds?.fees ?? null);
    setKeep(first?.categoryIds?.fees == null);
    // The loans list is new on each render; the open is what resets the editor.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const loan = loans.find((item) => item.id === loanId) ?? loans[0];
  const loanPayments = loan == null ? [] : (payments[loan.id] ?? []);
  const demand = loan?.kind === "demand";
  const plan = loan == null ? null : schedulePlan(loan, loanPayments, line, count);
  const feesMinor = minorOfInput(feesRaw) ?? 0n;
  const scheduled = plan == null ? null : scheduleParts(plan, line.lineMinor, feesMinor);
  const exactCheck = checkExact(exact, line.lineMinor);
  const parts = mode === "schedule"
    ? (scheduled ?? []).map((part) => ({ part: part.part, amountMinor: part.amountMinor, scheduledMinor: part.scheduledMinor }))
    : exactParts(exact, plan);
  const fees = parts.find((part) => part.part === "fees")?.amountMinor ?? 0n;
  const principal = parts.find((part) => part.part === "principal")?.amountMinor ?? 0n;
  const loanFeesCategory = loan?.categoryIds?.fees ?? null;
  const feeOptions = categories == null ? [] : partCategoryOptions(categories, "fees", feesCategoryId);
  const currency = loan?.currency ?? line.currency;
  const money = (minor: bigint) => showMoney(minor, currency);
  const prefix = currency === "USD" ? "$" : "₪";
  const problem = loan == null
    ? "אין הלוואה שאפשר לשייך אליה."
    : mode === "schedule" && plan == null
      ? "אין תשלום בלוח לתאריך הזה."
      : mode === "schedule" && feesRaw.trim() !== "" && minorOfInput(feesRaw) == null
        ? "חסר סכום עמלות."
        : mode === "schedule" && scheduled == null
          ? "העמלות גבוהות מסכום השורה."
          : mode === "exact" && exactCheck.invalid
            ? "חסר סכום."
            : mode === "exact" && exactCheck.leftMinor !== 0n
              ? (exactCheck.leftMinor > 0n
                ? `החלקים צריכים להסתכם ב־${money(line.lineMinor)}. חסרים ${money(exactCheck.leftMinor)}.`
                : `עוברים את השורה ב־${money(-exactCheck.leftMinor)}.`)
              : fees > 0n && feesCategoryId == null
                ? "בחרו לאן נרשמות העמלות."
                : principal > loan.balanceMinor
                  ? "התשלום גבוה מיתרת ההלוואה."
                  : undefined;
  const canSave = problem == null && !saving;
  const save = () => {
    if (!canSave || loan == null) return;
    const feesCategory = fees > 0n ? feesCategoryId : null;
    onSave({
      loanId: loan.id,
      parts: toSaveParts(parts, feesCategory),
      keepFeesCategoryId: feesCategory != null && keep && feesCategory !== loanFeesCategory ? feesCategory : null,
    });
  };
  const switchMode = (next: Mode) => {
    // סכומים מדויקים starts from the schedule's parts, so the owner edits the lender's figures in.
    if (next === "exact" && mode === "schedule" && scheduled != null) setExact(draftFrom(scheduled));
    setMode(next);
  };
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // A dismiss during a save waits for it (0075).
        if (!next && saving) return;
        onOpenChange(next);
      }}
      title="חלוקת התשלום"
      returnFocusRef={returnFocusRef}
      action={(
        <Button
          type="button"
          full
          busy={saving}
          disabled={!canSave}
          aria-describedby={problem ? problemId : undefined}
          onClick={save}
        >
          {saving ? "שומר…" : "שמירה"}
        </Button>
      )}
    >
      <div className="ui-lsedit">
        <div className="ui-lsedit-head">
          <bdi className="ui-num t-title-2" dir="ltr">{money(line.lineMinor)}</bdi>
          <span className="t-hint ui-lsedit-meta">{formatDisplay(line.docDate)}</span>
        </div>
        {loans.length > 1 ? (
          <SelectField
            label="הלוואה"
            value={loanId}
            disabled={saving}
            options={loans.map((item) => ({ value: item.id, label: item.name }))}
            onChange={(event) => {
              const next = loans.find((item) => item.id === event.target.value);
              setLoanId(event.target.value);
              setCount(1);
              setFeesCategoryId(next?.categoryIds?.fees ?? null);
              setKeep(next?.categoryIds?.fees == null);
            }}
          />
        ) : null}
        <SegmentedControl<Mode>
          label="אופן החלוקה"
          showLabel={false}
          value={mode}
          busy={saving}
          options={[
            { value: "schedule", label: demand ? "לפי ריבית צבורה" : "לפי הלוח" },
            { value: "exact", label: "סכומים מדויקים" },
          ]}
          onChange={switchMode}
        />
        {mode === "schedule" ? (
          <>
            {demand ? null : (
              // A demand loan has no installments: one payment takes the interest accrued to its date.
              <Stepper
                label="מספר תשלומים"
                value={count}
                min={1}
                max={Math.min(plan?.maxCount ?? 1, LOAN_INSTALLMENTS_MAX)}
                hint={plan?.dates ?? undefined}
                disabled={saving}
                onChange={setCount}
              />
            )}
            <MoneyField
              id="loan-split-fees"
              label="עמלות"
              prefix={prefix}
              value={feesRaw}
              disabled={saving}
              enterKeyHint="done"
              onValueChange={setFeesRaw}
            />
            <div className="ui-loan-parts" aria-label="החלוקה">
              {LOAN_PART_ORDER.map((part) => {
                const amount = parts.find((item) => item.part === part)?.amountMinor;
                if (part === "fees" && (amount ?? 0n) === 0n) return null;
                return (
                  <div key={part} className="ui-loan-parts-row">
                    <span className="t-label ui-loan-parts-label">{LOAN_PART_LABEL[part]}</span>
                    <bdi className="ui-num" dir="ltr">{money(amount ?? 0n)}</bdi>
                  </div>
                );
              })}
              <div className="ui-loan-parts-total">
                <span>סה״כ</span>
                <bdi className="ui-num" dir="ltr">{money(parts.reduce((sum, part) => sum + part.amountMinor, 0n))}</bdi>
              </div>
            </div>
          </>
        ) : (
          <div className="ui-loan-parts">
            {LOAN_PART_ORDER.map((part, index) => (
              <div key={part} className="ui-loan-parts-row">
                <span className="t-label ui-loan-parts-label">{LOAN_PART_LABEL[part]}</span>
                <div className="ui-loan-parts-field">
                  <MoneyField
                    hideLabel
                    id={`loan-split-exact-${part}`}
                    label={`סכום, ${LOAN_PART_LABEL[part]}`}
                    prefix={prefix}
                    value={exact[part] ?? ""}
                    disabled={saving}
                    describedBy={problem ? problemId : undefined}
                    enterKeyHint={index === LOAN_PART_ORDER.length - 1 ? "done" : "next"}
                    onValueChange={(raw) => { setExact((current) => ({ ...current, [part]: raw })); }}
                  />
                </div>
              </div>
            ))}
            <div className="ui-loan-parts-total">
              <span>{`חולקו ${money(exactCheck.totalMinor)}`}</span>
              <bdi className="ui-num" dir="ltr">{`נשאר ${money(exactCheck.leftMinor > 0n ? exactCheck.leftMinor : 0n)}`}</bdi>
            </div>
          </div>
        )}
        {fees > 0n ? (
          <>
            <SelectField
              label="עמלות נרשמות ב"
              value={feesCategoryId ?? ""}
              disabled={saving || categories == null}
              options={[
                { value: "", label: categories == null ? "טוען…" : "בחרו קטגוריה" },
                ...feeOptions.map((category) => ({ value: category.id, label: category.name })),
              ]}
              onChange={(event) => { setFeesCategoryId(event.target.value === "" ? null : event.target.value); }}
            />
            {feesCategoryId != null && feesCategoryId !== loanFeesCategory ? (
              <Toggle label="לשמור להלוואה הזו" checked={keep} disabled={saving} onChange={setKeep} />
            ) : null}
          </>
        ) : null}
        {problem ? <p id={problemId} className="t-hint ui-loan-parts-problem" role="status">{problem}</p> : null}
      </div>
    </Sheet>
  );
}
