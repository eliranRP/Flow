import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { birchLaneInvestment } from "../dev/investment-sample";
import { project as sampleProject } from "../dev/project-cash-sample";
import {
  birchLaneReturnLines,
  birchLaneReturns,
  birchLaneReturnsAnnualized,
  birchLaneReturnsBeforeRent,
  birchLaneReturnsCashOut,
  birchLaneReturnsMissing,
  birchLaneReturnsNegative,
  birchLaneRehab,
  birchLaneRehabMany,
  birchLaneReturnsNoRehab,
  mapleCourtSub2Returns,
} from "../dev/returns-sample";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { ProjectInvestmentScreen } from "./project-investment-screen";
import { UNITS_HOLD, editVerdict } from "./project-investment-sheets";
import { barShares, partialLine } from "./project-returns-cards";
import { bracketText, dscrText, percentText, toPropertyReturns, toReturnLinesPage } from "./project-returns-data";
import { PropertyMetricScreen, PropertyPartScreen, REHAB_EMPTY } from "./project-returns-detail-screen";
import {
  BEFORE_FIRST_RENT,
  CASH_FLOW_CAPTION,
  HISTORY_HINT,
  INFINITY_NAME,
  METRIC_KEYS,
  MISSING_HISTORY,
  MONEY_IN_BODY,
  PART_KEYS,
  TAKEN_OVER_LABEL,
  TAX_CAPTION,
  UNITS_DEFAULT_HINT,
  buildingFormula,
  cashFlowFormula,
  forcedFormula,
  metricCaption,
  metricPage,
  metricValue,
  NO_PAYMENTS,
  returnInfo,
  type Formula,
  type FormulaRow,
  type InfoKey,
} from "./project-returns-info";
import { INFO_LEARN, LEARN, LEARN_ENGLISH, LEARN_TITLES, PAGE_LEARN } from "./project-returns-learn";
import { signedRow } from "./project-returns-parts";
import { PropertyReturnLineScreen, PropertyStatementScreen } from "./project-returns-screen";
import { BRACKET_RANGE, bracketVerdict, rawToBp } from "./project-returns-sheets";
import { toReturnsJson } from "./project-returns-test-support";

type Call = { name: string; args: unknown };
const rpc = vi.hoisted(() => ({
  calls: [] as Call[],
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string; code?: string } | null }> => Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
  }),
}));

afterEach(() => {
  rpc.calls = [];
  rpc.impl = () => Promise.resolve({ data: null, error: null });
});

/** get_property_return_lines as the server sends it, from a sample page. */
function linesJson(line: Parameters<typeof birchLaneReturnLines>[0]) {
  const page = birchLaneReturnLines(line);
  return {
    line,
    currency: page.currency,
    from: "2025-11-02",
    to: "2026-11-01",
    total_minor: Number(page.totalMinor),
    count: page.count,
    has_more: page.hasMore,
    rows: page.rows.map((row) => ({
      transaction_id: row.transactionId,
      description: row.description,
      supplier_name: row.supplierName,
      category_id: row.categoryId,
      category_name: row.categoryName,
      date: row.date,
      amount_minor: Number(row.minor),
      parts: row.parts,
      shared: row.shared,
    })),
  };
}

