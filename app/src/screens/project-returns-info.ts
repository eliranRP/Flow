import { formatAmount } from "../ui/amount";
import { formatDisplay } from "../ui/date-math";
import type { InvestmentField } from "../ui/investment-card";
import { bracketText, dscrText, percentText, type PropertyReturns, type ReturnLine } from "./project-returns-data";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451: what every ⓘ, part and metric shows, as data. A row is an operator, a name, a figure and
 * where it comes from; the "=" row is the result. Figures are signed as they count: a cost or a
 * figure taken away is negative, so the rows before "=" add up to it (except the tax rows' ÷ and ×).
 * ---------------------------------------------------------------------------------------------- */

/** The figures the owner types: the project's own, and the company's tax bracket. */
export type EditField = InvestmentField | "tax_bracket";
export type PartKey = "building" | "money-in" | "forced";
export const PART_KEYS: readonly PartKey[] = ["building", "money-in", "forced"];
export type MetricKey = "coc" | "cap-rate" | "dscr" | "per-unit";
export const METRIC_KEYS: readonly MetricKey[] = ["coc", "cap-rate", "dscr", "per-unit"];

export type Target =
  | { kind: "line"; line: ReturnLine }
  | { kind: "statement" }
  | { kind: "part"; part: PartKey }
  | { kind: "edit"; field: EditField }
  | { kind: "loans" };

export type FigureValue =
  | { kind: "money"; minor: bigint; income?: boolean }
  | { kind: "text"; text: string }
  /** "חסר" and, when `add` names one, an accent הוספה that opens that figure's sheet. */
  | { kind: "missing"; add: EditField | null; note?: string };

export type Op = "" | "+" | "−" | "÷" | "×" | "=";

export type FormulaRow = { key: string; op: Op; label: string; hint?: string; value: FigureValue; target?: Target };
export type Formula = { rows: FormulaRow[]; result: FormulaRow | null };

export const MISSING_HISTORY = "חסר · שווי לפני שנה";
export const HISTORY_HINT = "השווי נשמר בכל פעם שמעדכנים אותו, ומכאן עליית הערך.";
export const TAX_CAPTION = "הערכה. במכירה הפחת חוזר כמס. החישוב המדויק אצל רואה החשבון.";

const money = (minor: bigint, income = false): FigureValue => ({ kind: "money", minor, income });
const missing = (add: EditField | null, note?: string): FigureValue => ({ kind: "missing", add, note });

/** A typed figure, or "חסר · הוספה" for it. */
function typed(minor: bigint | null, field: EditField, negate = false): FigureValue {
  if (minor == null) return missing(field);
  return money(negate ? -minor : minor);
}

/** The first input a figure needs that is missing, in the order the owner would add them. */
export function firstMissing(r: PropertyReturns, needs: readonly EditField[]): EditField | null {
  for (const field of needs) {
    if (field === "purchase" && r.inputs.purchaseMinor == null) return field;
    if (field === "arv" && r.inputs.arvMinor == null) return field;
    if (field === "value" && r.inputs.valueMinor == null) return field;
    if (field === "land" && r.inputs.landMinor == null) return field;
    if (field === "units" && r.inputs.units == null) return field;
    if (field === "tax_bracket" && r.inputs.taxBracketBp == null) return field;
  }
  return null;
}

/** A computed figure; when it is null, "חסר · הוספה" for the first input it needs, else "לא מחושב". */
function computed(minor: bigint | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (minor != null) return money(minor);
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : missing(add);
}

export function countHint(count: number): string {
  return count === 1 ? "תנועה אחת" : `${String(count)} תנועות`;
}

/* -- the four sources ---------------------------------------------------------------------------- */

export function cashFlowFormula(r: PropertyReturns): Formula {
  const st = r.statement;
  return {
    rows: [
      { key: "income", op: "", label: "הכנסות", hint: countHint(st.counts.income), value: money(st.incomeMinor, true), target: { kind: "line", line: "income" } },
      { key: "opex", op: "−", label: "הוצאות תפעול", hint: countHint(st.counts.opex), value: money(st.opexMinor), target: { kind: "line", line: "opex" } },
      { key: "debt", op: "−", label: "תשלומי הלוואה", hint: countHint(st.counts.debt_service), value: money(st.debtServiceMinor), target: { kind: "line", line: "debt_service" } },
      { key: "capex", op: "−", label: "שיפוץ", hint: countHint(st.counts.capex), value: money(st.capexMinor), target: { kind: "line", line: "capex" } },
    ],
    result: { key: "cash", op: "=", label: "תזרים", value: money(st.cashFlowMinor) },
  };
}

export function principalFormula(r: PropertyReturns): Formula {
  return {
    rows: [{ key: "principal", op: "", label: "קרן שנפרעה", hint: "מתשלומי ההלוואה בתקופה", value: money(r.sources.principalMinor), target: { kind: "line", line: "principal" } }],
    result: null,
  };
}

export function appreciationFormula(r: PropertyReturns): Formula {
  const { valueEnd, valueStart } = r.inputs;
  const edit: Target = { kind: "edit", field: "value" };
  if (valueEnd == null) {
    return { rows: [{ key: "end", op: "", label: "שווי היום", value: missing("value"), target: edit }], result: { key: "diff", op: "=", label: "עליית ערך", value: missing(null) } };
  }
  const end: FormulaRow = { key: "end", op: "", label: `שווי ב־${formatDisplay(valueEnd.date)}`, hint: "בסוף התקופה", value: money(valueEnd.minor), target: edit };
  if (valueStart == null) {
    return {
      rows: [end, { key: "start", op: "−", label: "שווי לפני שנה", hint: HISTORY_HINT, value: missing(null, MISSING_HISTORY) }],
      result: { key: "diff", op: "=", label: "עליית ערך", value: missing(null) },
    };
  }
  return {
    rows: [end, { key: "start", op: "−", label: `שווי ב־${formatDisplay(valueStart.date)}`, hint: "בתחילת התקופה", value: money(-valueStart.minor), target: edit }],
    result: { key: "diff", op: "=", label: "עליית ערך", value: computed(r.sources.appreciationMinor, r, ["value"]) },
  };
}

export function taxFormula(r: PropertyReturns): Formula {
  const bracket = r.inputs.taxBracketBp;
  return {
    rows: [
      { key: "building", op: "", label: "עלות הבניין", hint: "קנייה ושיפוץ, בלי הקרקע", value: computed(r.sources.buildingMinor, r, ["purchase", "land"]), target: { kind: "part", part: "building" } },
      { key: "years", op: "÷", label: "פחת בשנה", hint: "לאורך 27.5 שנים", value: computed(r.sources.depreciationYearMinor, r, ["purchase", "land"]) },
      { key: "bracket", op: "×", label: "מדרגת המס", hint: "שלך · עריכה", value: bracket == null ? missing("tax_bracket") : { kind: "text", text: bracketText(bracket) }, target: { kind: "edit", field: "tax_bracket" } },
    ],
    result: { key: "tax", op: "=", label: "חיסכון מס בשנה", value: computed(r.sources.taxSavingsMinor, r, ["purchase", "land", "tax_bracket"]) },
  };
}

/* -- the equity card ------------------------------------------------------------------------------ */

export function equityTodayFormula(r: PropertyReturns): Formula {
  const balance = r.inputs.loanBalanceMinor ?? 0n;
  return {
    rows: [
      { key: "value", op: "", label: "שווי היום", value: typed(r.inputs.valueMinor, "value"), target: { kind: "edit", field: "value" } },
      { key: "loans", op: "−", label: "יתרת הלוואות", value: money(-balance), target: { kind: "loans" } },
    ],
    result: { key: "equity", op: "=", label: "הון עצמי היום", value: computed(r.equity.todayMinor, r, ["value"]) },
  };
}

function rehabRow(r: PropertyReturns, op: Op, part: PartKey, negate: boolean): FormulaRow {
  const rehab = r.inputs.rehabMinor;
  return {
    key: "rehab",
    op,
    label: "שיפוץ עד היום",
    hint: "מחושב מההוצאות",
    value: rehab == null ? { kind: "text", text: "לא מחושב" } : money(negate ? -rehab : rehab),
    target: { kind: "part", part },
  };
}

export function forcedFormula(r: PropertyReturns): Formula {
  return {
    rows: [
      { key: "arv", op: "", label: "שווי אחרי שיפוץ (ARV)", hint: "הערכה שלך", value: typed(r.inputs.arvMinor, "arv"), target: { kind: "edit", field: "arv" } },
      { key: "purchase", op: "−", label: "מחיר רכישה", value: typed(r.inputs.purchaseMinor, "purchase", true), target: { kind: "edit", field: "purchase" } },
      rehabRow(r, "−", "forced", true),
    ],
    result: { key: "forced", op: "=", label: "השבחה צפויה", value: computed(r.equity.forcedMinor, r, ["arv", "purchase"]) },
  };
}

export function moneyInFormula(r: PropertyReturns): Formula {
  return {
    rows: [
      { key: "purchase", op: "", label: "מחיר רכישה", hint: "מנתוני הנכס · עריכה", value: typed(r.inputs.purchaseMinor, "purchase"), target: { kind: "edit", field: "purchase" } },
      rehabRow(r, "+", "money-in", false),
      { key: "borrowed", op: "−", label: "הלוואות בקנייה", hint: "הסכום שנלקח · לא היתרה", value: money(-(r.inputs.borrowedMinor ?? 0n)), target: { kind: "loans" } },
    ],
    result: { key: "money-in", op: "=", label: "כסף בעסקה", value: computed(r.equity.moneyInMinor, r, ["purchase"]) },
  };
}

export function buildingFormula(r: PropertyReturns): Formula {
  return {
    rows: [
      { key: "purchase", op: "", label: "מחיר רכישה", hint: "מנתוני הנכס · עריכה", value: typed(r.inputs.purchaseMinor, "purchase"), target: { kind: "edit", field: "purchase" } },
      rehabRow(r, "+", "building", false),
      { key: "land", op: "−", label: "קרקע", hint: "שלך · עריכה", value: typed(r.inputs.landMinor, "land", true), target: { kind: "edit", field: "land" } },
    ],
    result: { key: "building", op: "=", label: "עלות הבניין", value: computed(r.sources.buildingMinor, r, ["purchase", "land"]) },
  };
}

/* -- the ⓘ sheet ---------------------------------------------------------------------------------- */

export type InfoKey = "cash_flow" | "principal" | "appreciation" | "tax" | "equity_today" | "forced" | "money_in";

export type ReturnInfo = { key: InfoKey; title: string; body: string; formula: Formula; caption?: string };

const INFO: Record<InfoKey, { title: string; body: string; caption?: string; formula: (r: PropertyReturns) => Formula }> = {
  cash_flow: { title: "תזרים", body: "מה שנשאר בחשבון אחרי כל ההוצאות והתשלומים", formula: cashFlowFormula },
  principal: { title: "החזר קרן", body: "חלק הקרן מתשלומי ההלוואה: חוב שנפרע, כסף שנשאר שלך", formula: principalFormula },
  appreciation: { title: "עליית ערך", body: "כמה השווי עלה מתחילת התקופה ועד סופה, לפי השווי שהזנת", formula: appreciationFormula },
  tax: {
    title: "חיסכון מס",
    body: "פחת הוא הוצאה על הנייר: את עלות הבניין (בלי הקרקע) מורידים מההכנסה לאורך 27.5 שנה. ההכנסה החייבת קטנה, וגם המס.",
    caption: TAX_CAPTION,
    formula: taxFormula,
  },
  equity_today: { title: "הון עצמי היום", body: "החלק בנכס שהוא שלך: השווי היום, פחות מה שעוד חייבים", formula: equityTodayFormula },
  forced: { title: "השבחה צפויה", body: "כמה ערך השיפוץ יוסיף: השווי אחרי השיפוץ, פחות מה שהנכס עלה", formula: forcedFormula },
  money_in: { title: "כסף בעסקה", body: "הכסף שלך שנמצא בנכס: מה שהוא עלה, פחות מה שנלקח בהלוואות", formula: moneyInFormula },
};

export function returnInfo(key: InfoKey, r: PropertyReturns): ReturnInfo {
  const info = INFO[key];
  return { key, title: info.title, body: info.body, caption: info.caption, formula: info.formula(r) };
}

/** A sheet's own figure, by its title: the formula's result, or the single row it shows. */
export function infoFigure(info: ReturnInfo): FigureValue | null {
  return info.formula.result?.value ?? info.formula.rows[0]?.value ?? null;
}

/* -- a part's page -------------------------------------------------------------------------------- */

export type PartPage = { title: string; meta: string; body: string; back: string; formula: Formula };

/** The part's own rows, without the row that opens this same page. */
function withoutSelf(formula: Formula, part: PartKey): Formula {
  return { ...formula, rows: formula.rows.map((row) => (row.target?.kind === "part" && row.target.part === part ? { ...row, target: undefined, hint: "לפי התנועות למטה" } : row)) };
}

export function partPage(part: PartKey, r: PropertyReturns): PartPage {
  if (part === "building") {
    return {
      title: "עלות הבניין",
      meta: "קנייה ושיפוץ, בלי הקרקע",
      body: "מה שהנכס עלה, בלי הקרקע: קרקע לא מתבלה, ולכן אין עליה פחת. מחלקים ב־27.5 שנה, תקופת הפחת של בניין מגורים.",
      back: "חיסכון",
      formula: withoutSelf(buildingFormula(r), part),
    };
  }
  if (part === "money-in") {
    return { title: "כסף בעסקה", meta: "קנייה ושיפוץ פחות הלוואות", body: INFO.money_in.body, back: "השקעה", formula: withoutSelf(moneyInFormula(r), part) };
  }
  return { title: "השבחה צפויה", meta: "ARV פחות קנייה ושיפוץ", body: INFO.forced.body, back: "השקעה", formula: withoutSelf(forcedFormula(r), part) };
}

/* -- the metrics ---------------------------------------------------------------------------------- */

export type MetricSection = { key: string; title: string; total?: FigureValue; formula: Formula };
export type MetricPage = { title: string; caption: string; value: FigureValue; sections: MetricSection[]; result: { text: string; value: FigureValue } | null };

const PERIOD = "12 חודשים";

function cents(minor: bigint, currency: string): string {
  return formatAmount(minor, "summary", currency);
}

function noiFormula(r: PropertyReturns): Formula {
  const st = r.statement;
  return {
    rows: [
      { key: "income", op: "", label: "הכנסות", hint: countHint(st.counts.income), value: money(st.incomeMinor, true), target: { kind: "line", line: "income" } },
      { key: "opex", op: "−", label: "הוצאות תפעול", hint: countHint(st.counts.opex), value: money(st.opexMinor), target: { kind: "line", line: "opex" } },
    ],
    result: { key: "noi", op: "=", label: "רווח תפעולי (NOI)", value: money(st.noiMinor) },
  };
}

function cashSection(r: PropertyReturns): MetricSection {
  return {
    key: "cash",
    title: "תזרים",
    total: money(r.statement.cashFlowMinor),
    formula: { rows: [{ key: "cash", op: "", label: "תזרים", hint: "רווח תפעולי פחות הלוואה ושיפוץ", value: money(r.statement.cashFlowMinor), target: { kind: "statement" } }], result: null },
  };
}

function bpValue(bp: number | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (bp != null) return { kind: "text", text: percentText(bp) };
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : missing(add);
}

/** The card's row value of a metric (the same as its page's figure). */
export function metricValue(metric: MetricKey, r: PropertyReturns): FigureValue {
  const m = r.metrics;
  if (metric === "coc") return bpValue(m.cashOnCashBp, r, ["purchase"]);
  if (metric === "cap-rate") return bpValue(m.capRateBp, r, ["value"]);
  if (metric === "dscr") return m.dscrMilli == null ? { kind: "text", text: "אין תשלומים" } : { kind: "text", text: dscrText(m.dscrMilli) };
  return m.perUnitMonthMinor == null ? missing("units") : money(m.perUnitMonthMinor);
}

export const METRIC_TITLES: Record<MetricKey, string> = {
  coc: "תשואה על המזומן",
  "cap-rate": "Cap rate",
  dscr: "כיסוי חוב (DSCR)",
  "per-unit": "תזרים ליחידה",
};

export function metricCaption(metric: MetricKey, r: PropertyReturns): string {
  if (metric === "coc") return "תזרים ÷ כסף בעסקה";
  if (metric === "cap-rate") return "רווח תפעולי ÷ שווי היום";
  if (metric === "dscr") return "רווח תפעולי ÷ תשלומי הלוואה";
  const units = r.inputs.units;
  return units == null ? "בחודש · תזרים ÷ יחידות ÷ 12" : `בחודש · תזרים ÷ ${String(units)} ${units === 1 ? "יחידה" : "יחידות"} ÷ 12`;
}

export function metricPage(metric: MetricKey, r: PropertyReturns): MetricPage {
  const cur = r.currency;
  const st = r.statement;
  const value = metricValue(metric, r);
  const title = METRIC_TITLES[metric];
  const caption = `${metricCaption(metric, r)} · ${PERIOD}`;
  const result = (text: string | null) => (text == null || value.kind === "missing" ? null : { text, value });
  if (metric === "coc") {
    const moneyIn = r.equity.moneyInMinor;
    return {
      title,
      caption,
      value,
      sections: [cashSection(r), { key: "money-in", title: "כסף בעסקה", total: computed(moneyIn, r, ["purchase"]), formula: moneyInFormula(r) }],
      result: result(moneyIn == null ? null : `${cents(st.cashFlowMinor, cur)} ÷ ${cents(moneyIn, cur)}`),
    };
  }
  if (metric === "cap-rate") {
    const v = r.inputs.valueMinor;
    return {
      title,
      caption,
      value,
      sections: [
        { key: "noi", title: "רווח תפעולי (NOI)", total: money(st.noiMinor), formula: noiFormula(r) },
        { key: "value", title: "שווי היום", formula: { rows: [{ key: "value", op: "", label: "שווי היום", hint: "מנתוני הנכס · עריכה", value: typed(v, "value"), target: { kind: "edit", field: "value" } }], result: null } },
      ],
      result: result(v == null ? null : `${cents(st.noiMinor, cur)} ÷ ${cents(v, cur)}`),
    };
  }
  if (metric === "dscr") {
    return {
      title,
      caption,
      value,
      sections: [
        { key: "noi", title: "רווח תפעולי (NOI)", total: money(st.noiMinor), formula: noiFormula(r) },
        { key: "debt", title: "תשלומי הלוואה", formula: { rows: [{ key: "debt", op: "", label: "תשלומי הלוואה", hint: countHint(st.counts.debt_service), value: money(st.debtServiceMinor), target: { kind: "line", line: "debt_service" } }], result: null } },
      ],
      result: result(r.metrics.dscrMilli == null ? null : `${cents(st.noiMinor, cur)} ÷ ${cents(-st.debtServiceMinor, cur)}`),
    };
  }
  const units = r.inputs.units;
  return {
    title,
    caption,
    value,
    sections: [
      cashSection(r),
      { key: "units", title: "יחידות", formula: { rows: [{ key: "units", op: "", label: "יחידות בנכס", hint: "מנתוני הנכס · עריכה", value: units == null ? missing("units") : { kind: "text", text: String(units) }, target: { kind: "edit", field: "units" } }], result: null } },
    ],
    result: result(units == null ? null : `${cents(st.cashFlowMinor, cur)} ÷ ${String(units)} ÷ 12`),
  };
}

/* -- the statement and its lines ------------------------------------------------------------------ */

export const LINE_TITLES: Record<ReturnLine, string> = {
  income: "שכר דירה",
  opex: "הוצאות תפעול",
  debt_service: "תשלומי הלוואה",
  capex: "שיפוץ (CapEx)",
  not_counted: "לא נספר בתזרים",
  principal: "החזר קרן",
};

/** A line's figure: the statement's, or the principal paid (a cost's part shown as paid, so negative). */
export function lineMinor(line: ReturnLine, r: PropertyReturns): bigint {
  const st = r.statement;
  if (line === "income") return st.incomeMinor;
  if (line === "opex") return st.opexMinor;
  if (line === "debt_service") return st.debtServiceMinor;
  if (line === "capex") return st.capexMinor;
  if (line === "not_counted") return st.notCountedMinor;
  return r.sources.principalMinor;
}

