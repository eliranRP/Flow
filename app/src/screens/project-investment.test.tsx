import { projectDetailSchema } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { birchLaneInvestment } from "../dev/investment-sample";
import { FILLED } from "../ui/investment-card.stories-support";
import { shiftDays, israelToday } from "../ui/date-math";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { loanNote } from "./project-investment-cards";
import { toProjectInvestment } from "./project-investment-data";
import { ProjectInvestmentScreen, INVESTMENT_REFUSED, applySample, tabFromSearch } from "./project-investment-screen";
import { EMPTY_HOLD, editVerdict, rawToMinor } from "./project-investment-sheets";
import { birchLaneReturns } from "../dev/returns-sample";
import { percentText, toPropertyReturns, type PropertyReturns } from "./project-returns-data";
import { investmentAttentionRows, investmentKind } from "./project-returns-cards";
import { totalRateFormula, totalSumFormula } from "./project-returns-sheets";
import { toReturnsJson } from "./project-returns-test-support";

type Result = { data: unknown; error: { message: string; code?: string } | null };
type Call = { name: string; args: unknown };
const rpc = vi.hoisted(() => ({
  calls: [] as Call[],
  impl: (_name: string, _args?: unknown): Promise<Result> => Promise.resolve({ data: null, error: null }),
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

/** Invented figures, in minor units as the server sends them. */
const investment = {
  currency: "ILS",
  purchase_minor: 125_000_000,
  arv_minor: 190_000_000,
  value_minor: 165_000_000,
  value_date: "2026-10-01",
  rehab_minor: 31_240_000,
  rehab_other_currencies: [],
  loan_balance_minor: 80_000_000,
  loan_balance_other_currencies: [],
  forced_equity_minor: 33_760_000,
  current_equity_minor: 85_000_000,
};

const base = {
  id: "p1",
  name: "פרויקט לדוגמה",
  status: "active",
  state_label: "flip · בשיפוץ",
  budget_agorot: null,
  income_agorot: 0,
  direct_agorot: 0,
  shared_agorot: 0,
  profit_agorot: 0,
  categories: [],
  transactions: [],
  is_overhead: false,
  loans: [{ id: "l1", name: "הלוואה לדוגמה", currency: "ILS", balance_minor: 80_000_000, status: "open" }],
};

function payload(inv: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  return { ...base, investment: { ...investment, ...inv }, ...extra };
}

/**
 * The returns read on the same invented figures: equity ₪850,000, השבחה ₪337,600, money in ₪762,400,
 * and a net profit of ₪185,600 (₪1,900,000 less 8% to sell, the purchase and the renovation).
 */
function returnsOf(over: Partial<PropertyReturns["equity"]> = {}, inputs: Partial<PropertyReturns["inputs"]> = {}): Record<string, unknown> {
  const r: PropertyReturns = {
    ...birchLaneReturns,
    currency: "ILS",
    inputs: {
      ...birchLaneReturns.inputs,
      purchaseMinor: 125_000_000n,
      arvMinor: 190_000_000n,
      valueMinor: 165_000_000n,
      rehabMinor: 31_240_000n,
      // The typed price: the purchase row opens its edit sheet.
      purchaseSource: "typed",
      purchaseTypedMinor: 125_000_000n,
      loanBalanceMinor: 80_000_000n,
      ...inputs,
    },
    equity: {
      todayMinor: 85_000_000n,
      forcedMinor: 33_760_000n,
      moneyInMinor: 76_240_000n,
      moneyInParts: { acquisitionMinor: -125_000_000n, renovationMinor: -31_240_000n, holdingMinor: 0n, financingMinor: 80_000_000n, shortfallMinor: 0n },
      allCashOut: false,
      coverMonths: null,
      ...over,
    },
  };
  // FLOW-1068: the net profit as the server works it out: 8% of the ARV to sell, no holding costs.
  const arv = r.inputs.arvMinor;
  const selling = arv == null ? null : arv * 800n / 10_000n;
  const net = arv == null || selling == null || r.inputs.purchaseMinor == null || r.inputs.rehabMinor == null ? null : arv - selling - r.inputs.purchaseMinor - r.inputs.rehabMinor;
  const moneyIn = r.equity.moneyInMinor;
  r.deal = { ...r.deal, holdingMinor: 0n, sellingCostMinor: selling, netProfitMinor: net };
  r.metrics = { ...r.metrics, flipRoiBp: net == null || moneyIn == null ? null : Number(net * 10_000n / moneyIn) };
  return toReturnsJson(r);
}

function wrap(node: React.ReactNode, entry = "/projects/p1/investment") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function renderPage(options: { viewer?: boolean; entry?: string } = {}) {
  const page = (
    <Routes>
      <Route path="/projects/:projectId/investment" element={<ProjectInvestmentScreen />} />
    </Routes>
  );
  return wrap(options.viewer === true ? <ViewerPreview>{page}</ViewerPreview> : page, options.entry);
}

/** The page's own read answers with `project`; `save` decides what set_project_investment says. */
function serve(project: unknown = payload(), save: Result | null = null, returns: unknown = returnsOf()) {
  rpc.impl = (name) => {
    if (name === "set_project_investment" && save != null) return Promise.resolve(save);
    if (name === "get_property_returns") return Promise.resolve({ data: returns, error: null });
    return Promise.resolve({ data: name === "get_project" ? project : name === "set_project_investment" ? { before: {}, after: {} } : null, error: null });
  };
}

function saves(): Call[] {
  return rpc.calls.filter((call) => call.name === "set_project_investment");
}

function basisOf(call: Call): string | undefined {
  return (call.args as { p_basis?: string } | undefined)?.p_basis;
}

/** The page has read the project and drawn its figures. */
async function ready(): Promise<void> {
  await screen.findByText("נתוני הנכס");
}

/** The property's figures (the נכס tab, open on arrival). */
function figures() {
  return within(screen.getByRole("region", { name: "נתוני הנכס" }));
}

const band = () => document.querySelector(".ui-band") as HTMLElement;

/** Opens a tab of the segment under the parts. */
async function openTab(name: "נכס" | "מדדים" | "הלוואות"): Promise<HTMLElement> {
  fireEvent.click(await screen.findByRole("radio", { name }));
  return screen.findByRole("region", { name: name === "נכס" ? "נתוני הנכס" : name });
}

describe("the tab in the URL (FLOW-1071)", () => {
  it("reads only a tab it knows", () => {
    expect(tabFromSearch("?tab=metrics")).toBe("metrics");
    expect(tabFromSearch("?preview=on&tab=loans")).toBe("loans");
    expect(tabFromSearch("?tab=other")).toBeNull();
    expect(tabFromSearch("")).toBeNull();
  });

  it("opens on the tab Back lands on, and a tap keeps it in the URL", async () => {
    serve();
    renderPage({ entry: "/projects/p1/investment?tab=metrics" });
    expect(await screen.findByRole("radio", { name: "מדדים" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(screen.getByRole("radio", { name: "הלוואות" }));
    expect(screen.getByRole("radio", { name: "הלוואות" })).toHaveAttribute("aria-checked", "true");
  });
});

describe("the page", () => {
  it("leads a renovation with the expected profit, then the figures the project read", async () => {
    serve();
    renderPage();
    await ready();
    // FLOW-1047, FLOW-1068: a project with an ARV is a renovation: its band is the net profit at the ARV, its ROI on
    // the money in the deal under it, then the ARV and the money in.
    expect(await within(band()).findByText("רווח נקי צפוי במכירה")).toBeInTheDocument();
    expect(band().querySelector(".ui-pinv-band-figure")).toHaveTextContent("₪186K");
    expect(band()).toHaveTextContent("ROI 24.3% על הכסף בעסקה");
    expect(within(band()).getByRole("button", { name: /^שווי אחרי שיפוץ \(ARV\)/ })).toHaveTextContent("₪1,900,000");
    expect(within(band()).getByRole("link", { name: /^כסף בעסקה/ })).toHaveTextContent("₪762,400");
    expect(figures().getByText("₪1,250,000")).toBeInTheDocument();
    expect(figures().getByText("₪1,650,000")).toBeInTheDocument();
    expect(figures().getByText("₪312,400")).toBeInTheDocument();
    expect(screen.getByText("01/10/2026").parentElement).toHaveTextContent("נכון ל־01/10/2026");
    // The state line under the title, and the project's name as Back's label.
    expect(screen.getByText("flip · בשיפוץ")).toBeInTheDocument();
    expect(rpc.calls.filter((call) => call.name === "get_project").every((call) => basisOf(call) !== "cash")).toBe(true);
  });

  it("shows where the profit comes from, each part opening its calculation", async () => {
    serve();
    renderPage();
    const card = await screen.findByRole("region", { name: "מאיפה הרווח" });
    // FLOW-1068: the four cost buckets; no holding costs here, so no holding part.
    expect(within(card).getByRole("img")).toHaveAccessibleName(/^מחיר קנייה \d+%, שיפוץ עד היום \d+%, עלויות מכירה \d+%, רווח נקי צפוי \d+%$/);
    expect(within(card).getByRole("button", { name: /^מחיר קנייה/ })).toHaveTextContent("−₪1,250,000");
    expect(within(card).getByRole("link", { name: /^שיפוץ עד היום/ })).toHaveAttribute("href", "/projects/p1/investment/part/rehab");
    const selling = within(card).getByRole("button", { name: /^עלויות מכירה/ });
    expect(selling).toHaveTextContent("−₪152,000");
    expect(selling).toHaveTextContent("8% מה־ARV · הערכה · עריכה");
    expect(within(card).getByRole("link", { name: /^רווח נקי צפוי/ })).toHaveAttribute("href", "/projects/p1/investment/part/profit");
    fireEvent.click(selling);
    expect(await screen.findByRole("dialog", { name: "עלויות מכירה" })).toBeInTheDocument();
  });

  it("opens איך מחושב with the profit in numbers", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: "איך מחושב" }));
    const dialog = await screen.findByRole("dialog", { name: "איך מחושב הרווח הנקי" });
    expect(within(dialog).getByRole("list", { name: "רווח נקי צפוי" })).toHaveTextContent("₪185,600");
    fireEvent.click(within(dialog).getByRole("button", { name: "הבנתי" }));
    await waitFor(() => { expect(screen.queryByRole("dialog")).toBeNull(); });
  });

  it("asks for a missing ARV in a card that opens its sheet, and hides it on this device", async () => {
    window.localStorage.removeItem("flow.attention.investment:p1");
    serve(payload({ arv_minor: null, forced_equity_minor: null }, { budget_agorot: 50_000_000 }), null, returnsOf({ forcedMinor: null }, { arvMinor: null }));
    renderPage();
    await ready();
    const cards = await screen.findByRole("region", { name: "חסר לחישוב" });
    const card = within(cards).getByRole("link", { name: /חסר ARV/ });
    expect(card).toHaveAttribute("href", "/projects/p1/investment?edit=arv");
    fireEvent.click(card);
    expect(await screen.findByRole("dialog", { name: "שווי אחרי שיפוץ (ARV)" })).toBeInTheDocument();
    expect(band().querySelector(".ui-pinv-band-figure")).toHaveTextContent("חסר");
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
    fireEvent.click(within(cards).getByRole("button", { name: /^הסתרה: חסר ARV/ }));
    await waitFor(() => { expect(window.localStorage.getItem("flow.attention.investment:p1")).toContain("missing-arv"); });
    window.localStorage.removeItem("flow.attention.investment:p1");
  });

  it("says another currency blocks the equity and lists the loan apart", async () => {
    serve(payload(
      { loan_balance_other_currencies: [{ currency: "USD", balance_minor: 12_000_000 }], current_equity_minor: null },
      {
        loans: [
          { id: "l1", name: "הלוואה בשקלים", currency: "ILS", balance_minor: 80_000_000, status: "open" },
          { id: "l2", name: "הלוואה בדולר", currency: "USD", balance_minor: 12_000_000, status: "open" },
        ],
      },
    ), null, returnsOf({ todayMinor: null }));
    renderPage();
    await ready();
    const loans = within(await openTab("הלוואות"));
    expect(loans.getByText(/במטבע אחר/)).toBeInTheDocument();
    expect(loans.getByRole("link", { name: /הלוואה בדולר/ })).toHaveTextContent("$120,000");
  });

  it("is read-only for a viewer: no הוספה, no card, nothing opens but the pages that read", async () => {
    serve(payload({ arv_minor: null, forced_equity_minor: null }), null, returnsOf({ forcedMinor: null }, { arvMinor: null }));
    const { container } = renderPage({ viewer: true });
    await ready();
    await screen.findByRole("region", { name: "ממה מורכבת התשואה" });
    expect(screen.queryByRole("region", { name: "חסר לחישוב" })).toBeNull();
    expect(screen.queryByText("הוספה")).not.toBeInTheDocument();
    // FLOW-460: the renovation's page only reads, so it opens for a viewer too.
    const chevrons = [...container.querySelectorAll(".ui-pinv-group .ui-pinv-chevron")];
    expect(chevrons).toHaveLength(1);
    expect(chevrons[0]?.closest("a")).toHaveAttribute("href", "/projects/p1/investment/part/rehab");
    expect(within(await openTab("הלוואות")).queryByText("+ הוספת הלוואה")).not.toBeInTheDocument();
  });

  it("opens the renovation's own page from its row, not a sheet (FLOW-460)", async () => {
    serve();
    renderPage({ entry: "/projects/p1/investment?period=month&at=2026-09" });
    await ready();
    const rehab = figures().getByRole("link", { name: /שיפוץ עד היום/ });
    expect(rehab).toHaveAttribute("href", "/projects/p1/investment/part/rehab");
    expect(rehab).toHaveTextContent("₪312,400");
    fireEvent.click(rehab);
    expect(screen.queryByRole("dialog")).toBeNull();
    // The old sheet read the costs again on the cash basis; nothing does now.
    expect(rpc.calls.some((call) => call.name === "list_categories" || basisOf(call) === "cash")).toBe(false);
  });

  it("lists no loan rows when there is no loan at all", async () => {
    serve(payload({ loan_balance_minor: 0 }, { loans: [] }));
    renderPage();
    await ready();
    const loans = within(await openTab("הלוואות"));
    expect(loans.getByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    expect(loans.queryByRole("link", { name: /הלוואה/ })).not.toBeInTheDocument();
    expect(loans.getByRole("button", { name: "+ הוספת הלוואה" })).toBeInTheDocument();
  });

  it("shows only the loans for the overhead project", async () => {
    serve(payload({}, { is_overhead: true }));
    renderPage();
    await screen.findByRole("heading", { name: "הלוואות" });
    expect(screen.queryByText("נתוני הנכס")).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).toBeNull();
    expect(screen.getByRole("link", { name: /הלוואה לדוגמה/ })).toBeInTheDocument();
  });

  it("opens the new-loan sheet on the loans tab with this project", async () => {
    serve();
    function Probe() {
      const location = useLocation();
      return <p data-testid="at">{`${location.pathname}${location.search}|${(location.state as { newLoanProject?: string } | null)?.newLoanProject ?? ""}`}</p>;
    }
    wrap(
      <Routes>
        <Route path="/projects/:projectId/investment" element={<ProjectInvestmentScreen />} />
        <Route path="/loans" element={<Probe />} />
      </Routes>,
    );
    await ready();
    await openTab("הלוואות");
    fireEvent.click(screen.getByRole("button", { name: "+ הוספת הלוואה" }));
    expect(await screen.findByTestId("at")).toHaveTextContent("/loans?new=loan|p1");
  });

  it("draws nothing in a preview", () => {
    const { container } = renderPage({ entry: "/projects/p1/investment?preview=loading" });
    expect(container.querySelector(".ui-pinv-card")).toBeNull();
    expect(rpc.calls).toHaveLength(0);
  });

  it("shows an error with a retry", async () => {
    rpc.impl = () => Promise.resolve({ data: null, error: { message: "boom" } });
    renderPage();
    const retry = await screen.findByRole("button", { name: "נסו שוב" });
    serve();
    fireEvent.click(retry);
    expect(await screen.findByText("נתוני הנכס")).toBeInTheDocument();
  });

  it("says loading while the project is read", async () => {
    rpc.impl = () => new Promise(() => undefined);
    renderPage();
    expect(await screen.findByText("טוען…")).toBeInTheDocument();
  });
});

describe("the kind and the attention cards", () => {
  const r = toPropertyReturns(returnsOf());
  it("reads a budget or an ARV as a renovation, else a rental", () => {
    expect(investmentKind({ overhead: false, budget: true, arv: false, value: false, rent: false })).toBe("flip");
    expect(investmentKind({ overhead: false, budget: false, arv: true, value: true, rent: true })).toBe("flip");
    expect(investmentKind({ overhead: false, budget: false, arv: false, value: true, rent: true })).toBe("rent");
    expect(investmentKind({ overhead: false, budget: false, arv: false, value: false, rent: false })).toBe("rent");
  });

  it("asks a rental for each missing input, keyed by what it counts", () => {
    const missing: PropertyReturns = { ...r, missing: ["value_history", "land", "tax_bracket"], inputs: { ...r.inputs, valueDate: "2026-10-01", landSuggestion: null } };
    const rows = investmentAttentionRows("rent", missing, "/projects/p1/investment", "", false);
    expect(rows.map((row) => [row.id, row.dismissKey, row.to])).toEqual([
      ["missing-value", "history:2026-10-01", "/projects/p1/investment?edit=value"],
      ["missing-land", "land", "/projects/p1/investment?edit=land"],
      ["missing-tax_bracket", "tax_bracket", "/projects/p1/investment?edit=tax_bracket"],
    ]);
    // A land the books suggest is taken on the figures; a viewer adds nothing.
    expect(investmentAttentionRows("rent", { ...missing, inputs: { ...missing.inputs, landSuggestion: { accountId: "a", name: "Land", minor: 1n } } }, "/b", "", false).map((row) => row.id)).not.toContain("missing-land");
    expect(investmentAttentionRows("rent", missing, "/b", "", true)).toEqual([]);
  });

  it("asks a renovation for its ARV and its purchase only", () => {
    const rows = investmentAttentionRows("flip", { ...r, missing: ["tax_bracket"], inputs: { ...r.inputs, arvMinor: null, purchaseMinor: null } }, "/b", "?preview=on", false);
    expect(rows.map((row) => row.to)).toEqual(["/b?preview=on&edit=arv", "/b?preview=on&edit=purchase"]);
  });

  it("adds a rental's four sources up to the year's total, then divides it by the money in", () => {
    const sum = totalSumFormula(r);
    const total = sum.rows.reduce((acc, row) => acc + (row.value.kind === "money" ? row.value.minor : 0n), 0n);
    expect(sum.result?.value).toEqual({ kind: "money", minor: r.sources.totalMinor });
    expect(total).toBe(r.sources.totalMinor);
    const rate = totalRateFormula(r);
    expect(rate.rows.map((row) => row.op)).toEqual(["", "÷"]);
    expect(rate.result?.value).toEqual({ kind: "text", text: percentText(r.sources.totalBp ?? 0) });
  });
});

describe("the equity formulas", () => {
  it("works the השבחה out as ARV less purchase and rehab, and the equity as value less loans", () => {
    const figures = applySample(FILLED, { arv_minor: 200_000_000, value_minor: 170_000_000 });
    expect(figures.forcedEquityMinor).toBe(200_000_000n - 125_000_000n - 31_240_000n);
    expect(figures.currentEquityMinor).toBe(170_000_000n - 80_000_000n);
    // The sample's own: $310,000 less $185,000 less $61,300; $240,000 less $210,000.
    expect(birchLaneInvestment.figures?.forcedEquityMinor).toBe(6_370_000n);
    expect(birchLaneInvestment.figures?.currentEquityMinor).toBe(3_000_000n);
  });

  it("leaves the השבחה empty while the ARV is missing, and never reads 0", () => {
    const figures = applySample(FILLED, { arv_minor: null });
    expect(figures.forcedEquityMinor).toBeNull();
    expect(applySample(FILLED, { value_minor: null, value_date: null }).currentEquityMinor).toBeNull();
  });

  it("draws the recalculated equity after a save", async () => {
    serve();
    let arv = 190_000_000;
    rpc.impl = (name, args) => {
      if (name === "set_project_investment") {
        arv = (args as { p_patch: { arv_minor: number } }).p_patch.arv_minor;
        return Promise.resolve({ data: { before: {}, after: {} }, error: null });
      }
      const forced = arv - 125_000_000 - 31_240_000;
      if (name === "get_property_returns") return Promise.resolve({ data: returnsOf({ forcedMinor: BigInt(forced) }, { arvMinor: BigInt(arv) }), error: null });
      return Promise.resolve({ data: name === "get_project" ? payload({ arv_minor: arv, forced_equity_minor: forced }) : null, error: null });
    };
    renderPage();
    await ready();
    await screen.findByRole("region", { name: "מאיפה הרווח" });
    fireEvent.click(figures().getByRole("button", { name: /^שווי אחרי שיפוץ/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    // ₪2,000,000 less 8% to sell, the purchase and the renovation.
    expect(await screen.findByText("₪277,600")).toBeInTheDocument();
    // The returns are read again after the save.
    expect(rpc.calls.filter((call) => call.name === "get_property_returns").length).toBeGreaterThan(1);
  });
});

describe("the undo toast", () => {
  it("puts the previous figure back with a second save", async () => {
    let purchase = 125_000_000;
    rpc.impl = (name, args) => {
      if (name === "set_project_investment") {
        purchase = (args as { p_patch: { purchase_minor: number } }).p_patch.purchase_minor;
        return Promise.resolve({ data: { before: {}, after: {} }, error: null });
      }
      return Promise.resolve({ data: name === "get_project" ? payload({ purchase_minor: purchase }) : null, error: null });
    };
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("₪1,300,000")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(saves()).toHaveLength(2); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: 130_000_000 } });
    expect(saves()[1]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: 125_000_000 } });
    expect(await screen.findByText("₪1,250,000")).toBeInTheDocument();
  });

  it("undoes a clear by putting today's value and its date back", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /שווי היום/ }));
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    await waitFor(() => { expect(saves()).toHaveLength(2); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { value_minor: null, value_date: null } });
    expect(saves()[1]?.args).toEqual({ p_project_id: "p1", p_patch: { value_minor: 165_000_000, value_date: "2026-10-01" } });
  });
});