function serve(returns = birchLaneReturns) {
  rpc.impl = (name, args) => {
    if (name === "get_property_returns") return Promise.resolve({ data: toReturnsJson(returns), error: null });
    if (name === "get_property_return_lines") return Promise.resolve({ data: linesJson((args as { p_line: "opex" }).p_line), error: null });
    if (name === "set_tax_bracket") return Promise.resolve({ data: { id: "c1", tax_bracket_bp: 2400, prior: null }, error: null });
    return Promise.resolve({ data: null, error: null });
  };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderAt(entry: string, viewer = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const routes = (
    <Routes>
            <Route path="/projects/:projectId/investment/returns" element={<PropertyStatementScreen />} />
            <Route path="/projects/:projectId/investment/returns/:line" element={<PropertyReturnLineScreen />} />
            <Route path="/projects/:projectId/investment/metric/:metric" element={<PropertyMetricScreen />} />
            <Route path="/projects/:projectId/investment/part/:part" element={<PropertyPartScreen />} />
            <Route path="/projects/:projectId/investment" element={<Where />} />
    </Routes>
  );
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>{viewer ? <ViewerPreview>{routes}</ViewerPreview> : routes}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function renderInvestment(returns = birchLaneReturns, entry = "/projects/p1/investment") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/projects/:projectId/investment" element={<ProjectInvestmentScreen sample={sampleProject} sampleInvestment={birchLaneInvestment} sampleReturns={returns} today="2026-10-17" />} />
            <Route path="*" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const INFO_KEYS: readonly InfoKey[] = ["cash_flow", "principal", "appreciation", "tax", "equity_today", "forced", "money_in"];

/** Whether the rows before "=" add up to it. A formula with ÷ or ×, or a missing figure, is not checked. */
function addsUp(formula: Formula): boolean {
  const result = formula.result?.value;
  if (result?.kind !== "money") return true;
  let sum = 0n;
  for (const row of formula.rows) {
    if (row.op === "÷" || row.op === "×" || row.value.kind !== "money") return true;
    sum += row.value.minor;
  }
  return sum === result.minor;
}

function sumOf(rows: readonly FormulaRow[]): bigint {
  return rows.reduce((sum, row) => sum + (row.value.kind === "money" ? row.value.minor : 0n), 0n);
}

describe("the returns read", () => {
  it("maps get_property_returns to typed figures, minor units as bigint", () => {
    const parsed = toPropertyReturns(toReturnsJson(birchLaneReturns));
    expect(parsed).toEqual(birchLaneReturns);
    expect(typeof parsed.statement.cashFlowMinor).toBe("bigint");
  });

  it("reads the period's lines before the first rent and the kept-out lines from their server lines", () => {
    const json = toReturnsJson(birchLaneReturns);
    const statement = {
      ...(json.statement as object),
      lines: { holding: { amount_minor: -100_000, lines: 2 }, renovation: { amount_minor: -500_000, lines: 3 }, financing: { amount_minor: 900_000, lines: 1 } },
      by_category: {
        holding: [{ category_id: "c-int", name: "ריבית", amount_minor: -100_000, lines: 2 }],
        renovation: [{ category_id: "c-mat", name: "חומרים", amount_minor: -500_000, lines: 3 }],
      },
    };
    const parsed = toPropertyReturns({ ...json, statement });
    expect(parsed.statement.counts.before_rent).toBe(5);
    expect(parsed.statement.counts.not_counted).toBe(1);
    expect(parsed.statement.byCategory.before_rent.map((item) => item.id)).toEqual(["c-mat", "c-int"]);
  });

  it("keeps only the inputs it knows as missing, and reads absent lines as none", () => {
    const json = toReturnsJson(birchLaneReturnsMissing);
    const parsed = toPropertyReturns({ ...json, missing: [...birchLaneReturnsMissing.missing, "something_new"], statement: { ...(json.statement as object), lines: {}, by_category: {} } });
    expect(parsed.missing).toEqual(["value_history", "land", "tax_bracket"]);
    expect(parsed.statement.counts.opex).toBe(0);
    expect(parsed.statement.byCategory.capex).toEqual([]);
  });

  it("reads one unit by default, and the loans taken over at closing", () => {
    const json = toReturnsJson(mapleCourtSub2Returns);
    const parsed = toPropertyReturns(json);
    expect(parsed.inputs).toMatchObject({ units: 1, unitsDefault: true, takenOverMinor: 29_000_000n });
    expect(parsed.inputs.takenOverLoans).toEqual([{ id: "loan-maple", name: "Maple Street Mortgage", minor: 29_000_000n, closingPaidMinor: null, countedMinor: 29_000_000n }]);
    const inputs = { ...(json.inputs as object), units: null, units_default: undefined, taken_over_minor: undefined, taken_over_loans: undefined };
    expect(toPropertyReturns({ ...json, inputs }).inputs).toMatchObject({ units: 1, unitsDefault: false, takenOverMinor: 0n, takenOverLoans: [] });
  });

  it("maps a page of lines, signed as in the statement", () => {
    const page = toReturnLinesPage(linesJson("opex"));
    expect(page.count).toBe(23);
    expect(page.hasMore).toBe(true);
    expect(page.rows[0]).toMatchObject({ transactionId: "t-plumb", minor: -45_000n, categoryName: "קבלני משנה", source: null });
  });

  it("writes percents, DSCR and the bracket as text, with U+2212", () => {
    expect(percentText(1157)).toBe("11.6%");
    expect(percentText(-937)).toBe("−9.4%");
    expect(dscrText(1625)).toBe("1.63");
    expect(bracketText(2400)).toBe("24%");
    expect(bracketText(2450)).toBe("24.5%");
  });
});

describe("the sample figures add up", () => {
  it("in every sheet whose parts are added", () => {
    for (const sample of [birchLaneReturns, birchLaneReturnsNegative, birchLaneReturnsCashOut, mapleCourtSub2Returns, birchLaneReturnsBeforeRent]) {
      for (const key of INFO_KEYS) {
        const info = returnInfo(key, sample);
        expect(addsUp(info.formula), key).toBe(true);
      }
      expect(addsUp(buildingFormula(sample))).toBe(true);
    }
    const cash = returnInfo("cash_flow", birchLaneReturns).formula;
    expect(sumOf(cash.rows)).toBe(birchLaneReturns.statement.cashFlowMinor);
  });

  it("in the statement and the total", () => {
    for (const r of [birchLaneReturns, birchLaneReturnsNegative, birchLaneReturnsCashOut, mapleCourtSub2Returns, birchLaneReturnsBeforeRent]) {
      const st = r.statement;
      expect(st.incomeMinor + st.opexMinor).toBe(st.noiMinor);
      expect(st.noiMinor + st.debtServiceMinor + st.capexMinor).toBe(st.cashFlowMinor);
      const sums = { income: st.incomeMinor, opex: st.opexMinor, debt_service: st.debtServiceMinor, capex: st.capexMinor, before_rent: st.beforeRentMinor, not_counted: st.notCountedMinor };
      for (const line of ["income", "opex", "debt_service", "capex", "before_rent", "not_counted"] as const) {
        const categories = st.byCategory[line];
        expect(categories.reduce((sum, item) => sum + item.minor, 0n)).toBe(sums[line]);
        expect(categories.reduce((sum, item) => sum + item.count, 0)).toBe(line === "debt_service" ? st.counts[line] * 2 : st.counts[line]);
      }
      const s = r.sources;
      expect(s.cashFlowMinor + s.principalMinor + (s.appreciationMinor ?? 0n) + (s.taxSavingsMinor ?? 0n)).toBe(s.totalMinor);
    }
  });

  it("in the tax savings: the building over 27.5 years at the bracket", () => {
    for (const { sources, inputs } of [birchLaneReturns, mapleCourtSub2Returns]) {
      expect(sources.buildingMinor).toBe((inputs.purchaseMinor ?? 0n) + (inputs.rehabMinor ?? 0n) - (inputs.landMinor ?? 0n));
      expect(Math.round((Number(sources.buildingMinor) * 10) / 275)).toBe(Number(sources.depreciationYearMinor));
      expect(Math.round((Number(sources.buildingMinor) * 10 * 2400) / (275 * 10_000))).toBe(Number(sources.taxSavingsMinor));
    }
  });

  it("splits the bar by the positive parts only", () => {
    expect(barShares([{ value: { kind: "money", minor: 300n } }, { value: { kind: "money", minor: -100n } }, { value: { kind: "money", minor: 100n } }])).toEqual([75, 0, 25]);
  });
});

describe("the sheet contents", () => {
  it("names the tax savings' parts with their operators and the caption", () => {
    const info = returnInfo("tax", birchLaneReturns);
    expect(info.formula.rows.map((row) => `${row.op}${row.label}`)).toEqual(["עלות הבניין", "÷פחת בשנה", "×מדרגת המס"]);
    expect(info.formula.rows[0]?.target).toEqual({ kind: "part", part: "building" });
    expect(info.formula.rows[2]?.target).toEqual({ kind: "edit", field: "tax_bracket" });
    expect(info.caption).toBe(TAX_CAPTION);
  });

  it("shows one sign per figure: a cost taken away reads − and its size", () => {
    const signed = cashFlowFormula(birchLaneReturns).rows.map(signedRow);
    expect(signed.map((row) => row.op)).toEqual(["", "−", "−", "−"]);
    for (const row of signed.slice(1)) expect(row.value.kind === "money" && row.value.minor > 0n).toBe(true);
    // A refund that adds back reads +, and the first row keeps its own sign.
    expect(signedRow({ key: "x", op: "−", label: "x", value: { kind: "money", minor: 500n } })).toEqual({ op: "+", value: { kind: "money", minor: 500n } });
    expect(signedRow({ key: "x", op: "", label: "x", value: { kind: "money", minor: -500n } })).toEqual({ op: "", value: { kind: "money", minor: -500n } });
    expect(signedRow({ key: "x", op: "÷", label: "x", value: { kind: "money", minor: -500n } }).op).toBe("÷");
  });

  it("asks for the missing input, and says a second value is missing with no button", () => {
    const tax = returnInfo("tax", birchLaneReturnsMissing).formula;
    expect(tax.rows[0]?.value).toEqual({ kind: "missing", add: "land", note: undefined });
    expect(tax.rows[2]?.value).toEqual({ kind: "missing", add: "tax_bracket", note: undefined });
    const appreciation = returnInfo("appreciation", birchLaneReturnsMissing).formula;
    expect(appreciation.rows[1]?.value).toEqual({ kind: "missing", add: null, note: MISSING_HISTORY });
  });

  it("builds the money in the deal from its four parts, which add up to it, each opening its lines", () => {
    for (const sample of [birchLaneReturns, birchLaneReturnsCashOut]) {
      const info = returnInfo("money_in", sample);
      expect(info.body).toBe(MONEY_IN_BODY);
      expect(info.formula.rows.map((row) => `${row.op}${row.label}`)).toEqual(["רכישה וסגירה", "+שיפוץ לפני השכרה", "+עלויות החזקה", "−תקבולי הלוואות והחזרים"]);
      expect(info.formula.rows.map((row) => row.target)).toEqual(["acquisition", "renovation", "holding", "financing"].map((line) => ({ kind: "line", line })));
      expect(sumOf(info.formula.rows)).toBe(sample.equity.moneyInMinor);
    }
    const rows = returnInfo("money_in", birchLaneReturnsCashOut).formula.rows;
    expect(rows[2]).toMatchObject({ hint: "עד השכר הראשון ב־01/04/2026", value: { kind: "money", minor: 580_000n } });
    expect(rows[3]).toMatchObject({ hint: "נטו, אחרי עלויות ההלוואה", value: { kind: "money", minor: -28_030_000n } });
    expect(returnInfo("money_in", { ...birchLaneReturns, firstRent: null }).formula.rows[2]?.hint).toBe("עדיין לפני השכר הראשון");
  });

  it("opens the typed purchase's sheet when there are no purchase lines", () => {
    const typed = { ...birchLaneReturns, inputs: { ...birchLaneReturns.inputs, purchaseSource: "typed" as const } };
    expect(returnInfo("money_in", typed).formula.rows[0]?.target).toEqual({ kind: "edit", field: "purchase" });
    expect(forcedFormula(typed).rows[1]).toMatchObject({ label: "מחיר רכישה", target: { kind: "edit", field: "purchase" } });
    expect(forcedFormula(birchLaneReturns).rows[1]).toMatchObject({ label: "מחיר רכישה (מהתנועות)", target: { kind: "line", line: "acquisition" } });
    expect(buildingFormula(birchLaneReturns).rows[0]).toMatchObject({ label: "מחיר רכישה (מהתנועות)", target: { kind: "line", line: "acquisition" } });
  });

  it("splits a Sub2 purchase into the cash lines and the loan taken over, which add up to the price", () => {
    const price = mapleCourtSub2Returns.inputs.purchaseMinor ?? 0n;
    const building = buildingFormula(mapleCourtSub2Returns).rows;
    expect(building.slice(0, 2).map((row) => `${row.op}${row.label}`)).toEqual(["רכישה וסגירה (מהתנועות)", `+${TAKEN_OVER_LABEL}`]);
    expect(sumOf(building.slice(0, 2))).toBe(price);
    expect(building[0]).toMatchObject({ value: { kind: "money", minor: 4_160_000n }, target: { kind: "line", line: "acquisition" } });
    expect(building[1]).toMatchObject({ hint: "Maple Street Mortgage", target: { kind: "loans", loanId: "loan-maple" } });
    const forced = forcedFormula(mapleCourtSub2Returns).rows;
    expect(forced.map((row) => `${row.op}${row.key}`)).toEqual(["arv", "−purchase", "−taken-over", "−rehab"]);
    expect(-sumOf(forced.slice(1, 3))).toBe(price);
    // Several loans taken over: their names joined, and the row opens the loans list.
    const two = {
      ...mapleCourtSub2Returns,
      inputs: {
        ...mapleCourtSub2Returns.inputs,
        takenOverLoans: [
          { id: "l1", name: "Maple Street Mortgage", minor: 25_000_000n, closingPaidMinor: null, countedMinor: 25_000_000n },
          { id: "l2", name: "Oak Bridge Lending", minor: 4_000_000n, closingPaidMinor: null, countedMinor: 4_000_000n },
        ],
      },
    };
    expect(buildingFormula(two).rows[1]).toMatchObject({ hint: "Maple Street Mortgage, Oak Bridge Lending", target: { kind: "loans" } });
    expect(buildingFormula(two).rows[1]?.target).not.toHaveProperty("loanId");
    // The money in stays cash only: no loan row.
    expect(returnInfo("money_in", mapleCourtSub2Returns).formula.rows.map((row) => row.key)).toEqual(["acquisition", "renovation", "holding", "financing"]);
  });

  it("reads לפני השכר הראשון for the per-cent metrics before the first rent, with no result row", () => {
    for (const metric of ["coc", "cap-rate"] as const) {
      const page = metricPage(metric, birchLaneReturnsBeforeRent);
      expect(page.value).toEqual({ kind: "note", text: BEFORE_FIRST_RENT });
      expect(page.result).toBeNull();
    }
    expect(metricValue("dscr", birchLaneReturnsBeforeRent)).toEqual({ kind: "text", text: NO_PAYMENTS });
    expect(metricValue("per-unit", birchLaneReturnsBeforeRent)).toEqual({ kind: "money", minor: 0n, income: false });
    expect(metricValue("coc", birchLaneReturns)).toEqual({ kind: "text", text: "11.6%" });
  });

  it("says the cash flow counts from the first rent", () => {
    expect(returnInfo("cash_flow", birchLaneReturns).caption).toBe(CASH_FLOW_CAPTION);
  });

  it("reads ∞ for cash-on-cash when all the cash came out, with no division", () => {
    expect(metricValue("coc", birchLaneReturnsCashOut)).toEqual({ kind: "text", text: "∞" });
    const page = metricPage("coc", birchLaneReturnsCashOut);
    expect(page.cashOut).toBe(3_000_000n);
    expect(page.result).toBeNull();
    expect(page.sections.map((section) => section.key)).toEqual(["cash", "money-in"]);
  });

  it("divides the cash flow per unit by the default one unit, which says so", () => {
    const page = metricPage("per-unit", birchLaneReturnsMissing);
    expect(page.value).toEqual({ kind: "money", minor: 35_000n, income: false });
    expect(page.caption).toBe("בחודש · תזרים ÷ 1 יחידה ÷ 12 · 12 חודשים");
    expect(page.sections[1]?.formula.rows[0]).toMatchObject({ hint: UNITS_DEFAULT_HINT, value: { kind: "text", text: "1" } });
    expect(page.result?.text).toBe("\u2066$4,200 ÷ 1 ÷ 12\u2069");
    expect(metricPage("coc", birchLaneReturns).result?.text).toBe("\u2066$4,200 ÷ $36,300\u2069");
  });
});

describe("the edit and tax inputs", () => {
  it("saves units as a whole number from 1 to 9999", () => {
    expect(editVerdict("units", { minor: null, date: null }, { raw: "3", date: "2026-11-01", dateTouched: false })).toEqual({ kind: "save", patch: { units: 3 } });
    expect(editVerdict("units", { minor: 2n, date: null }, { raw: "0", date: "2026-11-01", dateTouched: false })).toEqual({ kind: "hold", message: UNITS_HOLD });
    expect(editVerdict("land", { minor: null, date: null }, { raw: "46300", date: "2026-11-01", dateTouched: false })).toEqual({ kind: "save", patch: { land_minor: 4_630_000 } });
  });

  it("reads the bracket as basis points, up to two decimals, at most 100", () => {
    expect(rawToBp("24")).toBe(2400);
    expect(rawToBp("24.75")).toBe(2475);
    expect(bracketVerdict(null, "24")).toEqual({ kind: "save", bp: 2400 });
    expect(bracketVerdict(2400, "24")).toEqual({ kind: "clean" });
    expect(bracketVerdict(null, "120")).toEqual({ kind: "hold", message: BRACKET_RANGE });
  });
});

describe("the investment page's returns cards", () => {
  it("opens the ⓘ sheet of the tax savings with its parts", async () => {
    renderInvestment();
    fireEvent.click(await screen.findByRole("button", { name: "איך מחושב: חיסכון מס" }));
    const dialog = await screen.findByRole("dialog", { name: "חיסכון מס" });
    expect(within(dialog).getByRole("link", { name: /עלות הבניין/ })).toHaveAttribute("href", "/projects/p1/investment/part/building");
    expect(within(dialog).getByText(TAX_CAPTION)).toBeInTheDocument();
    expect(within(dialog).getByText("24%")).toBeInTheDocument();
    // FLOW-462: the sheet ends with how to read the figure.
    expect(within(dialog).getByText(LEARN.tax.goal)).toBeInTheDocument();
    expect(within(dialog).getByText("\u2066Tax savings (depreciation)\u2069")).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole("button", { name: /מדרגת המס/ }));
    expect(await screen.findByRole("dialog", { name: "מדרגת המס" })).toBeInTheDocument();
  });

  it("reads חסר with הוספה for a missing input, and חסר · עדכון שווי נוסף with no button", async () => {
    renderInvestment(birchLaneReturnsMissing);
    const card = (await screen.findByRole("heading", { name: "תשואה כוללת · שנה" })).closest("section");
    if (card == null) throw new Error("no card");
    // FLOW-458: what is missing is on the hint line, and the total says it is partial.
    expect(within(card).getByText(`${MISSING_HISTORY}. ${HISTORY_HINT}`)).toBeInTheDocument();
    expect(within(card).getByText("חסר · שווי הקרקע")).toBeInTheDocument();
    expect(card.querySelector(".ui-ret-total")).toHaveTextContent("חלקי · חסרים עליית ערך וחיסכון מס");
    expect(within(card).getAllByRole("button", { name: /^הוספה/ })).toHaveLength(1);
    fireEvent.click(within(card).getByRole("button", { name: "הוספה: שווי הקרקע" }));
    // The tax savings need the land first.
    expect(await screen.findByRole("dialog", { name: "שווי הקרקע" })).toBeInTheDocument();
  });

  it("adds land to the property's figures, and shows the default one unit, still editable", async () => {
    renderInvestment(birchLaneReturnsMissing);
    const card = await screen.findByRole("region", { name: "נתוני הנכס" });
    // FLOW-457: a row and its sheet use one name.
    const units = within(card).getByRole("button", { name: /^מספר יחידות/ });
    expect(units).toHaveTextContent(`מספר יחידות${UNITS_DEFAULT_HINT}1`);
    fireEvent.click(within(card).getByRole("button", { name: /^שווי הקרקע/ }));
    expect(await screen.findByRole("dialog", { name: "שווי הקרקע" })).toBeInTheDocument();
  });

  it("opens a figure's sheet from an edit link", async () => {
    renderInvestment(birchLaneReturns, "/projects/p1/investment?edit=units");
    expect(await screen.findByRole("dialog", { name: "מספר יחידות" })).toBeInTheDocument();
  });

  it("draws ∞ on the total return when all the cash came out, with each source's amount and no per cent", async () => {
    renderInvestment(birchLaneReturnsCashOut);
    const card = (await screen.findByRole("heading", { name: "תשואה כוללת · שנה" })).closest("section");
    if (card == null) throw new Error("no card");
    expect(within(card).getByRole("img", { name: INFINITY_NAME })).toHaveTextContent("∞");
    expect(within(card).getByText(/כל הכסף חזר/)).toHaveTextContent("כל הכסף חזר · יצא $30,000 יותר משנכנס");
    expect(within(card).getByText("$82,000")).toBeInTheDocument();
    expect(within(card).queryByText(/%$/)).toBeNull();
    const metrics = await screen.findByRole("region", { name: "מדדים" });
    expect(within(metrics).getByRole("link", { name: /תשואה על המזומן/ })).toHaveTextContent("∞");
  });

  it("opens the purchase from the lines on its line page, with no edit sheet", async () => {
    renderInvestment();
    const card = await screen.findByRole("region", { name: "נתוני הנכס" });
    const row = within(card).getByRole("link", { name: /מחיר רכישה/ });
    expect(row).toHaveAttribute("href", "/projects/p1/investment/returns/acquisition");
    expect(row).toHaveTextContent("מהתנועות · לפירוט ולתיקון");
    expect(row).toHaveClass("m-press");
    expect(within(card).queryByRole("button", { name: /מחיר רכישה/ })).toBeNull();
  });

  it("keeps each source's amount in one track, and what is missing on the hint line", async () => {
    renderInvestment(birchLaneReturnsMissing);
    const card = (await screen.findByRole("heading", { name: "תשואה כוללת · שנה" })).closest("section");
    if (card == null) throw new Error("no card");
    const rows = [...card.querySelectorAll(".ui-ret-sources > .ui-ret-source")];
    expect(rows).toHaveLength(4);
    const cell = (label: string, selector: string) => {
      const row = rows.find((item) => item.querySelector(".ui-ret-source-label")?.textContent === label);
      return row?.querySelector(selector) ?? null;
    };
    // FLOW-458: an amount and nothing beside it (the per-cent of the money in is gone).
    expect(cell("תזרים", ".ui-ret-source-value")).toHaveTextContent("$4,200");
    expect(card.querySelector(".ui-ret-source-share")).toBeNull();
    // A missing source: הוספה (when an input adds it) in the amount track, the reason on its own line.
    expect(cell("עליית ערך", ".ui-ret-source-value")).toBeEmptyDOMElement();
    expect(cell("עליית ערך", ":scope > .ui-ret-source-hint")).toHaveTextContent(MISSING_HISTORY);
    expect(cell("חיסכון מס", ".ui-ret-source-value")).toHaveTextContent("הוספה");
    expect(cell("חיסכון מס", ":scope > .ui-ret-source-hint")).toHaveTextContent("חסר · שווי הקרקע");
  });

  it("says a total that leaves a source out is partial", () => {
    expect(partialLine([])).toBeNull();
    expect(partialLine(["חיסכון מס"])).toBe("חלקי · חסר חיסכון מס");
    expect(partialLine(["עליית ערך", "חיסכון מס"])).toBe("חלקי · חסרים עליית ערך וחיסכון מס");
  });

  it("reads לפני השכר הראשון in place of the per-cents before the first rent, and keeps the amounts", async () => {
    renderInvestment(birchLaneReturnsBeforeRent);
    const card = (await screen.findByRole("heading", { name: "תשואה כוללת · שנה" })).closest("section");
    if (card == null) throw new Error("no card");
    expect(card.querySelector(".ui-ret-total")).toHaveTextContent(BEFORE_FIRST_RENT);
    expect(within(card).queryByText(/%$/)).toBeNull();
    // Once, in the total's place: the source rows leave their per-cents empty.
    expect(within(card).getAllByText(BEFORE_FIRST_RENT)).toHaveLength(1);
    expect(within(card).getByText("$12,000")).toBeInTheDocument();
    const metrics = await screen.findByRole("region", { name: "מדדים" });
    expect(within(metrics).getByRole("link", { name: /תשואה על המזומן/ })).toHaveTextContent(BEFORE_FIRST_RENT);
    expect(within(metrics).getByRole("link", { name: /Cap rate/ })).toHaveTextContent(BEFORE_FIRST_RENT);
    expect(within(metrics).getByRole("link", { name: /כיסוי חוב/ })).toHaveTextContent(NO_PAYMENTS);
  });

  it("names the loan taken over in the purchase, on the figures card and in the השבחה ⓘ", async () => {
    renderInvestment(mapleCourtSub2Returns);
    const card = await screen.findByRole("region", { name: "נתוני הנכס" });
    const purchase = within(card).getByRole("link", { name: /מחיר רכישה/ });
    expect(purchase).toHaveTextContent("מהתנועות + הלוואה שנלקחה · לפירוט ולתיקון");
    expect(purchase).toHaveTextContent("$331,600");
    // FLOW-459: the equity row opens its sheet itself, with no ⓘ of its own.
    expect(screen.queryByRole("button", { name: "איך מחושב: השבחה צפויה" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /^השבחה צפויה/ }));
    const dialog = await screen.findByRole("dialog", { name: "השבחה צפויה" });
    expect(within(dialog).getByRole("link", { name: /רכישה וסגירה \(מהתנועות\)/ })).toHaveAttribute("href", "/projects/p1/investment/returns/acquisition");
    const loan = within(dialog).getByRole("link", { name: new RegExp(TAKEN_OVER_LABEL) });
    expect(loan).toHaveAttribute("href", "/loans/loan-maple");
    expect(loan).toHaveTextContent("Maple Street Mortgage");
  });

  it("opens each metric's page", async () => {
    renderInvestment();
    const card = await screen.findByRole("region", { name: "מדדים" });
    expect(within(card).getByRole("link", { name: /תשואה על המזומן/ })).toHaveAttribute("href", "/projects/p1/investment/metric/coc");
    expect(within(card).getByRole("link", { name: /כיסוי חוב/ })).toHaveTextContent("1.63");
  });
});

describe("the returns pages", () => {
  it("draws the statement, each line opening its page, and links to the categories", async () => {
    serve();
    renderAt("/projects/p1/investment/returns");
    expect(await screen.findByRole("link", { name: /הוצאות תפעול/ })).toHaveAttribute("href", "/projects/p1/investment/returns/opex");
    expect(screen.getByText("רווח תפעולי (NOI)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /לא נספר בתזרים/ })).toHaveAttribute("href", "/projects/p1/investment/returns/not_counted");
    expect(screen.getByRole("link", { name: "מה נספר איפה · לפי קטגוריה" })).toHaveAttribute("href", "/settings/categories");
  });

  it("lists a line's categories and its transactions, each opening the transaction", async () => {
    serve();
    renderAt("/projects/p1/investment/returns/opex");
    expect(await screen.findByRole("link", { name: /^ביטוח/ })).toHaveAttribute("href", "/projects/p1/investment/returns/opex?category=cat-insurance");
    expect(await screen.findByRole("link", { name: /Ace Plumbing LLC/ })).toHaveAttribute("href", "/transactions/t-plumb");
    expect(screen.getByRole("button", { name: "עוד 19 תנועות" })).toBeInTheDocument();
    const read = rpc.calls.find((call) => call.name === "get_property_return_lines");
    expect(read?.args).toMatchObject({ p_project_id: "p1", p_line: "opex", p_limit: 50, p_offset: 0 });
  });

  it("filters a line to one category", async () => {
    serve();
    renderAt("/projects/p1/investment/returns/opex?category=cat-insurance");
    await screen.findByRole("heading", { name: "ביטוח" });
    await waitFor(() => { expect(rpc.calls.some((call) => call.name === "get_property_return_lines")).toBe(true); });
    expect(rpc.calls.find((call) => call.name === "get_property_return_lines")?.args).toMatchObject({ p_category_id: "cat-insurance" });
  });

  it("draws a metric's parts and its result", async () => {
    serve();
    renderAt("/projects/p1/investment/metric/coc");
    expect(await screen.findByText("\u2066$4,200 ÷ $36,300\u2069")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /תקבולי הלוואות והחזרים/ })).toHaveAttribute("href", "/projects/p1/investment/returns/financing");
    expect(screen.getByRole("link", { name: /רכישה וסגירה/ })).toHaveAttribute("href", "/projects/p1/investment/returns/acquisition");
  });

  it("draws ∞ on cash-on-cash when all the cash came out", async () => {
    serve(birchLaneReturnsCashOut);
    renderAt("/projects/p1/investment/metric/coc");
    expect(await screen.findByText("∞")).toBeInTheDocument();
    expect(screen.getByText(/כל הכסף חזר · יצא/)).toHaveTextContent("כל הכסף חזר · יצא $30,000 יותר משנכנס");
  });

  it("lists the holding costs before the first rent apart, and starts the statement at the rent", async () => {
    serve();
    renderAt("/projects/p1/investment/returns");
    expect(await screen.findByRole("link", { name: /עלויות החזקה ושיפוץ לפני השכרה/ })).toHaveAttribute("href", "/projects/p1/investment/returns/before_rent");
    expect(screen.getByRole("link", { name: /לא נספר בתזרים/ })).toHaveTextContent("רכישה, סגירה ותקבולי הלוואות");
    expect(screen.getByText(/משכר ראשון ב־01\/04\/2026/)).toBeInTheDocument();
  });

  it("leaves the holding row out when nothing came before the rent", async () => {
    serve({ ...birchLaneReturns, statement: { ...birchLaneReturns.statement, beforeRentMinor: 0n, counts: { ...birchLaneReturns.statement.counts, before_rent: 0 }, byCategory: { ...birchLaneReturns.statement.byCategory, before_rent: [] } } });
    renderAt("/projects/p1/investment/returns");
    await screen.findByRole("link", { name: /לא נספר בתזרים/ });
    expect(screen.queryByRole("link", { name: /לפני השכרה/ })).toBeNull();
    // FLOW-457: a section of one row says so, and does not fold.
    const out = screen.getByRole("region", { name: "מחוץ לחישוב" });
    expect(out).toHaveTextContent("שורה אחת");
    expect(within(out).queryByRole("button")).toBeNull();
  });

  it("counts the calculation's rows as drawn, with their unit", async () => {
    serve();
    renderAt("/projects/p1/investment/returns");
    const calc = await screen.findByRole("region", { name: "החישוב" });
    expect(within(calc).getByRole("button", { name: /החישוב/ })).toHaveTextContent("6 שורות");
    expect(within(calc).getAllByRole("link")).toHaveLength(4);
    expect(within(screen.getByRole("region", { name: "מחוץ לחישוב" })).getByRole("button", { name: /מחוץ לחישוב/ })).toHaveTextContent("2 שורות");
  });

  it("reads a part of the money in since the purchase", async () => {
    serve();
    renderAt("/projects/p1/investment/returns/holding");
    expect(await screen.findByRole("heading", { name: "עלויות החזקה" })).toBeInTheDocument();
    expect((await screen.findAllByText(/מאז הקנייה/)).length).toBeGreaterThan(0);
    await waitFor(() => { expect(rpc.calls.some((call) => call.name === "get_property_return_lines")).toBe(true); });
    expect(rpc.calls.find((call) => call.name === "get_property_return_lines")?.args).toMatchObject({ p_line: "holding" });
  });

  it("lists the money in's transactions on its part page", async () => {
    serve();
    renderAt("/projects/p1/investment/part/money-in");
    expect(await screen.findByRole("link", { name: /עלויות החזקה/ })).toHaveAttribute("href", "/projects/p1/investment/returns/holding");
    await waitFor(() => { expect(rpc.calls.some((call) => call.name === "get_property_return_lines")).toBe(true); });
    expect(rpc.calls.find((call) => call.name === "get_property_return_lines")?.args).toMatchObject({ p_line: "money_in" });
  });

  it("sends an unknown metric back to the investment page", async () => {
    serve();
    renderAt("/projects/p1/investment/metric/irr");
    expect(await screen.findByTestId("where")).toHaveTextContent("/projects/p1/investment");
  });

  it("splits the Sub2 purchase on the building cost's page", async () => {
    serve(mapleCourtSub2Returns);
    renderAt("/projects/p1/investment/part/building");
    expect(await screen.findByRole("link", { name: /רכישה וסגירה \(מהתנועות\)/ })).toHaveAttribute("href", "/projects/p1/investment/returns/acquisition");
    expect(screen.getByRole("link", { name: new RegExp(TAKEN_OVER_LABEL) })).toHaveAttribute("href", "/loans/loan-maple");
  });

  it("leads the cash-on-cash page with לפני השכר הראשון before the first rent", async () => {
    serve(birchLaneReturnsBeforeRent);
    renderAt("/projects/p1/investment/metric/coc");
    expect((await screen.findAllByText(BEFORE_FIRST_RENT))[0]?.closest(".ui-ret-hero")).not.toBeNull();
    expect(screen.queryByText("התוצאה")).toBeNull();
  });

  it("draws a part with its rehab lines, all time", async () => {
    serve();
    renderAt("/projects/p1/investment/part/building");
    expect(await screen.findByRole("link", { name: /קרקע/ })).toHaveAttribute("href", "/projects/p1/investment?edit=land");
    await waitFor(() => { expect(rpc.calls.some((call) => call.name === "get_property_return_lines")).toBe(true); });
    expect(rpc.calls.find((call) => call.name === "get_property_return_lines")?.args).toMatchObject({ p_line: "rehab" });
  });

  it("shows a retry when the read fails", async () => {
    rpc.impl = () => Promise.resolve({ data: null, error: { message: "boom" } });
    renderAt("/projects/p1/investment/returns");
    expect(await screen.findByRole("button", { name: "נסו שוב" })).toBeInTheDocument();
  });
});

/** get_project with the renovation's categories, as the server sends them (FLOW-460). */
function projectJson(rehab: typeof birchLaneRehab, returns = birchLaneReturns) {
  return {
    id: "p1", name: "Birch Lane", status: "active", state_label: "rental", budget_agorot: null, income_agorot: 0, direct_agorot: 0, shared_agorot: 0, profit_agorot: 0,
    categories: [], transactions: [], is_overhead: false, loans: [],
    investment: {
      currency: "USD", purchase_minor: null, arv_minor: null, value_minor: null, value_date: null,
      rehab_minor: Number(returns.inputs.rehabMinor ?? 0n),
      rehab_other_currencies: [],
      rehab_by_category: rehab.map((row) => ({ category_id: row.id, name: row.name, hidden: false, amount_minor: Number(row.minor) })),
      loan_balance_minor: 0, loan_balance_other_currencies: [], forced_equity_minor: null, current_equity_minor: null,
    },
  };
}

function serveRehab(rehab: typeof birchLaneRehab, returns = birchLaneReturns) {
  serve(returns);
  const lines = rpc.impl;
  rpc.impl = (name, args) => (name === "get_project" ? Promise.resolve({ data: projectJson(rehab, returns), error: null }) : lines(name, args));
}

describe("the renovation's page (FLOW-460)", () => {
  it("adds its categories up to the figure, each opening its lines, then its transactions", async () => {
    serveRehab(birchLaneRehab);
    renderAt("/projects/p1/investment/part/rehab");
    const calc = within(await screen.findByRole("list", { name: "שיפוץ עד היום" }));
    const links = calc.getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(birchLaneRehab.map((row) => `/projects/p1/investment/returns/rehab?category=${String(row.id)}`));
    expect(links[0]).toHaveTextContent("שיפוץ והשבחה$56,000");
    const sum = birchLaneRehab.reduce((total, row) => total + row.minor, 0n);
    expect(sum).toBe(birchLaneReturns.inputs.rehabMinor);
    const result = calc.getAllByRole("listitem").at(-1);
    expect(result?.querySelector(".ui-ret-result")).toHaveTextContent("=שיפוץ עד היום$61,300");
    expect(document.querySelector(".ui-ret-hero")).toHaveTextContent("$61,300");
    expect(screen.getByText("כל הוצאות הנכס שנספרות בשיפוץ, מאז הקנייה.")).toBeInTheDocument();
    expect(screen.getByText(/מאז הקנייה · Birch Lane/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "מה לא נספר? לפי קטגוריה" })).toHaveAttribute("href", "/settings/categories");
    expect(await screen.findByRole("link", { name: /Lone Star Roofing/ })).toHaveAttribute("href", "/transactions/t-roof");
    expect(rpc.calls.find((call) => call.name === "get_property_return_lines")?.args).toMatchObject({ p_line: "rehab" });
  });

  it("shows five categories, then עוד N קטגוריות with the rest's sum, which opens them in place", async () => {
    serveRehab(birchLaneRehabMany);
    renderAt("/projects/p1/investment/part/rehab");
    const more = await screen.findByRole("button", { name: /עוד 2 קטגוריות/ });
    expect(more).toHaveTextContent("$2,000");
    const calc = within(screen.getByRole("list", { name: "שיפוץ עד היום" }));
    expect(calc.getAllByRole("link")).toHaveLength(5);
    fireEvent.click(more);
    expect(screen.queryByRole("button", { name: /עוד 2 קטגוריות/ })).toBeNull();
    expect(calc.getAllByRole("link")).toHaveLength(6);
    // The last has no category, so no page of its own: its lines are in the transactions below.
    expect(calc.getByText("בלי קטגוריה").closest("a")).toBeNull();
    expect(document.activeElement).toHaveTextContent("היתרים");
  });

  it("opens a category's lines with its own name and figure, and Back to the renovation", async () => {
    serveRehab(birchLaneRehab);
    renderAt("/projects/p1/investment/returns/rehab?category=cat-furniture");
    expect(await screen.findByRole("heading", { name: "ריהוט וציוד" })).toBeInTheDocument();
    expect(document.querySelector(".ui-ret-hero")).toHaveTextContent("−$4,300");
    // Back reads the renovation's name: it returns to its page.
    expect(screen.getByRole("button", { name: /שיפוץ עד היום/ })).toBeInTheDocument();
    await waitFor(() => { expect(rpc.calls.some((call) => call.name === "get_property_return_lines")).toBe(true); });
    expect(rpc.calls.find((call) => call.name === "get_property_return_lines")?.args).toMatchObject({ p_line: "rehab", p_category_id: "cat-furniture" });
  });

  it("opens the same for a viewer, who only reads", async () => {
    serveRehab(birchLaneRehab);
    renderAt("/projects/p1/investment/part/rehab", true);
    const calc = within(await screen.findByRole("list", { name: "שיפוץ עד היום" }));
    expect(calc.getAllByRole("link")).toHaveLength(3);
  });

  it("says there is no renovation yet", async () => {
    serveRehab([], birchLaneReturnsNoRehab);
    renderAt("/projects/p1/investment/part/rehab");
    expect(await screen.findByText(REHAB_EMPTY)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "החישוב" })).toBeNull();
    expect(screen.getByRole("link", { name: "מה לא נספר? לפי קטגוריה" })).toBeInTheDocument();
  });

  it("points the building cost's renovation row at its page", () => {
    expect(buildingFormula(birchLaneReturns).rows.find((row) => row.key === "rehab")?.target).toEqual({ kind: "part", part: "rehab" });
    expect(forcedFormula(birchLaneReturns).rows.find((row) => row.key === "rehab")?.target).toEqual({ kind: "part", part: "rehab" });
  });
});

