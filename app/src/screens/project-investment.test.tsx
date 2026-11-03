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
import { ProjectInvestmentScreen, INVESTMENT_REFUSED, applySample } from "./project-investment-screen";
import { EMPTY_HOLD, editVerdict, rawToMinor } from "./project-investment-sheets";
import { birchLaneReturns } from "../dev/returns-sample";
import type { PropertyReturns } from "./project-returns-data";
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

/** The returns read on the same invented figures: equity ₪850,000, השבחה ₪337,600, money in ₪762,400. */
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

describe("the page", () => {
  it("shows the equity in the property, the figures and the loans the project read", async () => {
    serve();
    renderPage();
    await ready();
    await screen.findByText("הון בנכס");
    expect(screen.getByText("₪1,250,000")).toBeInTheDocument();
    expect(screen.getByText("₪1,900,000")).toBeInTheDocument();
    expect(screen.getByText("₪1,650,000")).toBeInTheDocument();
    expect(screen.getByText("₪312,400")).toBeInTheDocument();
    expect(screen.getByText("₪337,600")).toBeInTheDocument();
    expect(screen.getByText("₪850,000")).toBeInTheDocument();
    expect(screen.getByText("01/10/2026").parentElement).toHaveTextContent("נכון ל־01/10/2026");
    // The state line under the title, and the project's name as Back's label.
    expect(screen.getByText("flip · בשיפוץ")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /הלוואה לדוגמה/ })).toHaveAttribute("href", "/loans/l1");
    expect(rpc.calls.filter((call) => call.name === "get_project").every((call) => basisOf(call) !== "cash")).toBe(true);
  });

  it("leads with the total return on the money in the deal and its four sources", async () => {
    serve();
    renderPage();
    const card = (await screen.findByRole("heading", { name: "תשואה כוללת · שנה" })).closest("section");
    if (card == null) throw new Error("no card");
    expect(within(card).getByText("54.4%")).toBeInTheDocument();
    // FLOW-459: the money in the deal is named once, in its equity row, inside this card.
    expect(card).toHaveTextContent("על הכסף בעסקה");
    expect(within(card).getByRole("button", { name: /^כסף בעסקה/ })).toHaveTextContent("₪762,400");
    expect(within(card).getByRole("group", { name: "הון בנכס" })).toBeInTheDocument();
    for (const source of ["תזרים", "החזר קרן", "עליית ערך", "חיסכון מס"]) {
      expect(within(card).getByRole("button", { name: `איך מחושב: ${source}` })).toBeInTheDocument();
    }
    expect(within(card).getByRole("link", { name: "איך מחושב" })).toHaveAttribute("href", "/projects/p1/investment/returns");
  });

  it("names a missing ARV in the השבחה, and its הוספה opens the ARV sheet", async () => {
    serve(payload({ arv_minor: null, forced_equity_minor: null }), null, returnsOf({ forcedMinor: null }, { arvMinor: null }));
    renderPage();
    await ready();
    const card = await screen.findByRole("group", { name: "הון בנכס" });
    // FLOW-459: the row shows only הוספה; its hint says what is missing.
    const forced = within(card).getByRole("button", { name: /^השבחה צפויה/ });
    expect(forced).toHaveTextContent("השבחה צפויהחסר · שווי אחרי שיפוץ (ARV)הוספה");
    expect(within(screen.getByRole("region", { name: "נתוני הנכס" })).getByRole("button", { name: /שווי אחרי שיפוץ.*הוספה/ })).toBeInTheDocument();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
    fireEvent.click(forced);
    expect(await screen.findByRole("dialog", { name: "שווי אחרי שיפוץ (ARV)" })).toBeInTheDocument();
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
    const card = await screen.findByRole("group", { name: "הון בנכס" });
    expect(within(card).getByText("לא מחושב")).toBeInTheDocument();
    expect(screen.getByText(/במטבע אחר/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /הלוואה בדולר/ })).toHaveTextContent("$120,000");
  });

  it("is read-only for a viewer: no הוספה, nothing opens but the renovation's page", async () => {
    serve(payload({ arv_minor: null, forced_equity_minor: null }));
    const { container } = renderPage({ viewer: true });
    await ready();
    await screen.findByText("הון בנכס");
    // A viewer still opens an ⓘ (how it is made, or how to read it), or an equity row's sheet: it reads, it writes nothing.
    expect([...container.querySelectorAll(".ui-pinv-card button")].every((button) => /^איך (מחושב|לקרוא)/.test(button.getAttribute("aria-label") ?? "") || button.classList.contains("ui-ret-equity-row"))).toBe(true);
    expect(screen.queryByText("הוספה")).not.toBeInTheDocument();
    expect(screen.queryByText("+ הוספת הלוואה")).not.toBeInTheDocument();
    // FLOW-460: the renovation's page only reads, so it opens for a viewer too.
    const chevrons = [...container.querySelectorAll('[aria-label="נתוני הנכס"] .ui-pinv-chevron')];
    expect(chevrons).toHaveLength(1);
    expect(chevrons[0]?.closest("a")).toHaveAttribute("href", "/projects/p1/investment/part/rehab");
  });

  it("opens the renovation's own page from its row, not a sheet (FLOW-460)", async () => {
    serve();
    renderPage({ entry: "/projects/p1/investment?period=month&at=2026-09" });
    await ready();
    const card = within(screen.getByRole("region", { name: "נתוני הנכס" }));
    const rehab = card.getByRole("link", { name: /שיפוץ עד היום/ });
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
    expect(screen.getByRole("heading", { name: "הלוואות" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /הלוואה/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "+ הוספת הלוואה" })).toBeInTheDocument();
  });

  it("shows only the loans for the overhead project", async () => {
    serve(payload({}, { is_overhead: true }));
    renderPage();
    await screen.findByRole("heading", { name: "הלוואות" });
    expect(screen.queryByText("נתוני הנכס")).not.toBeInTheDocument();
    expect(screen.queryByText("הון עצמי היום")).not.toBeInTheDocument();
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
    await screen.findByText("הון בנכס");
    fireEvent.click(screen.getByRole("button", { name: /^שווי אחרי שיפוץ/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("₪437,600")).toBeInTheDocument();
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
    fireEvent.click(screen.getByRole("button", { name: /מחיר רכישה/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /שווי היום/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: 130_000_000 } });
  });

  it("names the figure and says what it is", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /שווי אחרי שיפוץ/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("שווי אחרי שיפוץ (ARV)")).toBeInTheDocument();
    expect(within(dialog).getByText("כמה הנכס יהיה שווה כשהשיפוץ יסתיים. משמש לחישוב ההשבחה הצפויה.")).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: /נכון לתאריך/ })).not.toBeInTheDocument();
  });

  it("saves the figure when the sheet closes", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /שווי אחרי שיפוץ/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("לא הצלחנו לשמור את מחיר רכישה.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "סכום" })).toBeInTheDocument();
  });

  it("says when the save is refused", async () => {
    serve(payload(), { data: null, error: { message: "forbidden", code: "42501" } });
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(INVESTMENT_REFUSED)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "סכום" })).toBeInTheDocument();
  });

  it("holds an emptied figure on the first close and discards it on the second", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /מחיר רכישה/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /מחיר רכישה/ }));
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: null } });
  });

  it("clears today's value and its date together", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /שווי היום/ }));
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { value_minor: null, value_date: null } });
  });

  it("saves today's value with its date, which starts on today", async () => {
    serve();
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /שווי היום/ }));
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
    fireEvent.click(screen.getByRole("button", { name: /שווי היום/ }));
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

  it("offers no suggestion to a viewer", async () => {
    serve(payload(), null, returnsOf({}, { landMinor: null, landSource: null, landTypedMinor: null, landSuggestion: { accountId: "acc-land", name: "קרקע לדוגמה", minor: 30_000_000n } }));
    renderPage({ viewer: true });
    await ready();
    await screen.findByText("הון בנכס");
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
    const { container } = renderPage();
    await ready();
    const card = within(container.querySelector('[aria-label="הלוואות"]') as HTMLElement);
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
