import { parseDecimalHalfEven } from "@flow/shared";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { HoldLine } from "../ui/hold-line";
import { MoneyField } from "../ui/money-field";
import { Sheet } from "../ui/sheet";
import { FigureText, FormulaList, type Resolve } from "./project-returns-parts";
import {
  BEFORE_FIRST_RENT,
  FEW_DAYS,
  INFINITY,
  beforeFirstRent,
  fewDays,
  firstMissing,
  forcedFormula,
  infiniteTotal,
  infoFigure,
  returnInfo,
  type FigureValue,
  type Formula,
  type InfoKey,
} from "./project-returns-info";
import { percentText, type PropertyReturns } from "./project-returns-data";
import { sourceValue, type InvestmentKind } from "./project-returns-cards";
import { INFO_LEARN, englishName } from "./project-returns-learn";
import { LearnSections } from "./project-returns-learn-sheet";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451 (board ConceptATaxInfo): the ⓘ sheet. One sheet for every figure: its title and amount,
 * one or two lines on what it is, its parts with their operators (each opening where it comes
 * from), the result, a caption, and סגירה.
 * ---------------------------------------------------------------------------------------------- */

export function ReturnInfoSheet({
  infoKey,
  open,
  onOpenChange,
  returns,
  resolve,
  readOnly,
  returnFocusRef,
}: {
  infoKey: InfoKey;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returns: PropertyReturns;
  resolve: Resolve;
  readOnly: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const info = returnInfo(infoKey, returns);
  const figure = infoFigure(info);
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={info.title}
      subtitle={englishName(INFO_LEARN[infoKey])}
      aside={figure == null ? undefined : <span className="ui-pinv-sheet-total"><FigureText value={figure} currency={returns.currency} /></span>}
      closeButton={false}
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-wide ui-sheet-g10 ui-ret-info"
      action={<Button variant="secondary" full onClick={() => { onOpenChange(false); }}>סגירה</Button>}
    >
      <p className="ui-pinv-help">{info.body}</p>
      <FormulaList formula={info.formula} currency={returns.currency} resolve={resolve} readOnly={readOnly} label={info.title} />
      {info.caption == null ? null : <p className="ui-ret-caption">{info.caption}</p>}
      {/* FLOW-462: after how it is made, how an investor reads it. FLOW-471: the body says what it is. */}
      <LearnSections learnKey={INFO_LEARN[infoKey]} defined />
    </Sheet>
  );
}

/* ------------------------------------------------------------------------------------------------
 * FLOW-1047 (board V3-Investment, "איך מחושב" in the band): the band's figure in numbers. A rental adds
 * its four sources up to the year's total and divides it by the money in the deal; a renovation takes
 * the purchase and the renovation so far from the ARV. Each row opens where it comes from.
 * ---------------------------------------------------------------------------------------------- */

/** The year's total: the four sources added up. */
export function totalSumFormula(r: PropertyReturns): Formula {
  return {
    rows: [
      { key: "cash", op: "", label: "תזרים", value: { kind: "money", minor: r.sources.cashFlowMinor }, target: { kind: "statement" } },
      { key: "principal", op: "+", label: "החזר קרן", value: { kind: "money", minor: r.sources.principalMinor }, target: { kind: "line", line: "principal" } },
      { key: "appreciation", op: "+", label: "עליית ערך", value: sourceValue(r.sources.appreciationMinor, r, ["value"]), target: { kind: "edit", field: "value" } },
      { key: "tax", op: "+", label: "חיסכון מס", value: sourceValue(r.sources.taxSavingsMinor, r, ["purchase", "land", "tax_bracket"]), target: { kind: "edit", field: "tax_bracket" } },
    ],
    result: { key: "total", op: "=", label: "תשואה כוללת בשנה", value: { kind: "money", minor: r.sources.totalMinor } },
  };
}

/** The year's total on the money in the deal; no per-cent before the first rent, with all the cash out, or on too few days. */
export function totalRateFormula(r: PropertyReturns): Formula {
  const moneyIn = r.equity.moneyInMinor;
  const bp = r.sources.totalBp;
  const result: FigureValue = infiniteTotal(r) ? { kind: "text", text: INFINITY }
    : beforeFirstRent(r) ? { kind: "note", text: BEFORE_FIRST_RENT }
    : bp != null && fewDays(r) ? { kind: "note", text: FEW_DAYS }
    : bp != null ? { kind: "text", text: percentText(bp) }
    : { kind: "text", text: "לא מחושב" };
  return {
    rows: [
      { key: "total", op: "", label: "תשואה כוללת בשנה", value: { kind: "money", minor: r.sources.totalMinor } },
      { key: "money-in", op: "÷", label: "כסף בעסקה", value: moneyIn == null ? { kind: "missing", add: firstMissing(r, ["purchase"]) } : { kind: "money", minor: moneyIn }, target: { kind: "part", part: "money-in" } },
    ],
    result: { key: "rate", op: "=", label: "תשואה כוללת", value: result },
  };
}

const HOW = {
  rent: { learn: "total", title: "איך מחושבת התשואה הכוללת", body: "תזרים, החזר קרן, עליית ערך וחיסכון מס ב־12 החודשים האחרונים, חלקי הכסף שעדיין בעסקה." },
  flip: { learn: "forced", title: "איך מחושב הרווח הצפוי", body: "השווי אחרי השיפוץ, פחות מחיר הקנייה והשיפוץ עד היום. עלויות ההחזקה כבר ברווח השוטף." },
} as const;

