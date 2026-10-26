import { useEffect, useState } from "react";
import { Button } from "../ui/button";
import { formatDisplay } from "../ui/date-math";
import { PercentField } from "../ui/money-field";
import { ListRow } from "../ui/list-row";
import { Sheet } from "../ui/sheet";
import { LoanDateField } from "./loan-close-sheet";
import { rateChangeLine } from "./loan-copy";
import { rateInput, ratePpmOfInput, type LoanDetail, type LoanRateRow } from "./loan-detail-data";
import type { SheetSave } from "./loan-detail-sheets";
import type { LoanRateWrite } from "./loan-detail-store";

type From = "today" | "date";

/**
 * קביעת ריבית / שינוי ריבית (plan §3.2, FLOW-962 board Loan edit): "מתי השינוי חל?" first, today or
 * a day (from the loan's start, past or future), with one line on what that changes, then a percent
 * with up to 4 decimals (0 allowed). An existing row opens on its own day and adds "הסרת השינוי".
 */
export function LoanRateSheet({
  loan,
  rate,
  open,
  today,
  paymentDates,
  nextDue,
  onOpenChange,
  onSave,
  onRemove,
  returnFocusRef,
}: {
  loan: Pick<LoanDetail, "name" | "startDate" | "annualRatePpm" | "currency">;
  /** The row being changed; null adds one. */
  rate: LoanRateRow | null;
  open: boolean;
  today: string;
  /** The attached payments' dates: the line counts those on or after the day. */
  paymentDates: readonly string[];
  /** The next scheduled payment, which the new rate prices. */
  nextDue: string | null;
  onOpenChange: (open: boolean) => void;
  onSave: SheetSave<LoanRateWrite>;
  onRemove: SheetSave<LoanRateRow>;
  returnFocusRef?: { current: HTMLElement | null };
}) {
  const start = loan.startDate;
  const firstDay = today < start ? start : today;
  const [from, setFrom] = useState<From>(rate == null ? "today" : "date");
  const [date, setDate] = useState(rate?.effectiveDate ?? firstDay);
  const [percent, setPercent] = useState(rate ? rateInput(rate.annualRatePpm) : "");
  const [busy, setBusy] = useState<"save" | "remove" | null>(null);
  const [error, setError] = useState<{ field: "date" | "rate" | "form"; text: string } | null>(null);
  const [checked, setChecked] = useState(false);
  useEffect(() => {
    if (!open) return;
    setFrom(rate == null ? "today" : "date");
    setDate(rate?.effectiveDate ?? firstDay);
    setPercent(rate ? rateInput(rate.annualRatePpm) : "");
    setError(null);
    setChecked(false);
  }, [open, rate, firstDay]);
  const day = from === "today" ? firstDay : date;
  const ppm = ratePpmOfInput(percent);
  const dateBefore = day < start;
  const rateError = checked && ppm == null ? (percent.trim().startsWith("-") ? "הריבית שלילית." : percent.trim() === "" ? "חסרה ריבית." : "הריבית היא עד 100%.") : undefined;
  const dateError = dateBefore ? `התאריך לפני תחילת ההלוואה (${formatDisplay(start)}).` : error?.field === "date" ? error.text : undefined;
  const since = paymentDates.filter((paid) => paid >= day).length;
  async function save() {
    setChecked(true);
    if (busy != null || ppm == null || dateBefore) return;
    setBusy("save");
    setError(null);
    const failed = await onSave({ ...(rate ? { id: rate.id } : {}), effectiveDate: day, annualRatePpm: ppm });
    setBusy(null);
    if (failed == null) onOpenChange(false);
    else if (failed !== "") setError({ field: failed.includes("תחילת ההלוואה") ? "date" : "form", text: failed });
  }
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (!next && busy != null) return;
        onOpenChange(next);
      }}
      title={rate ? "שינוי ריבית" : "קביעת ריבית"}
      hint={loan.name}
      returnFocusRef={returnFocusRef}
    >
      <form
        className="ui-stack"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <p className="ui-loan-sheet-head" id="loan-rate-from">מתי השינוי חל?</p>
        <div role="radiogroup" aria-labelledby="loan-rate-from">
          <ListRow control="radio"
            layout="picker"
            title="מהיום"
            description={<><bdi className="ui-num" dir="ltr">{formatDisplay(firstDay)}</bdi> והלאה</>}
            selected={from === "today"}
            disabled={busy != null}
            onSelect={() => { setFrom("today"); setError(null); }}
          />
          <ListRow control="radio"
            layout="picker"
            title="מתאריך…"
            description="גם תאריך שעבר"
            selected={from === "date"}
            disabled={busy != null}
            onSelect={() => { setFrom("date"); setError(null); }}
          />
        </div>
        {from === "date" ? (
          <LoanDateField
            label="מתאריך"
            value={date}
            min={start}
            allowFuture
            disabled={busy != null}
            error={dateError}
            onChange={(iso) => {
              setDate(iso);
              setError(null);
            }}
          />
        ) : null}
        <p className="ui-loan-sheet-line">{rateChangeLine(day, today, since, nextDue)}</p>
        <PercentField
          label="ריבית שנתית"
          value={percent}
          decimals={4}
          keepMinus
          reserveMessage
          enterKeyHint="done"
          disabled={busy != null}
          error={rateError}
          onValueChange={setPercent}
        />
        {error?.field === "form" ? <p className="ui-field-message ui-loan-sheet-error" role="alert">{error.text}</p> : null}
        <Button type="submit" full busy={busy === "save"} disabled={busy === "remove"}>שמירת הריבית</Button>
        {rate ? (
          <div className="ui-loan-sheet-quiet">
            <Button
              variant="link"
              quiet
              busy={busy === "remove"}
              disabled={busy === "save"}
              onClick={() => {
                if (busy != null) return;
                setBusy("remove");
                setError(null);
                void onRemove(rate).then((failed) => {
                  setBusy(null);
                  if (failed == null) onOpenChange(false);
                  else if (failed !== "") setError({ field: "form", text: failed });
                });
              }}
              className="ui-btn-link-bad"
            >
              הסרת השינוי
            </Button>
          </div>
        ) : null}
      </form>
    </Sheet>
  );
}
