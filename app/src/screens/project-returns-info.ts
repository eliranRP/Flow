import { formatAmount } from "../ui/amount";
import { formatDisplay } from "../ui/date-math";
import { INVESTMENT_LABELS, type InvestmentField } from "../ui/investment-card";
import { bracketText, dscrText, percentText, type PropertyReturns, type RehabRow, type ReturnLine } from "./project-returns-data";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451: what every ⓘ, part and metric shows, as data. A row is an operator, a name, a figure and
 * where it comes from; the "=" row is the result. Figures are signed as they count: a cost or a
 * figure taken away is negative, so the rows before "=" add up to it (except the tax rows' ÷ and ×).
 * ---------------------------------------------------------------------------------------------- */

/** The figures the owner types: the project's own, and the company's tax bracket. */
/** FLOW-1068: `selling_cost` is the costs of selling, a percent of the ARV (8% until set). */
export type EditField = InvestmentField | "tax_bracket" | "selling_cost";
/** FLOW-1068: `profit` is a renovation's net profit at the sale. */
export type PartKey = "building" | "money-in" | "forced" | "rehab" | "profit";
export const PART_KEYS: readonly PartKey[] = ["building", "money-in", "forced", "rehab", "profit"];
export type MetricKey = "coc" | "cap-rate" | "dscr" | "per-unit";
export const METRIC_KEYS: readonly MetricKey[] = ["coc", "cap-rate", "dscr", "per-unit"];

export type Target =
  /** A line's page; `categoryId` narrows it to one category (`?category=`). */
  | { kind: "line"; line: ReturnLine; categoryId?: string }
  | { kind: "statement" }
  | { kind: "part"; part: PartKey }
  | { kind: "edit"; field: EditField }
  /** One loan's page, or the loans list with no id. */
  | { kind: "loans"; loanId?: string };

export type FigureValue =
  | { kind: "money"; minor: bigint; income?: boolean }
  | { kind: "text"; text: string }
  /** A muted caption in a figure's place: a per-cent figure before the first rent. */
  | { kind: "note"; text: string }
  /** "חסר" and, when `add` names one, an accent הוספה that opens that figure's sheet. */
  | { kind: "missing"; add: EditField | null; note?: string };

export type Op = "" | "+" | "−" | "÷" | "×" | "=";

export type FormulaRow = { key: string; op: Op; label: string; hint?: string; value: FigureValue; target?: Target };
export type Formula = { rows: FormulaRow[]; result: FormulaRow | null };

/** FLOW-466: one value alone; appreciation runs from the first value in the period to the last. */
export const MISSING_HISTORY = "חסר · עדכון שווי נוסף";
export const HISTORY_HINT = "עליית ערך נמדדת בין שני שווים. עדכנו את השווי שוב בעוד כמה חודשים.";
export const TAX_CAPTION = "הערכה. במכירה הפחת חוזר כמס. החישוב המדויק אצל רואה החשבון.";
export const CASH_FLOW_CAPTION = "מהשכירות הראשונה בלבד. מה שלפניה נכנס לכסף בעסקה.";
export const MONEY_IN_BODY = "מה שהנכס לקח ממך עד שהתחיל להכניס שכירות, פחות מה שחזר מההלוואה.";
export const MONEY_IN_CAPTION = "רכישה, שיפוץ והחזקה פחות הלוואות";
export const ALL_TIME = "מאז הקנייה";
/** In place of a per-cent figure when all the cash came out, and its accessible name (FLOW-457). */
export const INFINITY = "∞";
export const INFINITY_NAME = "כל ההון חזר";
/** In place of a per-cent figure before the first rent: with no rent yet, the per-cents say nothing (FLOW-468: rent, not a wage). */
export const BEFORE_FIRST_RENT = "לפני השכירות הראשונה";
export const UNITS_DEFAULT_HINT = "ברירת מחדל · עריכה";
export const TAKEN_OVER_LABEL = "הלוואה שנלקחה בסגירה";

/** Each input's one name, on its row, its sheet and a "חסר · …" hint (FLOW-457). */
export const FIELD_NAMES: Record<EditField, string> = { ...INVESTMENT_LABELS, tax_bracket: "מדרגת המס", selling_cost: "עלויות מכירה" };

/** "חסר · שווי היום": why a figure is missing, on its hint line. */
export function missingHint(field: EditField): string {
  return `חסר · ${FIELD_NAMES[field]}`;
}

export const money = (minor: bigint, income = false): FigureValue => ({ kind: "money", minor, income });
export const missing = (add: EditField | null, note?: string): FigureValue => ({ kind: "missing", add, note });

/** A typed figure, or "חסר · הוספה" for it. */
export function typed(minor: bigint | null, field: EditField, negate = false): FigureValue {
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
    if (field === "tax_bracket" && r.inputs.taxBracketBp == null) return field;
  }
  return null;
}

