import { projectDetailSchema } from "@flow/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { InvestmentCard, INVESTMENT_ERROR } from "../ui/investment-card";
import { FILLED } from "../ui/investment-card.stories-support";
import { shiftDays, israelToday } from "../ui/date-math";
import { ToastProvider } from "../ui/toast";
import { ViewerPreview } from "../use-is-viewer";
import { ProjectDetailScreen } from "./project-detail-screen";
import {
  EMPTY_HOLD,
  INVESTMENT_REFUSED,
  ProjectInvestmentSection,
  REHAB_TOTAL_ONLY,
  editVerdict,
  rawToMinor,
  rehabBreakdown,
} from "./project-investment";

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
  state_label: "פעיל",
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

function parsed(inv: Record<string, unknown> = {}, extra: Record<string, unknown> = {}) {
  const project = projectDetailSchema.parse(payload(inv, extra));
  if (project == null) throw new Error("project");
  return project;
}

function wrap(node: React.ReactNode, entry = "/projects/p1") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <MemoryRouter initialEntries={[entry]}>{node}</MemoryRouter>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

function renderSection(project = parsed(), options: { viewer?: boolean; entry?: string } = {}) {
  const section = <ProjectInvestmentSection project={project} />;
  return wrap(options.viewer === true ? <ViewerPreview>{section}</ViewerPreview> : section, options.entry);
}

function renderPage() {
  return wrap(
    <Routes>
      <Route path="/projects/:projectId" element={<ProjectDetailScreen />} />
    </Routes>,
  );
}

function saves(): Call[] {
  return rpc.calls.filter((call) => call.name === "set_project_investment");
}

function basisOf(call: Call): string | undefined {
  return (call.args as { p_basis?: string } | undefined)?.p_basis;
}

describe("the card", () => {
  it("shows the figures the project page read", () => {
    renderSection();
    expect(screen.getByText("₪1,250,000")).toBeInTheDocument();
    expect(screen.getByText("מתחילת הפרויקט")).toBeInTheDocument();
    expect(screen.getByText("₪1,900,000")).toBeInTheDocument();
    expect(screen.getByText("₪337,600")).toBeInTheDocument();
    expect(screen.getByText("₪850,000")).toBeInTheDocument();
    expect(screen.getByText("01/10/2026")).toBeInTheDocument();
    expect(rpc.calls).toHaveLength(0);
  });

  it("names a missing figure instead of an equity, and offers הוספה", () => {
    renderSection(parsed({ arv_minor: null, forced_equity_minor: null }));
    expect(screen.getByText("חסר שווי אחרי שיפוץ")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /שווי אחרי שיפוץ.*הוספה/ })).toBeInTheDocument();
    expect(screen.queryByText("₪0")).not.toBeInTheDocument();
  });

  it("says another currency blocks the equity and lists the loan apart", () => {
    renderSection(parsed({ loan_balance_other_currencies: [{ currency: "USD", balance_minor: 12_000_000 }], current_equity_minor: null }));
    expect(screen.getByText("לא מחושב, יש הלוואה בדולר")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /יתרת הלוואות/ })).toHaveTextContent("ועוד $120,000 בדולר");
  });

  it("is read-only for a viewer: no chevrons, no הוספה, nothing opens", () => {
    const { container } = renderSection(parsed({ arv_minor: null, forced_equity_minor: null }), { viewer: true });
    const card = container.querySelector(".ui-invest") as HTMLElement;
    expect(within(card).queryAllByRole("button")).toHaveLength(0);
    expect(within(card).queryByText("הוספה")).not.toBeInTheDocument();
    expect(card.querySelector(".ui-row-chevron")).toBeNull();
  });

  it("keeps the loans row static when there is no loan at all", () => {
    renderSection(parsed({ loan_balance_minor: 0 }, { loans: [] }));
    expect(screen.queryByRole("button", { name: /יתרת הלוואות/ })).not.toBeInTheDocument();
    expect(screen.getByText("יתרת הלוואות")).toBeInTheDocument();
  });

  it("draws nothing in a preview", () => {
    const { container } = renderSection(parsed(), { entry: "/projects/p1?preview=loading" });
    expect(container.querySelector(".ui-invest")).toBeNull();
  });

  it("shows an error with a retry", () => {
    const retry = vi.fn();
    render(<MemoryRouter><InvestmentCard state="error" figures={null} onRetry={retry} /></MemoryRouter>);
    expect(screen.getByText(INVESTMENT_ERROR)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "ניסיון חוזר: השקעה" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("says loading while the card waits", () => {
    render(<MemoryRouter><InvestmentCard state="loading" /></MemoryRouter>);
    expect(screen.getByRole("status")).toHaveTextContent("טוען…");
  });
});

describe("the project page", () => {
  it("shows the card under the categories from its one get_project read", async () => {
    rpc.impl = (name) => Promise.resolve({ data: name === "get_project" ? payload() : [], error: null });
    const { container } = renderPage();
    expect(await screen.findByText("₪1,250,000")).toBeInTheDocument();
    const heads = [...container.querySelectorAll("h2")].map((node) => node.textContent);
    expect(heads.indexOf("השקעה")).toBeGreaterThan(heads.indexOf("הוצאות לפי קטגוריה"));
    expect(heads.indexOf("השקעה")).toBeLessThan(heads.indexOf("תנועות"));
    const reads = rpc.calls.filter((call) => call.name === "get_project");
    expect(reads.every((call) => basisOf(call) !== "cash")).toBe(true);
  });

  it("shows no card on the overhead project, not even a skeleton", async () => {
    rpc.impl = (name) => Promise.resolve({ data: name === "get_project" ? payload({}, { is_overhead: true }) : [], error: null });
    const { container } = renderPage();
    await screen.findByText("הוצאות לפי קטגוריה");
    expect(container.querySelector(".ui-invest")).toBeNull();
  });

  it("parses an older payload with no investment and shows no card", async () => {
    rpc.impl = (name) => Promise.resolve({ data: name === "get_project" ? { ...base, is_overhead: undefined } : [], error: null });
    const { container } = renderPage();
    await screen.findByText("הוצאות לפי קטגוריה");
    expect(container.querySelector(".ui-invest")).toBeNull();
  });

  it("shows the new figure after a save", async () => {
    let purchase = 125_000_000;
    rpc.impl = (name, args) => {
      if (name === "set_project_investment") {
        purchase = (args as { p_patch: { purchase_minor: number } }).p_patch.purchase_minor;
        return Promise.resolve({ data: { before: {}, after: {} }, error: null });
      }
      return Promise.resolve({ data: name === "get_project" ? payload({ purchase_minor: purchase }) : [], error: null });
    };
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: /מחיר קנייה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "מחיר קנייה" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText("₪1,300,000")).toBeInTheDocument();
  });
});

