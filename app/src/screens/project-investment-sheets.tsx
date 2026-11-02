import { parseDecimalHalfEven } from "@flow/shared";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { DateSheet } from "../ui/date-sheet";
import { formatDisplay, israelToday } from "../ui/date-math";
import { HoldLine } from "../ui/hold-line";
import { CalendarIcon } from "../ui/icons";
import { INVESTMENT_LABELS, type InvestmentField } from "../ui/investment-card";
import { MoneyField } from "../ui/money-field";
import { Sheet } from "../ui/sheet";
import { TextField } from "../ui/text-field";

/* ------------------------------------------------------------------------------------------------
 * The edit sheet: one figure, saved on שמירה or when the sheet closes (0075). מחיקה clears it.
 * ---------------------------------------------------------------------------------------------- */

export type InvestmentPatch = Partial<{
  purchase_minor: number | null;
  arv_minor: number | null;
  value_minor: number | null;
  value_date: string | null;
  land_minor: number | null;
  units: number | null;
}>;

const PATCH_KEY: Record<InvestmentField, "purchase_minor" | "arv_minor" | "value_minor" | "land_minor" | "units"> = {
  purchase: "purchase_minor",
  arv: "arv_minor",
  value: "value_minor",
  land: "land_minor",
  units: "units",
};

/** What each figure is, in one line under its name (the board's edit sheet). */
const FIELD_HELP: Record<InvestmentField, string> = {
  purchase: "המחיר ששולם על הנכס. לא כולל עלויות סגירה שכבר נרשמו כהוצאה.",
  arv: "כמה הנכס יהיה שווה כשהשיפוץ יסתיים. משמש לחישוב ההשבחה הצפויה.",
  value: "הערכה של שווי הנכס היום, למשל משמאות או מעסקאות דומות.",
  land: "החלק של הקרקע במחיר. קרקע לא מתבלה, ולכן אין עליה פחת. לרוב מופיע בשומת הארנונה.",
  units: "כמה יחידות להשכרה יש בנכס. משמש לחישוב התזרים ליחידה.",
};

export const EMPTY_HOLD = "הסכום ריק. כדי למחוק אותו, הקישו מחיקה.";
export const UNITS_HOLD = "מספר היחידות הוא בין 1 ל־9999.";
const UNITS_EMPTY_HOLD = "המספר ריק. כדי למחוק אותו, הקישו מחיקה.";

/** 125000050n → "1250000.5" (the field's own digits). */
export function minorToRaw(value: bigint | null): string {
  if (value == null) return "";
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = (abs / 100n).toString();
  const cents = abs % 100n;
  const body = cents === 0n ? whole : `${whole}.${cents.toString().padStart(2, "0").replace(/0$/, "")}`;
  return negative ? `-${body}` : body;
}

/** The field's digits to minor units; null when there is no amount. */
export function rawToMinor(raw: string): bigint | null {
  const clean = raw.replace(/\.$/, "");
  if (clean === "" || clean === ".") return null;
  return parseDecimalHalfEven(clean.startsWith(".") ? `0${clean}` : clean, 2);
}

/** A figure in its field's own unit: minor units of money, or a count of units. */
function toRaw(field: InvestmentField, value: bigint | null): string {
  if (field === "units") return value == null ? "" : value.toString();
  return minorToRaw(value);
}

function fromRaw(field: InvestmentField, raw: string): bigint | null {
  if (field === "units") return /^\d+$/.test(raw) ? BigInt(raw) : null;
  return rawToMinor(raw);
}

type Verdict = { kind: "clean" } | { kind: "hold"; message: string } | { kind: "save"; patch: InvestmentPatch };

export function editVerdict(
  field: InvestmentField,
  base: { minor: bigint | null; date: string | null },
  draft: { raw: string; date: string; dateTouched: boolean },
): Verdict {
  const amount = fromRaw(field, draft.raw);
  const amountChanged = amount !== base.minor;
  if (amountChanged && amount == null) return { kind: "hold", message: field === "units" ? UNITS_EMPTY_HOLD : EMPTY_HOLD };
  if (field === "units" && amountChanged && amount != null && (amount < 1n || amount > 9999n)) return { kind: "hold", message: UNITS_HOLD };
  if (field !== "value") {
    return amountChanged && amount != null ? { kind: "save", patch: { [PATCH_KEY[field]]: Number(amount) } } : { kind: "clean" };
  }
  if (amountChanged && amount != null) return { kind: "save", patch: { value_minor: Number(amount), value_date: draft.date } };
  if (draft.dateTouched && draft.date !== base.date) return { kind: "save", patch: { value_date: draft.date } };
  return { kind: "clean" };
}

export function clearPatch(field: InvestmentField): InvestmentPatch {
  if (field === "value") return { value_minor: null, value_date: null };
  return { [PATCH_KEY[field]]: null };
}