/** A computed figure; when it is null, "חסר · הוספה" for the first input it needs, else "לא מחושב". */
export function computed(minor: bigint | null, r: PropertyReturns, needs: readonly EditField[]): FigureValue {
  if (minor != null) return money(minor);
  const add = firstMissing(r, needs);
  return add == null ? { kind: "text", text: "לא מחושב" } : missing(add);
}

export function countHint(count: number): string {
  return count === 1 ? "תנועה אחת" : `${String(count)} תנועות`;
}

/** "עד השכירות הראשונה ב־01/04/2026", or "עדיין לפני השכירות הראשונה". */
export function firstRentHint(r: PropertyReturns): string {
  return r.firstRent == null ? "עדיין לפני השכירות הראשונה" : `עד השכירות הראשונה ב־${formatDisplay(r.firstRent)}`;
}

/** The first rent when it falls inside the period, so the statement starts there; else null. */
export function firstRentInPeriod(r: PropertyReturns): string | null {
  return r.firstRent != null && r.firstRent > r.from && r.firstRent <= r.to ? r.firstRent : null;
}

/** No rent yet (none at all, or only after the period): the per-cent figures read BEFORE_FIRST_RENT. */
export function beforeFirstRent(r: PropertyReturns): boolean {
  return r.firstRent == null || r.firstRent > r.to;
}

/** How much more came out than went in, when all the cash came out; else null. */
export function cashOutMinor(r: PropertyReturns): bigint | null {
  return r.equity.allCashOut && r.equity.moneyInMinor != null ? -r.equity.moneyInMinor : null;
}

/**
 * FLOW-1025: ∞ only for a gain on no money in. With all the cash out and a negative total, the
 * total reads as the loss in money instead: losing money on nothing in is not an infinite return.
 */
export function infiniteTotal(r: PropertyReturns): boolean {
  return cashOutMinor(r) != null && r.sources.totalMinor >= 0n;
}

/** "כ־5 שנים", "כשנה", "8 חודשים": how long the cash still out lasts, from whole months. */
export function coverText(months: number): string {
  if (months >= 18) return `כ־${String(Math.round(months / 12))} שנים`;
  if (months >= 12) return "כשנה";
  if (months === 1) return "חודש אחד";
  if (months <= 0) return "פחות מחודש";
  return `${String(months)} חודשים`;
}

/**
 * "כל הכסף חזר · התזרים שלילי: מספיק לעוד כ־5 שנים", with all the cash out and a negative cash flow;
 * else null. FLOW-469: one short line under the figure, in place of the cash-out meta.
 */
export function coverLine(r: PropertyReturns): string | null {
  const months = r.equity.coverMonths;
  // FLOW-473: the pace is the cash flow scaled to a year from the first rent: no estimate under MIN_EARNING_DAYS.
  return months == null || cashOutMinor(r) == null || fewDays(r) ? null : `${ALL_CASH_OUT} · התזרים שלילי: מספיק לעוד ${coverText(months)}`;
}