describe("the edit sheet", () => {
  it("saves only the edited figure on שמירה", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: 130_000_000 } });
  });

  it("names the figure and says what it is", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /שווי אחרי שיפוץ/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("שווי אחרי שיפוץ (ARV)")).toBeInTheDocument();
    expect(within(dialog).getByText("כמה הנכס יהיה שווה כשהשיפוץ יסתיים. משמש לחישוב ההשבחה הצפויה.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /נכון לתאריך/ })).not.toBeInTheDocument();
  });

  it("saves the figure when the sheet closes", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /שווי אחרי שיפוץ/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "2000000" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { arv_minor: 200_000_000 } });
    await waitFor(() => { expect(screen.queryByRole("textbox", { name: "סכום" })).not.toBeInTheDocument(); });
  });

  it("keeps the sheet open on a failed save and names the figure", async () => {
    serve(payload(), { data: null, error: { message: "boom" } });
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא הצלחנו לשמור את מחיר רכישה.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "סכום" })).toBeInTheDocument();
  });

  it("says when the save is refused", async () => {
    serve(payload(), { data: null, error: { message: "forbidden", code: "42501" } });
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(INVESTMENT_REFUSED)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "סכום" })).toBeInTheDocument();
  });

  it("holds an emptied figure on the first close and discards it on the second", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "" } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(await screen.findByText(EMPTY_HOLD)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "סכום" })).toBeInTheDocument();
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => { expect(screen.queryByRole("textbox", { name: "סכום" })).not.toBeInTheDocument(); });
    expect(saves()).toHaveLength(0);
  });

  it("clears a figure with null on מחיקה", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: null } });
  });

  it("clears today's value and its date together", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /שווי היום/ }));
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { value_minor: null, value_date: null } });
  });

  it("saves today's value with its date, which starts on today", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /שווי היום/ }));
    expect(await screen.findByText(/היום ·/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "סכום" }), { target: { value: "1700000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { value_minor: 170_000_000, value_date: israelToday() } });
  });

  it("saves only the date when only the date changed", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(figures().getByRole("button", { name: /שווי היום/ }));
    fireEvent.click(await screen.findByRole("button", { name: /נכון לתאריך/ }));
    fireEvent.click(await screen.findByRole("button", { name: "אתמול" }));
    fireEvent.click(screen.getByRole("button", { name: "בחירה" }));
    fireEvent.click(await screen.findByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { value_date: shiftDays(israelToday(), -1) } });
  });
});