describe("the edit sheet", () => {
  it("saves only the edited figure on שמירה", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /מחיר קנייה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "מחיר קנייה" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: 130_000_000 } });
  });

  it("saves the figure when the sheet closes", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /שווי אחרי שיפוץ/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "שווי אחרי שיפוץ" }), { target: { value: "2000000" } });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { arv_minor: 200_000_000 } });
    await waitFor(() => { expect(screen.queryByRole("textbox", { name: "שווי אחרי שיפוץ" })).not.toBeInTheDocument(); });
  });

  it("keeps the sheet open on a failed save and names the figure", async () => {
    rpc.impl = () => Promise.resolve({ data: null, error: { message: "boom" } });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /מחיר קנייה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "מחיר קנייה" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText("לא הצלחנו לשמור את מחיר קנייה.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "מחיר קנייה" })).toBeInTheDocument();
  });

  it("says when the save is refused", async () => {
    rpc.impl = () => Promise.resolve({ data: null, error: { message: "forbidden", code: "42501" } });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /מחיר קנייה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "מחיר קנייה" }), { target: { value: "1300000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    expect(await screen.findByText(INVESTMENT_REFUSED)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "מחיר קנייה" })).toBeInTheDocument();
  });

  it("holds an emptied figure on the first close and discards it on the second", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /מחיר קנייה/ }));
    fireEvent.change(await screen.findByRole("textbox", { name: "מחיר קנייה" }), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(await screen.findByText(EMPTY_HOLD)).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "מחיר קנייה" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    await waitFor(() => { expect(screen.queryByRole("textbox", { name: "מחיר קנייה" })).not.toBeInTheDocument(); });
    expect(saves()).toHaveLength(0);
  });

  it("clears a figure with null on מחיקה", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /מחיר קנייה/ }));
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { purchase_minor: null } });
  });

  it("clears today's value and its date together", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /שווי היום/ }));
    fireEvent.click(await screen.findByRole("button", { name: "מחיקה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { value_minor: null, value_date: null } });
  });

  it("saves today's value with its date, which starts on today", async () => {
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /שווי היום/ }));
    expect(await screen.findByText(/היום ·/)).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "שווי היום" }), { target: { value: "1700000" } });
    fireEvent.click(screen.getByRole("button", { name: "שמירה" }));
    await waitFor(() => { expect(saves()).toHaveLength(1); });
    expect(saves()[0]?.args).toEqual({ p_project_id: "p1", p_patch: { value_minor: 170_000_000, value_date: israelToday() } });
  });

  it("saves only the date when only the date changed", async () => {
    renderSection();
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
    if (options.hold === true) return new Promise(() => undefined);
    if (options.fail === true) return Promise.resolve({ data: null, error: { message: "boom" } });
    if (name === "get_project" && basisOf({ name, args }) === "cash") return Promise.resolve({ data: { ...base, ...(options.costs ?? costs) }, error: null });
    if (name === "list_categories") return Promise.resolve({ data: rehabCategories, error: null });
    return Promise.resolve({ data: null, error: null });
  };
}

