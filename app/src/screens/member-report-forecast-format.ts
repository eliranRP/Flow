import {
  PROJECTION_DEFAULTS,
  PROJECTION_SERIES,
  formatMoney,
  type MemberProjection,
  type ProjectionConfig,
  type ProjectionResult,
  type ProjectionSeries,
  type ProjectionYear,
  type PropertyProjection,
} from "@flow/shared";
import { bpText, ppmText } from "./member-report-format";
import type { Formula, FormulaRow } from "./project-returns-info";

/* ------------------------------------------------------------------------------------------------
 * FLOW-1127 (FLOW-1125's mockup A, C and D): the forecast tab's words and formulas (pure, for the tab and its
 * sheets). Every figure comes from computeMemberProjection's result.
 * ---------------------------------------------------------------------------------------------- */

/** The calendar year that year N of the forecast ends in. */
export function forecastYear(r: ProjectionResult, n = r.years): number {
  return Number(r.asOf.slice(0, 4)) + n;
}

function money(key: string, op: FormulaRow["op"], label: string, minor: bigint, hint?: string, income = false): FormulaRow {
  return { key, op, label, ...(hint == null ? {} : { hint }), value: { kind: "money", minor, ...(income ? { income: true } : {}) } };
}

/** The part of the forecast's החישוב a row opens. */
export type ForecastDrillKey = "loan" | "payoff" | "member_loans" | "closing" | "split" | "share" | "total";

function opens(row: FormulaRow, sheet: ForecastDrillKey): FormulaRow {
  return { ...row, target: { kind: "sheet", sheet: `forecast:${sheet}` } };
}

/** The members' loans the refinance repays: on the refinanced properties, and the company's own out of the cash out. */
export function membersRepaid(r: ProjectionResult): bigint {
  return r.refi.payoffMemberLoansMinor + r.refi.companyLoansRepaidMinor;
}

/**
 * The refinance in year N: new loan − the banks' loans − the members' loans repaid − closing = what the members
 * split, then the member's part, their loans back, and their total. Every row opens its parts.
 */
export function forecastFormula(r: ProjectionResult, member: MemberProjection | null): Formula {
  const f = r.refi;
  const year = forecastYear(r);
  const repaid = membersRepaid(r);
  const rows: FormulaRow[] = [
    opens(money("loan", "", "הלוואה חדשה", f.newLoanMinor, `${bpText(r.assumptions.ltvBp)} מהשווי ב־${String(year)}`), "loan"),
    opens(money("payoff", "−", "סילוק הלוואות", -(f.payoffMinor - f.payoffMemberLoansMinor), `היתרות ב־${String(year)}`), "payoff"),
    ...(repaid === 0n ? [] : [opens(money("member_loans", "−", "החזר הלוואות שותפים", -repaid, "חוזרות לשותף שנתן אותן"), "member_loans")]),
    opens(money("closing", "−", "עלויות סגירה", -f.closingMinor, `${bpText(r.assumptions.closingBp)} מההלוואה החדשה`), "closing"),
  ];
  if (member == null) {
    rows.push(opens(money("split", "=", "כסף שמשתחרר לשותפים", f.splitMinor, `${String(f.refinancedCount)} נכסים ממוחזרים`, true), "split"));
    return { rows, result: null };
  }
  rows.push(opens(money("split", "=", "כסף שמשתחרר לשותפים", f.splitMinor, "לכל השותפים"), "split"));
  rows.push(opens(money("share", "=", `החלק של ${member.name}`, member.cashShareMinor, bpText(member.ownershipBp), true), "share"));
  if (repaid !== 0n) {
    rows.push(opens(money("own", "+", `הלוואות של ${member.name}`, member.loansBackMinor, member.loansBackMinor === 0n ? "אין" : "מוחזרות בריפייננס", true), "member_loans"));
    rows.push(opens(money("total", "=", `סה״כ ל־${member.name}`, member.totalMinor, "חלק בכסף + הלוואות", true), "total"));
  }
  return { rows, result: null };
}