describe("the land from the books (FLOW-461)", () => {
  it("names the account under a land the books give", async () => {
    serve(payload(), null, returnsOf({}, { landMinor: 30_000_000n, landSource: "books", landTypedMinor: null, landAccount: { id: "acc-land", name: "קרקע לדוגמה" } }));
    renderPage();
    await ready();
    const card = within(screen.getByRole("region", { name: "נתוני הנכס" }));
    expect(await card.findByRole("button", { name: /שווי הקרקע/ })).toHaveTextContent("מהספרים · קרקע לדוגמה");
  });

  it("suggests a land account, and השתמש names it", async () => {
    serve(payload(), null, returnsOf({}, { landMinor: null, landSource: null, landTypedMinor: null, landSuggestion: { accountId: "acc-land", name: "קרקע לדוגמה", minor: 30_000_000n } }));
    renderPage();
    await ready();
    expect(await screen.findByText(/מהספרים: /)).toHaveTextContent("מהספרים: קרקע לדוגמה · ₪300,000");
    fireEvent.click(screen.getByRole("button", { name: /^השתמש/ }));
    await waitFor(() => { expect(rpc.calls.some((call) => call.name === "set_land_account")).toBe(true); });
    expect(rpc.calls.find((call) => call.name === "set_land_account")?.args).toEqual({ p_account_id: "acc-land" });
  });

  it("makes השתמש the land row's one action while the books suggest a land (FLOW-470)", async () => {
    serve(payload(), null, returnsOf({}, { landMinor: null, landSource: null, landTypedMinor: null, taxBracketBp: 2400, landSuggestion: { accountId: "acc-land", name: "קרקע לדוגמה", minor: 30_000_000n } }));
    renderPage();
    await ready();
    await screen.findByText(/מהספרים: /);
    const figures = within(screen.getByRole("region", { name: "נתוני הנכס" }));
    expect(figures.getByRole("button", { name: /^שווי הקרקע/ })).not.toHaveTextContent("הוספה");
    expect(figures.getByRole("button", { name: /^שווי הקרקע/ })).toHaveTextContent("לא הוזן");
  });

  it("undoes taking the land from the books: ביטול names the prior land account again (FLOW-470)", async () => {
    serve(payload(), null, returnsOf({}, { landMinor: null, landSource: null, landTypedMinor: null, landSuggestion: { accountId: "acc-land", name: "קרקע לדוגמה", minor: 30_000_000n } }));
    const read = rpc.impl;
    rpc.impl = (name, args) => (name === "set_land_account"
      ? Promise.resolve({ data: { id: "co1", land_account_id: (args as { p_account_id: string | null }).p_account_id, prior: "acc-old" }, error: null })
      : read(name, args));
    renderPage();
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: /^השתמש/ }));
    expect(await screen.findByText("שווי הקרקע נלקח מהספרים")).toBeInTheDocument();
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    const lands = () => rpc.calls.filter((call) => call.name === "set_land_account").map((call) => call.args);
    await waitFor(() => { expect(lands()).toHaveLength(2); });
    expect(lands()).toEqual([{ p_account_id: "acc-land" }, { p_account_id: "acc-old" }]);
  });

  it("says when the undo of the land fails, not that taking it did (FLOW-470)", async () => {
    serve(payload(), null, returnsOf({}, { landMinor: null, landSource: null, landTypedMinor: null, landSuggestion: { accountId: "acc-land", name: "קרקע לדוגמה", minor: 30_000_000n } }));
    const read = rpc.impl;
    rpc.impl = (name, args) => {
      if (name !== "set_land_account") return read(name, args);
      const undo = (args as { p_account_id: string | null }).p_account_id == null;
      return Promise.resolve(undo ? { data: null, error: { message: "failed" } } : { data: { prior: null }, error: null });
    };
    renderPage();
    await ready();
    fireEvent.click(await screen.findByRole("button", { name: /^השתמש/ }));
    fireEvent.click(await screen.findByRole("button", { name: "ביטול" }));
    expect(await screen.findByText("לא הצלחנו לבטל את שווי הקרקע מהספרים.")).toBeInTheDocument();
  });

  it("offers no suggestion to a viewer", async () => {
    serve(payload(), null, returnsOf({}, { landMinor: null, landSource: null, landTypedMinor: null, landSuggestion: { accountId: "acc-land", name: "קרקע לדוגמה", minor: 30_000_000n } }));
    renderPage({ viewer: true });
    await ready();
    await screen.findByRole("region", { name: "מאיפה הרווח" });
    expect(screen.queryByRole("button", { name: /^השתמש/ })).toBeNull();
  });
});

