import { projectDetailSchema } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { birchLaneInvestment, birchLaneRehabCategories, birchLaneRehabCosts } from "../dev/investment-sample";
import { FILLED } from "../ui/investment-card.stories-support";
import { shiftDays, israelToday } from "../ui/date-math";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { categoryBack } from "./project-category-screen";
import { loanNote } from "./project-investment-cards";
import { REHAB_TOTAL_ONLY, rehabBreakdown, toProjectInvestment } from "./project-investment-data";
import { ProjectInvestmentScreen, INVESTMENT_REFUSED, applySample } from "./project-investment-screen";
import { EMPTY_HOLD, editVerdict, rawToMinor } from "./project-investment-sheets";

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
function serve(project: unknown = payload(), save: Result | null = null) {
  rpc.impl = (name) => {
    if (name === "set_project_investment" && save != null) return Promise.resolve(save);
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
  it("shows the equity card, the figures and the loans the project read", async () => {
    serve();
    renderPage();
    await ready();
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

  it("shows today's value split: equity share and the loans in the legend", async () => {
    serve();
    renderPage();
    await ready();
    expect(screen.getByText("52%")).toBeInTheDocument();
    expect(screen.getByText("הון עצמי היום")).toBeInTheDocument();
  });

  it("names a missing ARV instead of the השבחה, and offers הוספה", async () => {
    serve(payload({ arv_minor: null, forced_equity_minor: null }));
    renderPage();
    await ready();
    expect(screen.getByText("חסר שווי אחרי שיפוץ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /שווי אחרי שיפוץ.*הוספה/ })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "הוספה" })).toHaveLength(1);
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
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
    ));
    renderPage();
    await ready();
    expect(screen.getByText("לא מחושב, יש הלוואה בדולר")).toBeInTheDocument();
    expect(screen.getByText(/במטבע אחר/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /הלוואה בדולר/ })).toHaveTextContent("$120,000");
  });

  it("is read-only for a viewer: no chevrons, no הוספה, nothing opens", async () => {
    serve(payload({ arv_minor: null, forced_equity_minor: null }));
    const { container } = renderPage({ viewer: true });
    await ready();
    expect(container.querySelectorAll(".ui-pinv-card button")).toHaveLength(0);
    expect(screen.queryByText("הוספה")).not.toBeInTheDocument();
    expect(screen.queryByText("+ הוספת הלוואה")).not.toBeInTheDocument();
    expect(container.querySelector('[aria-label="נתוני הנכס"] .ui-pinv-chevron')).toBeNull();
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
      return Promise.resolve({ data: name === "get_project" ? payload({ arv_minor: arv, forced_equity_minor: forced }) : null, error: null });
    };
    renderPage();
    await ready();
    fireEvent.click(screen.getByRole("button", { name: /שווי אחרי שיפוץ/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "סכום" }), { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("₪437,600")).toBeInTheDocument();
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

const costs = {
  categories_by_currency: [
    { currency: "ILS", id: "c-mat", name: "חומרים", amount_minor: 20_000_000 },
    { currency: "ILS", id: null, name: null, amount_minor: 11_240_000 },
    { currency: "ILS", id: "c-int", name: "ריבית משכנתא", amount_minor: 2_160_000 },
  ],
  excluded_categories_by_currency: [{ currency: "ILS", id: "c-buy", name: "רכישת נכס", amount_minor: 125_000_000 }],
};

const rehabCategories = [
  { id: "c-mat", name: "חומרים", in_rehab: true, rehab: null },
  { id: "c-int", name: "ריבית משכנתא", in_rehab: false, rehab: null, loan_part: "interest" },
  { id: "c-buy", name: "רכישת נכס", in_rehab: false, rehab: null, excluded_from_pnl: true },
];

function serveRehab(options: { costs?: unknown; fail?: boolean; hold?: boolean } = {}) {
  rpc.impl = (name, args) => {
    if (name === "get_project" && basisOf({ name, args }) !== "cash") return Promise.resolve({ data: payload(), error: null });
    if (options.hold === true) return new Promise(() => undefined);
    if (options.fail === true) return Promise.resolve({ data: null, error: { message: "boom" } });
    if (name === "get_project") return Promise.resolve({ data: { ...base, ...(options.costs ?? costs) }, error: null });
    if (name === "list_categories") return Promise.resolve({ data: rehabCategories, error: null });
    return Promise.resolve({ data: null, error: null });
  };
}

async function openRehab(): Promise<void> {
  renderPage();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
}

describe("the rehab sheet", () => {
  it("reads the costs only while it is open", async () => {
    serveRehab();
    renderPage();
    await ready();
    expect(rpc.calls.some((call) => call.name === "list_categories" || basisOf(call) === "cash")).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
    expect(await screen.findByText("חומרים")).toBeInTheDocument();
    expect(rpc.calls.find((call) => basisOf(call) === "cash")?.args).toEqual({ p_id: "p1", p_basis: "cash" });
  });

  it("lists the counted categories, then the left-out ones with why", async () => {
    serveRehab();
    await openRehab();
    expect(await screen.findByText("ריבית משכנתא · לא נספרים בשיפוץ")).toBeInTheDocument();
    expect(screen.getByText("בלי קטגוריה")).toBeInTheDocument();
    expect(screen.getByText("רכישת נכס · לא נספר ברווח")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "מה נספר בשיפוץ? בהגדרות הקטגוריות" })).toHaveAttribute("href", "/settings/categories");
  });

  it("opens a counted category's lines all time on the cash basis (FLOW-404)", async () => {
    serveRehab();
    await openRehab();
    const materials = await screen.findByRole("link", { name: /חומרים/ });
    expect(materials).toHaveAttribute("href", "/projects/p1/categories/c-mat?period=all&basis=cash");
    // A line with no category opens nothing, and keeps the chevron's space so the amounts line up.
    expect(screen.getByText("בלי קטגוריה").closest("a")).toBeNull();
  });

  it("opens a left-out category's lines the same way", async () => {
    serveRehab();
    await openRehab();
    const interest = await screen.findByRole("link", { name: /ריבית משכנתא/ });
    expect(interest).toHaveAttribute("href", "/projects/p1/categories/c-int?period=all&basis=cash");
    expect(screen.getByRole("link", { name: /רכישת נכס/ })).toHaveAttribute("href", "/projects/p1/categories/c-buy?period=all&basis=cash");
  });

  it("brings Back from the lines to the investment screen on its period", async () => {
    serveRehab();
    function BackProbe() {
      const location = useLocation();
      return <p data-testid="back">{categoryBack("p1", "", location.state)}</p>;
    }
    wrap(
      <Routes>
        <Route path="/projects/:projectId/investment" element={<ProjectInvestmentScreen />} />
        <Route path="/projects/:projectId/categories/:categoryId" element={<BackProbe />} />
      </Routes>,
      "/projects/p1/investment?period=month&at=2026-09",
    );
    await screen.findByText("נתוני הנכס");
    fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
    fireEvent.click(await screen.findByRole("link", { name: /חומרים/ }));
    expect(await screen.findByTestId("back")).toHaveTextContent("/projects/p1/investment?period=month&at=2026-09");
  });

  it("reopens the rehab sheet on Back from a category's lines", async () => {
    serveRehab();
    function BackProbe() {
      const navigate = useNavigate();
      return <button type="button" onClick={() => { void navigate(-1); }}>חזרה</button>;
    }
    wrap(
      <Routes>
        <Route path="/projects/:projectId/investment" element={<ProjectInvestmentScreen />} />
        <Route path="/projects/:projectId/categories/:categoryId" element={<BackProbe />} />
      </Routes>,
      "/projects/p1/investment",
    );
    await screen.findByText("נתוני הנכס");
    fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
    fireEvent.click(await screen.findByRole("link", { name: /ריבית משכנתא/ }));
    fireEvent.click(await screen.findByRole("button", { name: "חזרה" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("שיפוץ עד היום")).toBeInTheDocument();
    expect(await within(dialog).findByText("חומרים")).toBeInTheDocument();
  });

  it("says loading while it reads", async () => {
    serveRehab({ hold: true });
    await openRehab();
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("status")).toHaveTextContent("טוען…");
  });

  it("offers a retry when the read fails", async () => {
    serveRehab({ fail: true });
    await openRehab();
    expect(await screen.findByText("לא הצלחנו לטעון את הפירוט.")).toBeInTheDocument();
    serveRehab();
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר: פירוט השיפוץ" }));
    expect(await screen.findByText("חומרים")).toBeInTheDocument();
  });

  it("shows only the total when the categories do not make it, as with loan fees in an ordinary category", async () => {
    // A fees part filed in חומרים (0130) is a loan part: the server leaves it out of rehab, the category list keeps it.
    serveRehab({
      costs: {
        categories_by_currency: [
          { currency: "ILS", id: "c-mat", name: "חומרים", amount_minor: 20_150_000 },
          { currency: "ILS", id: null, name: null, amount_minor: 11_240_000 },
        ],
        excluded_categories_by_currency: [],
      },
    });
    await openRehab();
    expect(await screen.findByText(REHAB_TOTAL_ONLY)).toBeInTheDocument();
    expect(screen.queryByText("חומרים")).not.toBeInTheDocument();
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
    expect(editVerdict("purchase", { minor: 100n, date: null }, { raw: "", date: "2026-10-08", dateTouched: false })).toEqual({ kind: "hold" });
    expect(editVerdict("purchase", { minor: null, date: null }, { raw: "", date: "2026-10-08", dateTouched: false })).toEqual({ kind: "clean" });
  });

  it("lists rehab by category and the left-out ones apart, and checks the sum", () => {
    const rows = [
      { id: "a", name: "חומרים", currency: "ILS", minor: 700n },
      { id: null, name: null, currency: "ILS", minor: 100n },
      { id: "b", name: "רכישת נכס", currency: "ILS", minor: 5_000n },
      { id: "a", name: "חומרים", currency: "ILS", minor: 200n },
      { id: "c", name: "חומרים", currency: "USD", minor: 300n },
    ];
    const categories = [
      { id: "a", name: "חומרים", in_rehab: true },
      { id: "b", name: "רכישת נכס", in_rehab: false, excluded_from_pnl: true },
    ];
    const result = rehabBreakdown(rows, categories, "ILS", 1_000n);
    expect(result.counted.map((line) => [line.name, line.minor])).toEqual([["חומרים", 900n], ["בלי קטגוריה", 100n]]);
    expect(result.left).toEqual([expect.objectContaining({ name: "רכישת נכס", reason: "לא נספר ברווח" })]);
    expect(result.addsUp).toBe(true);
    expect(rehabBreakdown(rows, categories, "ILS", 999n).addsUp).toBe(false);
  });

  it("keeps the sample figures consistent", () => {
    expect(FILLED.forcedEquityMinor).toBe((FILLED.arvMinor ?? 0n) - (FILLED.purchaseMinor ?? 0n) - FILLED.rehabMinor);
    const figures = birchLaneInvestment.figures;
    if (figures == null) throw new Error("sample figures");
    // The flip's counted categories add up to its rehab total; the loan payments are not counted.
    const breakdown = rehabBreakdown(birchLaneRehabCosts, birchLaneRehabCategories, "USD", figures.rehabMinor);
    expect(breakdown.addsUp).toBe(true);
    expect(breakdown.counted.reduce((sum, line) => sum + line.minor, 0n)).toBe(figures.rehabMinor);
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