describe("the rehab sheet", () => {
  it("reads the costs only while it is open", async () => {
    serveRehab();
    renderSection();
    expect(rpc.calls).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
    expect(await screen.findByText("חומרים")).toBeInTheDocument();
    expect(rpc.calls.find((call) => call.name === "get_project")?.args).toEqual({ p_id: "p1", p_basis: "cash" });
  });

  it("lists the counted categories, then the left-out ones with why", async () => {
    serveRehab();
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
    expect(await screen.findByText("לא נספרות בשיפוץ")).toBeInTheDocument();
    expect(screen.getByText("בלי קטגוריה")).toBeInTheDocument();
    expect(screen.getByText("מחוץ לרווח והפסד")).toBeInTheDocument();
    expect(screen.getByText("חלק מתשלום הלוואה")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "מה נספר בשיפוץ? בהגדרות הקטגוריות" })).toHaveAttribute("href", "/settings/categories");
  });

  it("opens a counted category's lines all time on the cash basis (FLOW-404)", async () => {
    serveRehab();
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
    const materials = await screen.findByRole("link", { name: /חומרים/ });
    expect(materials).toHaveAttribute("href", "/projects/p1/categories/c-mat?period=all&basis=cash");
    // A line with no category opens nothing, and keeps the chevron's space so the amounts line up.
    const none = screen.getByText("בלי קטגוריה").closest(".ui-row");
    expect(none?.tagName).not.toBe("A");
    expect(none?.querySelector(".ui-row-chevron-space")).not.toBeNull();
  });

  it("says loading while it reads", async () => {
    serveRehab({ hold: true });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("status")).toHaveTextContent("טוען…");
  });

  it("offers a retry when the read fails", async () => {
    serveRehab({ fail: true });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
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
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /שיפוץ עד היום/ }));
    expect(await screen.findByText(REHAB_TOTAL_ONLY)).toBeInTheDocument();
    expect(screen.queryByText("חומרים")).not.toBeInTheDocument();
  });
});

describe("the loans sheet", () => {
  it("lists the open loans, and other currencies apart", async () => {
    renderSection(parsed(
      { loan_balance_minor: 110_000_000, loan_balance_other_currencies: [{ currency: "USD", balance_minor: 12_000_000 }], current_equity_minor: null },
      {
        loans: [
          { id: "l1", name: "הלוואה בשקלים", currency: "ILS", balance_minor: 110_000_000, status: "open" },
          { id: "l2", name: "הלוואה בדולר", currency: "USD", balance_minor: 12_000_000, status: "open" },
          { id: "l3", name: "הלוואה שנסגרה", currency: "ILS", balance_minor: 0, status: "closed" },
        ],
      },
    ));
    fireEvent.click(screen.getByRole("button", { name: /יתרת הלוואות/ }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("הלוואה בשקלים")).toBeInTheDocument();
    expect(within(dialog).getByText("במטבע אחר")).toBeInTheDocument();
    expect(within(dialog).getByText("הלוואה בדולר")).toBeInTheDocument();
    expect(within(dialog).queryByText("הלוואה שנסגרה")).not.toBeInTheDocument();
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
    expect(result.left).toEqual([expect.objectContaining({ name: "רכישת נכס", reason: "מחוץ לרווח והפסד" })]);
    expect(result.addsUp).toBe(true);
    expect(rehabBreakdown(rows, categories, "ILS", 999n).addsUp).toBe(false);
  });

  it("keeps the sample figures consistent", () => {
    expect(FILLED.forcedEquityMinor).toBe((FILLED.arvMinor ?? 0n) - (FILLED.purchaseMinor ?? 0n) - FILLED.rehabMinor);
  });
});