/** עד אז: the cash flow until the refinance, the new payment, the rate and the DSCR it leaves. */
export function untilFormula(r: ProjectionResult, member: MemberProjection | null): Formula {
  const year = forecastYear(r);
  const f = r.refi;
  const cash = member?.cashFlowMinor ?? r.cashFlowMinor;
  const rows: FormulaRow[] = [
    money("cash", "", `תזרים מצטבר עד ${String(year)}`, cash, member == null ? "שכירות פחות החזקה, תחזוקה, CapEx, תחלופה ותשלומים" : `${bpText(member.ownershipBp)} מהתזרים של התיק`, cash > 0n),
  ];
  if (f.debtServiceMinor != null) {
    rows.push(money("payment", "", "תשלום חודשי אחרי הריפייננס", f.debtServiceMinor / 12n,
      `${f.ratePpm == null ? "" : ppmText(f.ratePpm)}${f.rateIsToday ? " · הריבית הצפויה היום, לא תחזית" : " · שלך"} · ${String(f.termYears)} שנה`));
  }
  if (f.dscrMilli != null) {
    rows.push({ key: "dscr", op: "", label: "כיסוי החוב (DSCR)", hint: `NOI של ${String(year)} מול התשלומים החדשים · לתצוגה בלבד`,
      value: { kind: "text", text: (f.dscrMilli / 1000).toFixed(2) } });
  }
  return { rows, result: null };
}

/** One property's statement for one year (D). */
export function propertyYearFormula(y: ProjectionYear, r: ProjectionResult): Formula {
  const g = r.assumptions.growthBp;
  const rows: FormulaRow[] = [
    money("rent", "", "שכירות", y.rentMinor, `${formatMoney(y.rentMinor / 12n, r.currency ?? "USD")} לחודש · ${bpText(g.rent)} בשנה`),
    money("vacancy", "−", "חודשים ריקים", -y.vacancyMinor, `תחלופה כל ${String(r.assumptions.stayMonths)} חודשים`),
    money("turnover", "−", "עלות תחלופה", -y.turnoverMinor),
    money("tax", "−", "מס נכס", -y.costs.tax, `${bpText(g.tax)} בשנה`),
    money("insurance", "−", "ביטוח", -y.costs.insurance, `${bpText(g.insurance)} בשנה`),
    money("hoa", "−", "HOA", -y.costs.hoa, `${bpText(g.hoa)} בשנה`),
    money("other", "−", "עלויות אחרות", -y.costs.other, `${bpText(g.other)} בשנה`),
    money("maintenance", "−", "תחזוקה", -y.maintenanceMinor, `${bpText(r.assumptions.maintenanceBp)} מהשכירות`),
    money("capex", "−", "רזרבה ל־CapEx", -y.capexMinor, `${bpText(r.assumptions.capexBp)} מהשכירות`),
    money("noi", "=", "NOI", y.noiMinor, "הכנסה תפעולית נטו"),
    money("debt", "−", "תשלומי ההלוואות", -y.debtServiceMinor, "קרן וריבית, לפי לוח הסילוקין"),
  ];
  return { rows, result: money("cash", "=", "תזרים", y.cashFlowMinor, "לפני מס", y.cashFlowMinor > 0n) };
}

/** Why a property is left out of the forecast. */
export const FORECAST_MISSING_WORDS: Record<ProjectionResult["missing"][number]["reason"], string> = {
  value: "אין שווי",
  currency: "במטבע אחר",
  loan_currency: "הלוואה במטבע אחר",
  rent: "אין שכירות ב־3 החודשים האחרונים",
};

/** The properties left out, grouped by reason in the order the reasons first appear: one line per reason. */
export function missingByReason(missing: ProjectionResult["missing"]): { reason: string; names: string[] }[] {
  const groups = new Map<string, string[]>();
  for (const m of missing) {
    const words = FORECAST_MISSING_WORDS[m.reason];
    groups.set(words, [...(groups.get(words) ?? []), m.name]);
  }
  return [...groups].map(([reason, names]) => ({ reason, names }));
}