describe("the loans card", () => {
  it("lists the open loans, the paid-off one dimmed, and other currencies apart", async () => {
    serve(payload(
      { loan_balance_minor: 110_000_000, loan_balance_other_currencies: [{ currency: "USD", balance_minor: 12_000_000 }], current_equity_minor: null },
      {
        loans: [
          { id: "l3", name: "הלוואה שנסגרה", currency: "ILS", balance_minor: 0, status: "paid_off", closed_on: "2026-08-14" },
          { id: "l1", name: "הלוואה בשקלים", currency: "ILS", balance_minor: 110_000_000, status: "open" },
          { id: "l2", name: "הלוואה בדולר", currency: "USD", balance_minor: 12_000_000, status: "open" },
        ],
      },
    ));
    renderPage();
    await ready();
    const card = within(await openTab("הלוואות"));
    const names = card.getAllByRole("link").map((link) => link.textContent);
    expect(names[0]).toContain("הלוואה בשקלים");
    expect(card.getByText(/במטבע אחר/)).toBeInTheDocument();
    expect(card.getByRole("link", { name: /הלוואה בדולר/ })).toBeInTheDocument();
    const closed = card.getByRole("link", { name: /הלוואה שנסגרה/ });
    expect(closed).toHaveClass("ui-pinv-loan-closed");
    expect(closed).toHaveTextContent("נפרעה ב־08/2026");
    expect(closed.querySelector(".ui-pinv-chevron")).toBeNull();
  });

  it("reads rate and next payment from the loan's terms", () => {
    const loan = birchLaneInvestment.loans[0];
    if (loan == null) throw new Error("sample loan");
    const { container } = render(<p>{loanNote(loan, "2026-10-17")}</p>);
    expect(container).toHaveTextContent("10.5% · תשלום הבא $1,838 ב־01/11");
    expect(loanNote({ ...loan, terms: null }, "2026-10-17")).toBeNull();
  });
});

