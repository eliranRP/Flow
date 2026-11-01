import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { birchLaneInvestment } from "../dev/investment-sample";
import { project as sampleProject } from "../dev/project-cash-sample";
import { birchLaneReturnLines, birchLaneReturns, birchLaneReturnsMissing, birchLaneReturnsNegative } from "../dev/returns-sample";
import { ToastProvider } from "../ui/toast";
import { ProjectInvestmentScreen } from "./project-investment-screen";
import { UNITS_HOLD, editVerdict } from "./project-investment-sheets";
import { barShares } from "./project-returns-cards";
import { bracketText, dscrText, percentText, shareOfMoneyIn, toPropertyReturns, toReturnLinesPage } from "./project-returns-data";
import { PropertyMetricScreen, PropertyPartScreen } from "./project-returns-detail-screen";
import {
  MISSING_HISTORY,
  TAX_CAPTION,
  buildingFormula,
  metricPage,
  returnInfo,
  type Formula,
  type FormulaRow,
  type InfoKey,
} from "./project-returns-info";
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

function renderAt(entry: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>
          <Routes>
            <Route path="/projects/:projectId/investment/returns" element={<PropertyStatementScreen />} />
            <Route path="/projects/:projectId/investment/returns/:line" element={<PropertyReturnLineScreen />} />
            <Route path="/projects/:projectId/investment/metric/:metric" element={<PropertyMetricScreen />} />
            <Route path="/projects/:projectId/investment/part/:part" element={<PropertyPartScreen />} />
            <Route path="/projects/:projectId/investment" element={<Where />} />
          </Routes>
        </MemoryRouter>
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

  it("keeps only the inputs it knows as missing, and reads absent lines as none", () => {
    const json = toReturnsJson(birchLaneReturnsMissing);
    const parsed = toPropertyReturns({ ...json, missing: [...birchLaneReturnsMissing.missing, "something_new"], statement: { ...(json.statement as object), lines: {}, by_category: {} } });
    expect(parsed.missing).toEqual(["value_history", "land", "tax_bracket", "units"]);
    expect(parsed.statement.counts.opex).toBe(0);
    expect(parsed.statement.byCategory.capex).toEqual([]);
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
    expect(shareOfMoneyIn(420_000n, 3_630_000n, 365)).toBe(1157);
    expect(shareOfMoneyIn(420_000n, null, 365)).toBeNull();
  });
});

describe("the sample figures add up", () => {
  it("in every sheet whose parts are added", () => {
    for (const sample of [birchLaneReturns, birchLaneReturnsNegative]) {
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
    for (const r of [birchLaneReturns, birchLaneReturnsNegative]) {
      const st = r.statement;
      expect(st.incomeMinor + st.opexMinor).toBe(st.noiMinor);
      expect(st.noiMinor + st.debtServiceMinor + st.capexMinor).toBe(st.cashFlowMinor);
      for (const line of ["income", "opex", "debt_service", "capex", "not_counted"] as const) {
        const categories = st.byCategory[line];
        expect(categories.reduce((sum, item) => sum + item.minor, 0n)).toBe(line === "income" ? st.incomeMinor : line === "opex" ? st.opexMinor : line === "debt_service" ? st.debtServiceMinor : line === "capex" ? st.capexMinor : st.notCountedMinor);
        expect(categories.reduce((sum, item) => sum + item.count, 0)).toBe(line === "debt_service" ? st.counts[line] * 2 : st.counts[line]);
      }
      const s = r.sources;
      expect(s.cashFlowMinor + s.principalMinor + (s.appreciationMinor ?? 0n) + (s.taxSavingsMinor ?? 0n)).toBe(s.totalMinor);
    }
  });

  it("in the tax savings: the building over 27.5 years at the bracket", () => {
    const { sources, inputs } = birchLaneReturns;
    expect(sources.buildingMinor).toBe((inputs.purchaseMinor ?? 0n) + (inputs.rehabMinor ?? 0n) - (inputs.landMinor ?? 0n));
    expect(Math.round((Number(sources.buildingMinor) * 10) / 275)).toBe(Number(sources.depreciationYearMinor));
    expect(Math.round((Number(sources.buildingMinor) * 10 * 2400) / (275 * 10_000))).toBe(Number(sources.taxSavingsMinor));
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

  it("asks for the missing input, and says a value a year back is missing with no button", () => {
    const tax = returnInfo("tax", birchLaneReturnsMissing).formula;
    expect(tax.rows[0]?.value).toEqual({ kind: "missing", add: "land", note: undefined });
    expect(tax.rows[2]?.value).toEqual({ kind: "missing", add: "tax_bracket", note: undefined });
    const appreciation = returnInfo("appreciation", birchLaneReturnsMissing).formula;
    expect(appreciation.rows[1]?.value).toEqual({ kind: "missing", add: null, note: MISSING_HISTORY });
  });

  it("works the money in the deal out from what was borrowed, not the balance", () => {
    const rows = returnInfo("money_in", birchLaneReturns).formula.rows;
    expect(rows.map((row) => row.label)).toEqual(["מחיר רכישה", "שיפוץ עד היום", "הלוואות בקנייה"]);
    expect(rows[2]?.value).toEqual({ kind: "money", minor: -21_000_000n, income: false });
  });

  it("asks for units on the cash flow per unit", () => {
    expect(metricPage("per-unit", birchLaneReturnsMissing).value).toEqual({ kind: "missing", add: "units", note: undefined });
    expect(metricPage("coc", birchLaneReturns).result?.text).toBe("$4,200 ÷ $36,300");
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
    fireEvent.click(within(dialog).getByRole("button", { name: /מדרגת המס/ }));
    expect(await screen.findByRole("dialog", { name: "מדרגת המס" })).toBeInTheDocument();
  });

  it("reads חסר with הוספה for a missing input, and חסר · שווי לפני שנה with no button", async () => {
    renderInvestment(birchLaneReturnsMissing);
    const card = (await screen.findByRole("heading", { name: "תשואה כוללת · שנה" })).closest("section");
    if (card == null) throw new Error("no card");
    expect(within(card).getByText(MISSING_HISTORY)).toBeInTheDocument();
    expect(within(card).getAllByRole("button", { name: "הוספה" })).toHaveLength(1);
    fireEvent.click(within(card).getByRole("button", { name: "הוספה" }));
    // The tax savings need the land first.
    expect(await screen.findByRole("dialog", { name: "שווי הקרקע" })).toBeInTheDocument();
  });

  it("adds land and units to the property's figures", async () => {
    renderInvestment(birchLaneReturnsMissing);
    const card = await screen.findByRole("region", { name: "נתוני הנכס" });
    expect(within(card).getByRole("button", { name: /^יחידות.*הוספה/ })).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: /^קרקע/ }));
    expect(await screen.findByRole("dialog", { name: "שווי הקרקע" })).toBeInTheDocument();
  });

  it("opens a figure's sheet from an edit link", async () => {
    renderInvestment(birchLaneReturns, "/projects/p1/investment?edit=units");
    expect(await screen.findByRole("dialog", { name: "מספר יחידות" })).toBeInTheDocument();
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
    expect(await screen.findByText("$4,200 ÷ $36,300")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /הלוואות בקנייה/ })).toHaveAttribute("href", "/loans");
    expect(screen.getByRole("link", { name: /מחיר רכישה/ })).toHaveAttribute("href", "/projects/p1/investment?edit=purchase");
  });

  it("sends an unknown metric back to the investment page", async () => {
    serve();
    renderAt("/projects/p1/investment/metric/irr");
    expect(await screen.findByTestId("where")).toHaveTextContent("/projects/p1/investment");
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