/* The assumptions draft (C) ---------------------------------------------------------------------- */

export const SERIES_LABELS: Record<ProjectionSeries, string> = {
  rent: "שכירות",
  tax: "מס נכס",
  insurance: "ביטוח",
  hoa: "HOA",
  other: "עלויות אחרות",
  appreciation: "עליית ערך",
};

const SERIES_KEYS = {
  rent: "rent_growth_bp",
  tax: "tax_growth_bp",
  insurance: "insurance_growth_bp",
  hoa: "hoa_growth_bp",
  other: "other_growth_bp",
  appreciation: "appreciation_bp",
} as const satisfies Record<ProjectionSeries, keyof ProjectionConfig>;

const SERIES_DEFAULTS: Record<ProjectionSeries, number> = {
  rent: PROJECTION_DEFAULTS.rentGrowthBp,
  tax: PROJECTION_DEFAULTS.taxGrowthBp,
  insurance: PROJECTION_DEFAULTS.insuranceGrowthBp,
  hoa: PROJECTION_DEFAULTS.hoaGrowthBp,
  other: PROJECTION_DEFAULTS.otherGrowthBp,
  appreciation: PROJECTION_DEFAULTS.appreciationBp,
};

/** The sheet's draft: every number as typed, a year's own change by series and year ("" for none). */
export type ForecastDraft = {
  growth: Record<ProjectionSeries, string>;
  byYear: Record<ProjectionSeries, string[]>;
  maintenance: string;
  capex: string;
  stayMonths: number;
  emptyMonths: string;
  turnoverCost: string;
  rate: string;
  categoryTypes: Record<string, string>;
};

function percentRaw(bp: number): string {
  return String(Number((bp / 100).toFixed(2)));
}

export function forecastDraft(p: ProjectionConfig | undefined): ForecastDraft {
  const cfg = p ?? {};
  const growth = {} as Record<ProjectionSeries, string>;
  const byYear = {} as Record<ProjectionSeries, string[]>;
  for (const s of PROJECTION_SERIES) {
    growth[s] = percentRaw(cfg[SERIES_KEYS[s]] ?? SERIES_DEFAULTS[s]);
    byYear[s] = Array.from({ length: 10 }, (_, i) => {
      const bp = cfg.by_year?.[s]?.[String(i + 1)];
      return bp == null ? "" : percentRaw(bp);
    });
  }
  return {
    growth,
    byYear,
    maintenance: percentRaw(cfg.maintenance_bp ?? PROJECTION_DEFAULTS.maintenanceBp),
    capex: percentRaw(cfg.capex_bp ?? PROJECTION_DEFAULTS.capexBp),
    stayMonths: cfg.stay_months ?? PROJECTION_DEFAULTS.stayMonths,
    emptyMonths: String((cfg.empty_months_tenths ?? PROJECTION_DEFAULTS.emptyMonthsTenths) / 10),
    turnoverCost: String((cfg.turnover_cost_minor ?? PROJECTION_DEFAULTS.turnoverCostMinor) / 100),
    rate: cfg.rate_ppm == null ? "" : String(Number((cfg.rate_ppm / 10_000).toFixed(3))),
    categoryTypes: { ...(cfg.category_types ?? {}) },
  };
}

/** A signed percent with up to two decimals in basis points, within [min, max]; null when it is not. */
export function signedBp(raw: string, min: number, max: number): number | null {
  const clean = raw.trim();
  if (!/^-?\d{1,3}(\.\d{1,2})?$/.test(clean)) return null;
  const bp = Math.round(Number(clean) * 100);
  return bp >= min && bp <= max ? bp : null;
}

/**
 * The draft as the setting's projection part: only what differs from a default (null when nothing does), or the
 * name of the first field that is not valid.
 */