describe("investment helpers", () => {
  it("parses the field's digits to minor units", () => {
    expect(rawToMinor("")).toBeNull();
    expect(rawToMinor("1250000.5")).toBe(125_000_050n);
    expect(rawToMinor("12.")).toBe(1_200n);
  });

  it("holds an emptied figure instead of clearing it on close", () => {
    expect(editVerdict("purchase", { minor: 100n, date: null }, { raw: "", date: "2026-10-08", dateTouched: false })).toEqual({ kind: "hold", message: EMPTY_HOLD });
    expect(editVerdict("purchase", { minor: null, date: null }, { raw: "", date: "2026-10-08", dateTouched: false })).toEqual({ kind: "clean" });
  });

  it("keeps the sample figures consistent", () => {
    expect(FILLED.forcedEquityMinor).toBe((FILLED.arvMinor ?? 0n) - (FILLED.purchaseMinor ?? 0n) - FILLED.rehabMinor);
    const figures = birchLaneInvestment.figures;
    if (figures == null) throw new Error("sample figures");
    expect(figures.forcedEquityMinor).toBe((figures.arvMinor ?? 0n) - (figures.purchaseMinor ?? 0n) - figures.rehabMinor);
    expect(figures.currentEquityMinor).toBe((figures.valueMinor ?? 0n) - figures.loanMinor);
  });

  it("reads every loan the project carries, open ones first, with its terms", () => {
    const project = projectDetailSchema.parse(payload({}, {
      loans: [
        { id: "l2", name: "ישנה", currency: "ILS", balance_minor: 0, status: "paid_off", closed_on: "2026-08-14" },
        { id: "l1", name: "פעילה", currency: "ILS", balance_minor: 100, status: "open", principal_minor: 100, annual_rate_ppm: 105_000, start_date: "2026-01-01", kind: "interest_only", term_months: 12, interest_only_months: 12 },
      ],
    }));
    if (project == null) throw new Error("project");
    const loans = toProjectInvestment(project).loans;
    expect(loans.map((loan) => loan.id)).toEqual(["l1", "l2"]);
    expect(loans[0]?.terms).toEqual(expect.objectContaining({ annualRatePpm: 105_000, kind: "interest_only" }));
    expect(loans[1]).toEqual(expect.objectContaining({ closedOn: "2026-08-14", terms: null }));
  });
});