const ALL_CASH_OUT = "כל הכסף חזר";
/** FLOW-469: beside a loss in money in a per-cent figure's place (all the cash out, losing). */
export const LOSS_YEAR = "הפסד בשנה";

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
      rows: [end, { key: "start", op: "−", label: "שווי קודם", hint: HISTORY_HINT, value: missing(null, MISSING_HISTORY) }],
      result: { key: "diff", op: "=", label: "עליית ערך", value: missing(null) },
    };
  }
  return {
    // FLOW-466: with no value by the period's start, the first value recorded in it.
    rows: [end, { key: "start", op: "−", label: `שווי ב־${formatDisplay(valueStart.date)}`, hint: valueStart.date > r.from ? "השווי הראשון בתקופה" : "בתחילת התקופה", value: money(-valueStart.minor), target: edit }],
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

/** The loans taken over at closing: one loan opens its page, several the loans list. */
function takenOverTarget(r: PropertyReturns): Target {
  const loans = r.inputs.takenOverLoans;
  return loans.length === 1 && loans[0] != null ? { kind: "loans", loanId: loans[0].id } : { kind: "loans" };
}

/**
 * The purchase: from the acquisition lines (opening them), or the typed price (opening its sheet).
 * Decision 0246: a loan taken over at closing (Sub2) is a row of its own, so the two add up to the
 * price: the cash lines (purchase − taken over), then "+ הלוואה שנלקחה בסגירה" opening the loan.
 */
export function purchaseRows(r: PropertyReturns, op: Op, negate: boolean): FormulaRow[] {
  const sign = (minor: bigint) => money(negate ? -minor : minor);
  if (r.inputs.purchaseSource === "lines" && r.inputs.purchaseMinor != null) {
    const minor = r.inputs.purchaseMinor;
    const takenOver = r.inputs.takenOverMinor;
    const acquisition: Target = { kind: "line", line: "acquisition" };
    if (takenOver <= 0n) return [{ key: "purchase", op, label: "מחיר רכישה (מהתנועות)", hint: "רכישה וסגירה", value: sign(minor), target: acquisition }];
    const names = r.inputs.takenOverLoans.map((loan) => loan.name).filter((name) => name !== "").join(", ");
    return [
      { key: "purchase", op, label: "רכישה וסגירה (מהתנועות)", value: sign(minor - takenOver), target: acquisition },
      { key: "taken-over", op: negate ? "−" : "+", label: TAKEN_OVER_LABEL, hint: names === "" ? undefined : names, value: sign(takenOver), target: takenOverTarget(r) },
    ];
  }
  return [{ key: "purchase", op, label: "מחיר רכישה", hint: "מנתוני הנכס · עריכה", value: typed(r.inputs.purchaseMinor, "purchase", negate), target: { kind: "edit", field: "purchase" } }];
}

/**
 * FLOW-466: the acquisition page's calculation, when a loan paid out at closing is in the price: the
 * bank lines (opening the transactions below), "+ הלוואה שנלקחה בסגירה" for each loan at what the
 * price counts (named on its hint, opening its page), then "= מחיר רכישה", the purchase row's figure.
 * Null when no loan is in the price: the page then shows the lines alone.
 */
export function acquisitionFormula(r: PropertyReturns): Formula | null {
  const purchase = r.inputs.purchaseMinor;
  const bank = r.equity.moneyInParts.acquisitionMinor;
  if (r.inputs.takenOverMinor <= 0n || r.inputs.purchaseSource !== "lines" || purchase == null || bank == null) return null;
  return {
    rows: [
      { key: "lines", op: "", label: "רכישה וסגירה (מהתנועות)", value: money(-bank), target: { kind: "line", line: "acquisition" } },
      ...r.inputs.takenOverLoans.map((loan): FormulaRow => ({
        key: `loan-${loan.id}`,
        op: "+",
        label: TAKEN_OVER_LABEL,
        hint: loan.name === "" ? undefined : loan.name,
        value: money(loan.countedMinor),
        target: { kind: "loans", loanId: loan.id },
      })),
    ],
    result: { key: "purchase", op: "=", label: "מחיר רכישה", value: money(purchase) },
  };
}

/** The renovation so far, opening its own page (FLOW-460). */
export function rehabRow(r: PropertyReturns, op: Op, negate: boolean): FormulaRow {
  const rehab = r.inputs.rehabMinor;
  return {
    key: "rehab",
    op,
    label: "שיפוץ עד היום",
    hint: "מחושב מההוצאות",
    value: rehab == null ? { kind: "text", text: "לא מחושב" } : money(negate ? -rehab : rehab),
    target: { kind: "part", part: "rehab" },
  };
}

export function forcedFormula(r: PropertyReturns): Formula {
  return {
    rows: [
      { key: "arv", op: "", label: "שווי אחרי שיפוץ (ARV)", hint: "הערכה שלך", value: typed(r.inputs.arvMinor, "arv"), target: { kind: "edit", field: "arv" } },
      ...purchaseRows(r, "−", true),
      rehabRow(r, "−", true),
    ],
    result: { key: "forced", op: "=", label: "השבחה צפויה", value: computed(r.equity.forcedMinor, r, ["arv", "purchase"]) },
  };
}

/** "8%", "8% · ברירת מחדל": the costs of selling, and whether the owner set them. */
export function sellingText(r: PropertyReturns): string {
  return bracketText(r.deal.sellingCostBp);
}

export const NET_PROFIT_BODY = "מה שיישאר אחרי המכירה: השווי אחרי השיפוץ, פחות עלויות המכירה, הקנייה, השיפוץ וההחזקה.";

/**
 * FLOW-1068 (decision 0260): a renovation's net profit at the sale, the four cost buckets of Real
 * Estate by the Numbers Ch 42: the ARV, less the costs of selling (8% until the owner sets them), the
 * purchase, the renovation so far, and the holding costs the renovation does not already count.
 */
export function profitFormula(r: PropertyReturns): Formula {
  const selling = r.deal.sellingCostMinor;
  const sellingHint = `${sellingText(r)} מה־ARV · ${r.deal.sellingCostDefault ? "הערכה" : "שלך"} · עריכה`;
  return {
    rows: [
      { key: "arv", op: "", label: "שווי אחרי שיפוץ (ARV)", hint: "הערכה שלך", value: typed(r.inputs.arvMinor, "arv"), target: { kind: "edit", field: "arv" } },
      { key: "selling", op: "−", label: FIELD_NAMES.selling_cost, hint: sellingHint, value: selling == null ? missing("arv") : money(-selling), target: { kind: "edit", field: "selling_cost" } },
      ...purchaseRows(r, "−", true),
      rehabRow(r, "−", true),
      { key: "holding", op: "−", label: "החזקה", hint: "ריבית, ביטוח, ארנונה ושאר ההוצאות", value: money(r.deal.holdingMinor), target: { kind: "line", line: "holding" } },
    ],
    result: { key: "profit", op: "=", label: "רווח נקי צפוי", value: computed(r.deal.netProfitMinor, r, ["arv", "purchase"]) },
  };
}

/**
 * The money in the deal by part (decision 0245): what the property took before the first rent, less
 * what came back from the loans. Each part is shown as it counts (a cost positive, the proceeds
 * negative), so the rows add up to the money in; each opens its lines.
 */
export function moneyInFormula(r: PropertyReturns): Formula {
  const parts = r.equity.moneyInParts;
  const acquisition: FormulaRow = parts.acquisitionMinor == null
    ? { key: "acquisition", op: "", label: "רכישה וסגירה", value: missing("purchase"), target: { kind: "edit", field: "purchase" } }
    : r.inputs.purchaseSource === "lines"
      ? { key: "acquisition", op: "", label: "רכישה וסגירה", hint: "מהתנועות", value: money(-parts.acquisitionMinor), target: { kind: "line", line: "acquisition" } }
      : { key: "acquisition", op: "", label: "רכישה וסגירה", hint: "מחיר הרכישה שהוזן · עריכה", value: money(-parts.acquisitionMinor), target: { kind: "edit", field: "purchase" } };
  return {
    rows: [
      acquisition,
      { key: "renovation", op: "+", label: "שיפוץ לפני השכרה", value: money(-parts.renovationMinor), target: { kind: "line", line: "renovation" } },
      { key: "holding", op: "+", label: "עלויות החזקה", hint: firstRentHint(r), value: money(-parts.holdingMinor), target: { kind: "line", line: "holding" } },
      { key: "financing", op: "−", label: "תקבולי הלוואות והחזרים", hint: "נטו, אחרי עלויות ההלוואה", value: money(-parts.financingMinor), target: { kind: "line", line: "financing" } },
      // FLOW-1025: money the owner added to cover a negative cash flow since the first rent.
      ...(parts.shortfallMinor < 0n
        ? [{ key: "shortfall", op: "+", label: "כיסוי תזרים שלילי", hint: "מאז השכירות הראשונה", value: money(-parts.shortfallMinor) } satisfies FormulaRow]
        : []),
    ],
    result: { key: "money-in", op: "=", label: "כסף בעסקה", hint: r.equity.allCashOut ? "כל הכסף חזר" : undefined, value: computed(r.equity.moneyInMinor, r, ["purchase"]) },
  };
}

export function buildingFormula(r: PropertyReturns): Formula {
  return {
    rows: [
      ...purchaseRows(r, "", false),
      rehabRow(r, "+", false),
      { key: "land", op: "−", label: FIELD_NAMES.land, hint: "שלך · עריכה", value: typed(r.inputs.landMinor, "land", true), target: { kind: "edit", field: "land" } },
    ],
    result: { key: "building", op: "=", label: "עלות הבניין", value: computed(r.sources.buildingMinor, r, ["purchase", "land"]) },
  };
}

/* -- the ⓘ sheet ---------------------------------------------------------------------------------- */

export type InfoKey = "cash_flow" | "principal" | "appreciation" | "tax" | "equity_today" | "forced" | "money_in";

export type ReturnInfo = { key: InfoKey; title: string; body: string; formula: Formula; caption?: string };

const INFO: Record<InfoKey, { title: string; body: string; caption?: string; formula: (r: PropertyReturns) => Formula }> = {
  cash_flow: { title: "תזרים", body: "מה שנשאר בחשבון אחרי כל ההוצאות והתשלומים", caption: CASH_FLOW_CAPTION, formula: cashFlowFormula },
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
  money_in: { title: "כסף בעסקה", body: MONEY_IN_BODY, formula: moneyInFormula },
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

export const REHAB_BODY = "כל הוצאות הנכס שנספרות בשיפוץ, מאז הקנייה.";
export const NO_CATEGORY = "בלי קטגוריה";

/**
 * The renovation so far by category (FLOW-460, decision 0247): each category that counts, largest
 * first, opening its lines; the rows add up to the figure, as the server sums them from the same lines.
 */
export function rehabFormula(r: PropertyReturns, rows: readonly RehabRow[]): Formula {
  const rehab = r.inputs.rehabMinor;
  return {
    rows: rows.map((row, index) => ({
      key: row.id ?? "none",
      op: index === 0 ? "" : "+",
      label: row.name ?? NO_CATEGORY,
      value: money(row.minor),
      // A line with no category has no page of its own: the transactions below list it.
      target: row.id == null ? undefined : { kind: "line", line: "rehab", categoryId: row.id },
    })),
    result: { key: "rehab", op: "=", label: "שיפוץ עד היום", value: rehab == null ? { kind: "text", text: "לא מחושב" } : money(rehab) },
  };
}

/** A part's page; `rehab` is the renovation's categories, for its own page. */
export function partPage(part: PartKey, r: PropertyReturns, rehab: readonly RehabRow[] = []): PartPage {
  if (part === "rehab") {
    return { title: "שיפוץ עד היום", meta: "", body: REHAB_BODY, back: "השקעה", formula: rehabFormula(r, rehab) };
  }
  if (part === "building") {
    return {
      title: "עלות הבניין",
      meta: "קנייה ושיפוץ, בלי הקרקע",
      body: "מה שהנכס עלה, בלי הקרקע: קרקע לא מתבלה, ולכן אין עליה פחת. מחלקים ב־27.5 שנה, תקופת הפחת של בניין מגורים.",
      back: "חיסכון",
      formula: buildingFormula(r),
    };
  }
  if (part === "money-in") {
    return { title: "כסף בעסקה", meta: MONEY_IN_CAPTION, body: MONEY_IN_BODY, back: "השקעה", formula: moneyInFormula(r) };
  }
  if (part === "profit") {
    return { title: "רווח נקי צפוי", meta: "ARV פחות מכירה, קנייה, שיפוץ והחזקה", body: NET_PROFIT_BODY, back: "השקעה", formula: profitFormula(r) };
  }
  return { title: "השבחה צפויה", meta: "ARV פחות קנייה ושיפוץ", body: INFO.forced.body, back: "השקעה", formula: forcedFormula(r) };
}

/* -- the metrics ---------------------------------------------------------------------------------- */

export type MetricSection = { key: string; title: string; total?: FigureValue; formula: Formula };
/** `cashOut`: how much more came out than went in, when all the cash came out (the caption then says so). */
export type MetricPage = {
  title: string;
  caption: string;
  cashOut: bigint | null;
  value: FigureValue;
  sections: MetricSection[];
  /** FLOW-464: `yearly` is the row that scales the figure since the first rent to a year, before "=". */
  result: { text: string; value: FigureValue; yearly?: FormulaRow } | null;
};

const PERIOD = "12 חודשים";

export function cents(minor: bigint, currency: string): string {
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
  if (beforeFirstRent(r)) return { kind: "note", text: BEFORE_FIRST_RENT };
  if (bp == null) {
    const add = firstMissing(r, needs);
    return add == null ? { kind: "text", text: "לא מחושב" } : missing(add);
  }
  return fewDays(r) ? { kind: "note", text: FEW_DAYS } : { kind: "text", text: percentText(bp) };
}

/** The card's row value of a metric (the same as its page's figure). */
export function metricValue(metric: MetricKey, r: PropertyReturns): FigureValue {
  const m = r.metrics;
  if (metric === "coc") {
    if (!r.equity.allCashOut) return bpValue(m.cashOnCashBp, r, ["purchase"]);
    // FLOW-1025: ∞ only when the cash flow is not a loss; a loss reads as the money lost a year.
    if (r.statement.cashFlowMinor >= 0n || beforeFirstRent(r)) return { kind: "text", text: INFINITY };
    // FLOW-473: the loss a year is scaled too, so it waits for MIN_EARNING_DAYS as well.
    return fewDays(r) ? { kind: "note", text: FEW_DAYS } : money(perYear(r.statement.cashFlowMinor, r));
  }
  if (metric === "cap-rate") return bpValue(m.capRateBp, r, ["value"]);
  if (metric === "dscr") return m.dscrMilli == null ? { kind: "text", text: NO_PAYMENTS } : { kind: "text", text: dscrText(m.dscrMilli) };
  // FLOW-468: before the first rent the cash flow per unit says nothing either, as its siblings.
  if (beforeFirstRent(r)) return { kind: "note", text: BEFORE_FIRST_RENT };
  return fewDays(r) ? { kind: "note", text: FEW_DAYS } : money(m.perUnitMonthMinor);
}

export const METRIC_TITLES: Record<MetricKey, string> = {
  coc: "תשואה על המזומן",
  "cap-rate": "Cap rate",
  dscr: "כיסוי חוב (DSCR)",
  "per-unit": "תזרים ליחידה",
};

/** DSCR with no loan payment since the first rent (or in the period). */
export const NO_PAYMENTS = "אין תשלומים עדיין";
/** FLOW-464: under a per-year metric that scales from a first rent inside the period. */
export const ANNUALIZED = "מחושב לשנה";

/** The metrics a first rent inside the period scales to a year (DSCR is a ratio, and is not). */
const SCALED: readonly MetricKey[] = ["coc", "cap-rate", "per-unit"];

/**
 * FLOW-473 (decision 0253): the fewest days since a first rent inside the period that a per-year
 * figure scales from. Below it, the scaled figures (SCALED and the total return) read FEW_DAYS.
 */
export const MIN_EARNING_DAYS = 60;
export const FEW_DAYS = "מעט נתונים";

/** A first rent inside the period fewer than MIN_EARNING_DAYS back: a per-year figure would be a guess. */
export function fewDays(r: PropertyReturns): boolean {
  return r.annualizedFrom != null && r.earningDays != null && r.earningDays < MIN_EARNING_DAYS;
}

/** "מחושב לשנה מ־60 ימים": when a per-year figure shows, beside FEW_DAYS. */
export const ANNUALIZED_FROM = `${ANNUALIZED} מ־${String(MIN_EARNING_DAYS)}\u00a0ימים`;

/** "מהשכירות הראשונה · 21 ימים · מחושב לשנה מ־60 ימים": why a scaled figure reads FEW_DAYS. */
export function fewDaysText(r: PropertyReturns): string {
  // A number keeps its word ("21 ימים") on one line at 320.
  return `מהשכירות הראשונה · ${daysText(r.earningDays ?? 0).replace(" ", "\u00a0")} · ${ANNUALIZED_FROM}`;
}

export function annualized(metric: MetricKey, r: PropertyReturns): boolean {
  return r.annualizedFrom != null && SCALED.includes(metric);
}

/** A figure since the first rent, scaled to a year (365 / the days since it), rounded half away from zero. */
export function perYear(minor: bigint, r: PropertyReturns): bigint {
  const days = BigInt(r.earningDays ?? 365);
  const scaled = minor * 365n * 2n;
  return (scaled + (scaled < 0n ? -days : days)) / (2n * days);
}

/** How a metric is made: "רווח תפעולי ÷ שווי היום". */
function metricFormula(metric: MetricKey, r: PropertyReturns): string {
  return metric === "coc" ? "תזרים ÷ כסף בעסקה"
    : metric === "cap-rate" ? "רווח תפעולי ÷ שווי היום"
    : metric === "dscr" ? "רווח תפעולי ÷ תשלומי הלוואה"
    : `בחודש · תזרים ÷ ${String(r.inputs.units)} ${r.inputs.units === 1 ? "יחידה" : "יחידות"} ÷ 12`;
}

/** "21 ימים", "יום אחד": how many days a per-year figure is scaled from. */
export function daysText(days: number): string {
  return days === 1 ? "יום אחד" : `${String(days)} ימים`;
}

/**
 * A metric row's caption. FLOW-467: a figure scaled to a year says from how many days, so a first
 * rent a few days back reads as the estimate it is. FLOW-469: cash-on-cash as a loss in money says so.
 */
export function metricCaption(metric: MetricKey, r: PropertyReturns): string {
  const value = metricValue(metric, r);
  // FLOW-473: with too few days, the caption says why there is no figure.
  if (value.kind === "note" && value.text === FEW_DAYS) return fewDaysText(r);
  // A scaled figure says its days whatever it reads (FLOW-467), a loss in money included.
  const scaled = annualized(metric, r) ? ` · ${ANNUALIZED} · ${daysText(r.earningDays ?? 365)}` : "";
  if (metric === "coc" && value.kind === "money") return `${LOSS_YEAR} · ${ALL_CASH_OUT}${scaled}`;
  return `${metricFormula(metric, r)}${scaled}`;
}

/** The metric page's period: the last 12 months, or since the first rent, scaled to a year. */
function metricPeriod(metric: MetricKey, r: PropertyReturns): string {
  if (r.annualizedFrom == null) return PERIOD;
  const since = `מהשכירות הראשונה ב־${formatDisplay(r.annualizedFrom)} · ${daysText(r.earningDays ?? 365)}`;
  if (!SCALED.includes(metric)) return since;
  // FLOW-473: below MIN_EARNING_DAYS the page says from when it will show a figure.
  return metricValue(metric, r).kind === "note" && fewDays(r) ? `${since} · ${ANNUALIZED_FROM}` : `${since}, ${ANNUALIZED}`;
}

export function metricPage(metric: MetricKey, r: PropertyReturns): MetricPage {
  const cur = r.currency;
  const st = r.statement;
  const value = metricValue(metric, r);
  const title = METRIC_TITLES[metric];
  const caption = `${metricFormula(metric, r)} · ${metricPeriod(metric, r)}`;
  // FLOW-464: scaled from the first rent, the division shows the figure for a year.
  const yearly = (minor: bigint) => (annualized(metric, r) ? perYear(minor, r) : minor);
  const yearRow = (label: string, minor: bigint): FormulaRow | undefined => (annualized(metric, r)
    ? { key: "yearly", op: "", label: `${label} לשנה`, hint: `\u2066${cents(minor, cur)} ÷ ${String(r.earningDays)} × 365\u2069`, value: money(perYear(minor, r)) }
    : undefined);
  // No result row for a figure that is missing, or that reads BEFORE_FIRST_RENT.
  // The division reads left to right inside the Hebrew row (an LTR isolate), as numbers are written.
  const result = (text: string | null, yearlyRow?: FormulaRow) => (text == null || value.kind === "missing" || value.kind === "note" ? null : { text: `\u2066${text}\u2069`, value, yearly: yearlyRow });
  if (metric === "coc") {
    const moneyIn = r.equity.moneyInMinor;
    const cashOut = cashOutMinor(r);
    return {
      title,
      caption,
      cashOut,
      value,
      sections: [cashSection(r), { key: "money-in", title: "כסף בעסקה", total: computed(moneyIn, r, ["purchase"]), formula: moneyInFormula(r) }],
      result: result(moneyIn == null || cashOut != null ? null : `${cents(yearly(st.cashFlowMinor), cur)} ÷ ${cents(moneyIn, cur)}`, yearRow("תזרים", st.cashFlowMinor)),
    };
  }
  if (metric === "cap-rate") {
    const v = r.inputs.valueMinor;
    return {
      title,
      caption,
      cashOut: null,
      value,
      sections: [
        { key: "noi", title: "רווח תפעולי (NOI)", total: money(st.noiMinor), formula: noiFormula(r) },
        { key: "value", title: "שווי היום", formula: { rows: [{ key: "value", op: "", label: "שווי היום", hint: "מנתוני הנכס · עריכה", value: typed(v, "value"), target: { kind: "edit", field: "value" } }], result: null } },
      ],
      result: result(v == null ? null : `${cents(yearly(st.noiMinor), cur)} ÷ ${cents(v, cur)}`, yearRow("רווח תפעולי", st.noiMinor)),
    };
  }
  if (metric === "dscr") {
    return {
      title,
      caption,
      cashOut: null,
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
    cashOut: null,
    value,
    sections: [
      cashSection(r),
      { key: "units", title: FIELD_NAMES.units, formula: { rows: [{ key: "units", op: "", label: FIELD_NAMES.units, hint: r.inputs.unitsDefault ? UNITS_DEFAULT_HINT : "מנתוני הנכס · עריכה", value: { kind: "text", text: String(units) }, target: { kind: "edit", field: "units" } }], result: null } },
    ],
    result: result(`${cents(yearly(st.cashFlowMinor), cur)} ÷ ${String(units)} ÷ 12`, yearRow("תזרים", st.cashFlowMinor)),
  };
}

/* -- the statement and its lines ------------------------------------------------------------------ */

export const LINE_TITLES: Record<ReturnLine, string> = {
  income: "שכר דירה",
  opex: "הוצאות תפעול",
  debt_service: "תשלומי הלוואה",
  capex: "שיפוץ (CapEx)",
  before_rent: "לפני השכרה",
  not_counted: "לא נספר בתזרים",
  principal: "החזר קרן",
  acquisition: "רכישה וסגירה",
  renovation: "שיפוץ לפני השכרה",
  holding: "עלויות החזקה",
  financing: "תקבולי הלוואות והחזרים",
  money_in: "כסף בעסקה",
  rehab: "שיפוץ עד היום",
};

/**
 * A line's figure, signed as its transactions: the statement's, the principal paid (a cost's part
 * shown as paid, so negative), or a part of the money in (all time). Null with no purchase at all.
 */
export function lineMinor(line: ReturnLine, r: PropertyReturns): bigint | null {
  const st = r.statement;
  const parts = r.equity.moneyInParts;
  if (line === "income") return st.incomeMinor;
  if (line === "opex") return st.opexMinor;
  if (line === "debt_service") return st.debtServiceMinor;
  if (line === "capex") return st.capexMinor;
  if (line === "before_rent") return st.beforeRentMinor;
  if (line === "not_counted") return st.notCountedMinor;
  if (line === "acquisition") return parts.acquisitionMinor;
  if (line === "renovation") return parts.renovationMinor;
  if (line === "holding") return parts.holdingMinor;
  if (line === "financing") return parts.financingMinor;
  if (line === "money_in") return r.equity.moneyInMinor == null ? null : -r.equity.moneyInMinor;
  if (line === "rehab") return r.inputs.rehabMinor == null ? null : -r.inputs.rehabMinor;
  return r.sources.principalMinor;
}