export function projectionFromDraft(d: ForecastDraft): { projection: ProjectionConfig | null } | { invalid: string } {
  const out: Record<string, unknown> = {};
  const byYear: Record<string, Record<string, number>> = {};
  for (const s of PROJECTION_SERIES) {
    const bp = signedBp(d.growth[s], -2000, 3000);
    if (bp == null) return { invalid: SERIES_LABELS[s] };
    if (bp !== SERIES_DEFAULTS[s]) out[SERIES_KEYS[s]] = bp;
    for (let i = 0; i < 10; i++) {
      const raw = d.byYear[s][i] ?? "";
      if (raw.trim() === "") continue;
      const y = signedBp(raw, -2000, 3000);
      if (y == null) return { invalid: `${SERIES_LABELS[s]} בשנה ${String(i + 1)}` };
      (byYear[s] ??= {})[String(i + 1)] = y;
    }
  }
  if (Object.keys(byYear).length > 0) out.by_year = byYear;
  const maintenance = signedBp(d.maintenance, 0, 3000);
  if (maintenance == null) return { invalid: "תחזוקה" };
  if (maintenance !== PROJECTION_DEFAULTS.maintenanceBp) out.maintenance_bp = maintenance;
  const capex = signedBp(d.capex, 0, 3000);
  if (capex == null) return { invalid: "רזרבה ל־CapEx" };
  if (capex !== PROJECTION_DEFAULTS.capexBp) out.capex_bp = capex;
  if (d.stayMonths !== PROJECTION_DEFAULTS.stayMonths) out.stay_months = d.stayMonths;
  const empty = /^\d{1,2}(\.\d)?$/.test(d.emptyMonths.trim()) ? Math.round(Number(d.emptyMonths) * 10) : null;
  if (empty == null || empty > 120) return { invalid: "חודשים ריקים" };
  if (empty !== PROJECTION_DEFAULTS.emptyMonthsTenths) out.empty_months_tenths = empty;
  const cost = /^\d{1,6}(\.\d{1,2})?$/.test(d.turnoverCost.trim()) ? Math.round(Number(d.turnoverCost) * 100) : null;
  if (cost == null || cost > 10_000_000) return { invalid: "עלות תחלופה" };
  if (cost !== PROJECTION_DEFAULTS.turnoverCostMinor) out.turnover_cost_minor = cost;
  if (d.rate.trim() !== "") {
    const rate = /^\d{1,2}(\.\d{1,3})?$/.test(d.rate.trim()) ? Math.round(Number(d.rate) * 10_000) : null;
    if (rate == null || rate > 300_000) return { invalid: "ריבית" };
    out.rate_ppm = rate;
  }
  const types = Object.fromEntries(Object.entries(d.categoryTypes).filter(([, t]) => t !== ""));
  if (Object.keys(types).length > 0) out.category_types = types;
  return { projection: Object.keys(out).length === 0 ? null : (out) };
}

/** A property's row under לפי נכס: its value and balance in year N, and its cash out. */
export function forecastPropertyHint(p: PropertyProjection, r: ProjectionResult): string {
  const last = p.years[p.years.length - 1];
  const currency = r.currency ?? "USD";
  if (last == null) return "";
  return `שווי ${formatMoney(last.valueMinor, currency)} · יתרה ${formatMoney(last.balanceMinor, currency)}${p.refi.refinances ? "" : " · לא משתלם למחזר"}`;
}

/** The projection's keys the assumptions sheet doesn't show: the refinance's years, LTV, closing and term. */
const HIDDEN_KEYS = ["years", "ltv_bp", "closing_bp", "term_years"] as const;

/** What the sheet saves: its own keys over the ones it doesn't show, kept as they were. */
export function withHidden(before: ProjectionConfig | undefined, edited: ProjectionConfig | null): ProjectionConfig | null {
  const kept: ProjectionConfig = {};
  for (const k of HIDDEN_KEYS) if (before?.[k] !== undefined) Object.assign(kept, { [k]: before[k] });
  if (edited == null && Object.keys(kept).length === 0) return null;
  return { ...kept, ...(edited ?? {}) };
}