export function InvestmentEditSheet({
  field,
  open,
  onOpenChange,
  minor: baseMinor,
  date: baseDate,
  onSave,
  returnFocusRef,
}: {
  field: InvestmentField;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The figure in its field's unit: minor units of money, or the count of units. */
  minor: bigint | null;
  date: string | null;
  /** Resolves true once saved. A failure toasts and keeps the sheet open. */
  onSave: (patch: InvestmentPatch, kind: "save" | "clear", field: InvestmentField) => Promise<boolean>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const label = INVESTMENT_LABELS[field];
  const today = israelToday();
  const [raw, setRaw] = useState(() => toRaw(field, baseMinor));
  const [date, setDate] = useState(today);
  const [dateTouched, setDateTouched] = useState(false);
  const [dateOpen, setDateOpen] = useState(false);
  const [hold, setHold] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = useRef({ minor: baseMinor, date: baseDate });
  const draft = useRef({ raw, date, dateTouched });
  draft.current = { raw, date, dateTouched };
  const holdShown = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const dateLabelId = useId();

  // Each open starts from the stored figure; שווי היום's date starts on today (FLOW-404).
  useEffect(() => {
    if (!open) return;
    base.current = { minor: baseMinor, date: baseDate };
    setRaw(toRaw(field, baseMinor));
    setDate(israelToday());
    setDateTouched(false);
    setHold(null);
    holdShown.current = false;
    // Only a new open resets the draft; a refetch while it is open must not.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = useCallback(async (patch: InvestmentPatch, kind: "save" | "clear"): Promise<boolean> => {
    setBusy(true);
    const pending = onSave(patch, kind, field);
    saving.current = pending;
    try {
      const ok = await pending;
      if (ok) {
        const nextMinor = kind === "clear" ? null : fromRaw(field, draft.current.raw);
        base.current = field === "value"
          ? { minor: kind === "clear" ? null : (nextMinor ?? base.current.minor), date: kind === "clear" ? null : (patch.value_date ?? base.current.date) }
          : { minor: nextMinor, date: null };
        setRaw(toRaw(field, base.current.minor));
        setDateTouched(false);
        setHold(null);
      }
      return ok;
    } finally {
      saving.current = null;
      setBusy(false);
    }
  }, [field, onSave]);

  /** ✕, scrim, swipe and back save a valid change first; an empty amount holds once (0075). */
  const guard = useCallback(async (): Promise<boolean> => {
    // A second close while a save runs waits for it, and stays open if it fails (0075).
    if (saving.current) return await saving.current;
    const verdict = editVerdict(field, base.current, draft.current);
    if (verdict.kind === "clean") return true;
    if (verdict.kind === "hold") {
      if (holdShown.current) {
        setRaw(toRaw(field, base.current.minor));
        return true;
      }
      holdShown.current = true;
      setHold(verdict.message);
      return false;
    }
    return run(verdict.patch, "save");
  }, [field, run]);

  const setSheet = useSheetHistory("investment-edit", open, onOpenChange, guard);

  function discard() {
    setRaw(toRaw(field, base.current.minor));
    setDate(israelToday());
    setDateTouched(false);
    setHold(null);
    holdShown.current = false;
  }

  async function submit() {
    if (busy) return;
    const verdict = editVerdict(field, base.current, draft.current);
    if (verdict.kind === "hold") {
      holdShown.current = true;
      setHold(verdict.message);
      return;
    }
    if (verdict.kind === "save" && !(await run(verdict.patch, "save"))) return;
    setSheet(false);
  }

  async function clear() {
    if (busy) return;
    if (await run(clearPatch(field), "clear")) setSheet(false);
  }

  function change(next: string) {
    setRaw(next);
    if (hold != null) {
      setHold(null);
      holdShown.current = false;
    }
  }

  function onEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      void submit();
    }
  }

  const canClear = base.current.minor != null || (field === "value" && base.current.date != null);
  return (
    <Sheet
      open={open}
      onOpenChange={setSheet}
      title={label}
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-wide ui-sheet-g14 ui-pinv-edit"
      onBeforeClose={guard}
      closeButton={false}
      action={(
        <div className="ui-pinv-actions">
          <Button full busy={busy} onClick={() => { void submit(); }}>
            שמירה
          </Button>
          {canClear ? (
            <Button variant="danger-link" disabled={busy} onClick={() => { void clear(); }}>
              מחיקה
            </Button>
          ) : null}
        </div>
      )}
    >
      <p className="ui-pinv-help">{FIELD_HELP[field]}</p>
      {field === "units" ? (
        <TextField
          label="מספר יחידות"
          value={raw}
          numeric
          inputMode="numeric"
          disabled={busy}
          enterKeyHint="done"
          onChange={(event) => { change(event.target.value.replace(/\D/g, "").slice(0, 4)); }}
          onKeyDown={onEnter}
        />
      ) : (
        <MoneyField
          label="סכום"
          value={raw}
          prefix=""
          disabled={busy}
          enterKeyHint="done"
          onValueChange={change}
          onKeyDown={onEnter}
        />
      )}
      {hold != null ? <HoldLine onDiscard={discard}>{hold}</HoldLine> : null}
      {field === "value" ? (
        <>
          <div className="ui-field">
            <span id={dateLabelId} className="ui-field-label">נכון לתאריך</span>
            <button
              type="button"
              className="ui-field-control ui-date-field"
              aria-labelledby={dateLabelId}
              aria-haspopup="dialog"
              disabled={busy}
              onClick={() => { setDateOpen(true); }}
            >
              <span>
                {date === today ? "היום · " : null}
                <bdi className="ui-num" dir="ltr">{formatDisplay(date)}</bdi>
              </span>
              <CalendarIcon size={20} />
            </button>
          </div>
          <DateSheet
            open={dateOpen}
            onOpenChange={setDateOpen}
            title="נכון לתאריך"
            value={date}
            disabled={busy}
            onApply={(iso) => {
              setDate(iso);
              setDateTouched(true);
            }}
          />
        </>
      ) : null}
    </Sheet>
  );
}