/** "איך מחושב" from the band: the figure's calculation, each row opening its source, and הבנתי. */
export function HowSheet({ kind, open, onOpenChange, returns, resolve, readOnly, returnFocusRef }: {
  kind: InvestmentKind;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returns: PropertyReturns;
  resolve: Resolve;
  readOnly: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const how = HOW[kind];
  const formulas = kind === "rent" ? [totalSumFormula(returns), totalRateFormula(returns)] : [forcedFormula(returns)];
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={how.title}
      subtitle={englishName(how.learn)}
      closeButton={false}
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-wide ui-sheet-g10 ui-ret-info"
      action={<Button full onClick={() => { onOpenChange(false); }}>הבנתי</Button>}
    >
      <p className="ui-pinv-help">{how.body}</p>
      {formulas.map((formula) => (
        <FormulaList key={formula.result?.key ?? "formula"} formula={formula} currency={returns.currency} resolve={resolve} readOnly={readOnly} label={formula.result?.label ?? how.title} />
      ))}
      {/* FLOW-462: after how it is made, how an investor reads it. */}
      <LearnSections learnKey={how.learn} defined />
    </Sheet>
  );
}

/* ------------------------------------------------------------------------------------------------
 * The tax bracket: the owner's marginal income tax, a percent from 0 to 100 with up to two decimals,
 * one for the company (set_tax_bracket, in basis points). Saved on שמירה or when the sheet closes.
 * ---------------------------------------------------------------------------------------------- */

export const BRACKET_RANGE = "המדרגה היא בין 0 ל־100.";
export const BRACKET_EMPTY = "האחוז ריק. כדי למחוק אותו, הקישו מחיקה.";

/** 2450 → "24.5". */
export function bpToRaw(bp: number | null): string {
  if (bp == null) return "";
  return String(Number((bp / 100).toFixed(2)));
}

/** "24.5" → 2450; null when empty. */
export function rawToBp(raw: string): number | null {
  const clean = raw.replace(/\.$/, "");
  if (clean === "" || clean === ".") return null;
  return Number(parseDecimalHalfEven(clean.startsWith(".") ? `0${clean}` : clean, 2));
}

type BracketVerdict = { kind: "clean" } | { kind: "hold"; message: string } | { kind: "save"; bp: number };

export function bracketVerdict(base: number | null, raw: string): BracketVerdict {
  const bp = rawToBp(raw);
  if (bp === base) return { kind: "clean" };
  if (bp == null) return { kind: "hold", message: BRACKET_EMPTY };
  if (bp > 10_000) return { kind: "hold", message: BRACKET_RANGE };
  return { kind: "save", bp };
}

export function TaxBracketSheet({
  open,
  onOpenChange,
  bp: baseBp,
  onSave,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  bp: number | null;
  /** Resolves true once saved; null clears the bracket. */
  onSave: (bp: number | null) => Promise<boolean>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const [raw, setRaw] = useState(() => bpToRaw(baseBp));
  const [hold, setHold] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const base = useRef(baseBp);
  const draft = useRef(raw);
  draft.current = raw;
  const holdShown = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    if (!open) return;
    base.current = baseBp;
    setRaw(bpToRaw(baseBp));
    setHold(null);
    holdShown.current = false;
    // Only a new open resets the draft.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const run = useCallback(async (bp: number | null): Promise<boolean> => {
    setBusy(true);
    const pending = onSave(bp);
    saving.current = pending;
    try {
      const ok = await pending;
      if (ok) {
        base.current = bp;
        setRaw(bpToRaw(bp));
        setHold(null);
      }
      return ok;
    } finally {
      saving.current = null;
      setBusy(false);
    }
  }, [onSave]);

  const guard = useCallback(async (): Promise<boolean> => {
    if (saving.current) return await saving.current;
    const verdict = bracketVerdict(base.current, draft.current);
    if (verdict.kind === "clean") return true;
    if (verdict.kind === "hold") {
      if (holdShown.current) {
        setRaw(bpToRaw(base.current));
        return true;
      }
      holdShown.current = true;
      setHold(verdict.message);
      return false;
    }
    return run(verdict.bp);
  }, [run]);

  const setSheet = useSheetHistory("investment-tax", open, onOpenChange, guard);

  async function submit() {
    if (busy) return;
    const verdict = bracketVerdict(base.current, draft.current);
    if (verdict.kind === "hold") {
      holdShown.current = true;
      setHold(verdict.message);
      return;
    }
    if (verdict.kind === "save" && !(await run(verdict.bp))) return;
    setSheet(false);
  }

  return (
    <Sheet
      open={open}
      onOpenChange={setSheet}
      title="מדרגת המס"
      returnFocusRef={returnFocusRef}
      panelClassName="ui-sheet-wide ui-sheet-g14 ui-pinv-edit"
      onBeforeClose={guard}
      closeButton={false}
      action={(
        <div className="ui-pinv-actions">
          <Button full busy={busy} onClick={() => { void submit(); }}>שמירה</Button>
          {base.current != null ? (
            <Button variant="danger-link" disabled={busy} onClick={() => { void (async () => { if (!busy && (await run(null))) setSheet(false); })(); }}>
              מחיקה
            </Button>
          ) : null}
        </div>
      )}
    >
      <p className="ui-pinv-help">מדרגת מס ההכנסה השולית שלך. משמשת להערכת החיסכון מהפחת, בכל הנכסים.</p>
      <MoneyField
        label="אחוז"
        value={raw}
        prefix=""
        trailing={<span className="ui-ret-percent" aria-hidden="true">%</span>}
        disabled={busy}
        enterKeyHint="done"
        onValueChange={(next) => {
          setRaw(next);
          if (hold != null) {
            setHold(null);
            holdShown.current = false;
          }
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          }
        }}
      />
      {hold != null ? (
        <HoldLine onDiscard={() => { setRaw(bpToRaw(base.current)); setHold(null); holdShown.current = false; }}>{hold}</HoldLine>
      ) : null}
    </Sheet>
  );
}