describe("the ⓘ beside a returns page's title (FLOW-462)", () => {
  it("has a reading guide for every page key", () => {
    const keys = [PAGE_LEARN.statement, ...Object.values(PAGE_LEARN.line), ...METRIC_KEYS.map((key) => PAGE_LEARN.metric[key]), ...PART_KEYS.map((key) => PAGE_LEARN.part[key]), ...Object.values(INFO_LEARN), "total" as const];
    // Every guide is shown somewhere: on a page, at the end of a figure's ⓘ sheet, or beside the total.
    expect(new Set(keys)).toEqual(new Set(Object.keys(LEARN)));
    expect(new Set(Object.keys(LEARN_ENGLISH))).toEqual(new Set(Object.keys(LEARN)));
    for (const key of keys) {
      expect(LEARN[key].what.length).toBeGreaterThan(0);
      expect(LEARN[key].read.length).toBeGreaterThan(0);
      expect(LEARN[key].goal.length).toBeGreaterThan(0);
    }
  });

  it("opens how to read the cap rate, and gives the focus back on close", async () => {
    serve();
    renderAt("/projects/p1/investment/metric/cap-rate");
    const button = await screen.findByRole("button", { name: "איך לקרוא את Cap rate" });
    fireEvent.click(button);
    const dialog = await screen.findByRole("dialog", { name: "Cap rate" });
    for (const title of Object.values(LEARN_TITLES)) expect(within(dialog).getByRole("heading", { name: title })).toBeInTheDocument();
    expect(within(dialog).getByText(LEARN["cap-rate"].goal)).toBeInTheDocument();
    // FLOW-465: Cap rate's title is already English, so no English name under it.
    expect(within(dialog).queryByText(/Cap rate/, { selector: ".ui-sheet-subtitle" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(document.activeElement).toBe(button); });
  });

  it("puts one beside the total return on the investment page", async () => {
    renderInvestment();
    fireEvent.click(await screen.findByRole("button", { name: "איך לקרוא את תשואה כוללת" }));
    const dialog = await screen.findByRole("dialog", { name: "תשואה כוללת" });
    // FLOW-465: the investor's English name under the Hebrew title.
    expect(within(dialog).getByText("\u2066Total return\u2069")).toBeInTheDocument();
    expect(within(dialog).getByText(LEARN.total.goal)).toBeInTheDocument();
  });

  it("puts none on a line without a guide", async () => {
    serve();
    renderAt("/projects/p1/investment/returns/opex");
    await screen.findByRole("heading", { name: "הוצאות תפעול" });
    expect(screen.queryByRole("button", { name: /^איך לקרוא את/ })).toBeNull();
  });
});

describe("the per-year metrics from a first rent inside the period (FLOW-464)", () => {
  it("says the scaled metrics are a year's figure, and DSCR is not scaled", () => {
    expect(metricCaption("cap-rate", birchLaneReturnsAnnualized)).toBe("רווח תפעולי ÷ שווי היום · מחושב לשנה");
    expect(metricCaption("coc", birchLaneReturnsAnnualized)).toBe("תזרים ÷ כסף בעסקה · מחושב לשנה");
    expect(metricCaption("dscr", birchLaneReturnsAnnualized)).toBe("רווח תפעולי ÷ תשלומי הלוואה");
    expect(metricCaption("cap-rate", birchLaneReturns)).toBe("רווח תפעולי ÷ שווי היום");
    expect(metricValue("dscr", birchLaneReturnsAnnualized)).toEqual({ kind: "text", text: NO_PAYMENTS });
  });

  it("divides a year's NOI on the cap rate page, and names the days since the first rent", () => {
    const page = metricPage("cap-rate", birchLaneReturnsAnnualized);
    // $15,600 × 365 / 215 = $26,483.72, shown in whole dollars.
    expect(page.result?.text).toBe("\u2066$26,484 ÷ $240,000\u2069");
    // The step from the days since the first rent to a year, before "=".
    expect(page.result?.yearly).toMatchObject({ label: "רווח תפעולי לשנה", hint: "\u2066$15,600 ÷ 215 × 365\u2069", value: { kind: "money", minor: 2648372n } });
    expect(metricPage("cap-rate", birchLaneReturns).result?.yearly).toBeUndefined();
    expect(page.caption).toBe("רווח תפעולי ÷ שווי היום · מהשכר הראשון ב־01/04/2026 · 215 ימים, מחושב לשנה");
    expect(metricPage("cap-rate", birchLaneReturns).caption).toBe("רווח תפעולי ÷ שווי היום · 12 חודשים");
  });
});
