import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { shiftMonthKey } from "../period";
import { renderWithProviders } from "../test-render";
import { israelToday } from "../ui/date-math";
import { CashLinesScreen } from "./cash-lines-screen";

const rpc = vi.hoisted(() => ({
  calls: [] as Array<{ name: string; args: unknown }>,
  impl: (_name: string, _args?: unknown): Promise<{ data: unknown; error: { message: string } | null }> =>
    Promise.resolve({ data: null, error: null }),
}));

vi.mock("../lib/supabase", () => ({
  getSupabase: () => ({
    rpc: (name: string, args?: unknown) => {
      rpc.calls.push({ name, args });
      return rpc.impl(name, args);
    },
  }),
}));

const current = israelToday().slice(0, 7);
const earlier = shiftMonthKey(current, -1);

function currencyRow(currency: string, inMinor: number, outMinor: number, profit: number) {
  return {
    currency,
    in_minor: inMinor,
    out_minor: outMinor,
    net_minor: inMinor - outMinor,
    profit_minor: profit,
    excluded_count: 0,
    excluded_in_minor: 0,
    excluded_out_minor: 0,
  };
}

// Invented figures only.
const months = {
  basis: "paid",
  base_currency: "ILS",
  months: [
    { month: `${current}-01`, by_currency: [currencyRow("ILS", 1_800_000, 1_480_000, 560_000)] },
    { month: `${earlier}-01`, by_currency: [currencyRow("ILS", 100_000, 215_000, -40_000), currencyRow("USD", 0, 30_000, 0)] },
  ],
};

const lines = {
  rows: [
    {
      transaction_id: "t1",
      part: "principal",
      description: "תשלום הלוואה",
      supplier_name: "בנק לדוגמה",
      project_name: "בית לדוגמה",
      category_name: "קרן הלוואה",
      doc_date: `${earlier}-02`,
      cash_month_date: `${earlier}-03`,
      currency: "ILS",
      amount_minor: 120_000,
      side: "out",
      shared: false,
      source: "mercury",
      kept_out: false,
    },
  ],
  has_more: false,
};

// FLOW-1157: the project's row of the month, as projects_cash_month answers for one project.
const projectsMonth = {
  month: `${earlier}-01`,
  base_currency: "ILS",
  basis: "paid",
  projects: [{
    id: "p1", name: "בית לדוגמה", type: null, status: "active", is_overhead: false, group_id: null, created_at: `${earlier}-01T00:00:00Z`,
    finished_on: null, budget_minor: null, spent_minor: 0, cash: [], profit_month_minor: 0, profit_all_minor: 0, first_month: null,
    pending_count: 0, deletable: false,
  }],
  unassigned: { count: 0, cash: [] },
};

function wrap(path: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/cash/:month/:side/:currency" element={<CashLinesScreen />} />
      <Route path="/" element={<p>בית</p>} />
      <Route path="/projects/:projectId" element={<p>דף הפרויקט</p>} />
    </Routes>,
    { route: path },
  );
}

beforeEach(() => {
  rpc.calls = [];
  rpc.impl = (name) => {
    if (name === "cash_months") return Promise.resolve({ data: months, error: null });
    if (name === "cash_month_lines") return Promise.resolve({ data: lines, error: null });
    return Promise.resolve({ data: null, error: null });
  };
});

// FLOW-1111: a project page's נכנס and יצא open its own lines, with its month's figures.
describe("Cash lines of one project", () => {
  beforeEach(() => {
    rpc.impl = (name) => {
      if (name === "project_cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "project_cash_month_lines") return Promise.resolve({ data: lines, error: null });
      return Promise.resolve({ data: null, error: null });
    };
  });

  it("reads the project's lines and month, keeps the project on a side switch, and goes Back to its page", async () => {
    wrap(`/cash/${earlier}/out/ILS?project=p1`);
    expect(await screen.findByText("בנק לדוגמה")).toBeInTheDocument();
    expect(rpc.calls.find((c) => c.name === "project_cash_month_lines")?.args).toMatchObject({ p_project: "p1", p_month: `${earlier}-01`, p_side: "out" });
    expect(rpc.calls.some((c) => c.name === "project_cash_months")).toBe(true);
    expect(rpc.calls.some((c) => c.name === "cash_month_lines" || c.name === "cash_months")).toBe(false);
    // The rows need not name the project.
    expect(screen.queryByText(/בית לדוגמה/)).toBeNull();
    fireEvent.click(screen.getByRole("tab", { name: "נכנס" }));
    await waitFor(() => {
      expect(rpc.calls.some((c) => c.name === "project_cash_month_lines" && (c.args as { p_side: string }).p_side === "in")).toBe(true);
    });
    fireEvent.click(screen.getAllByRole("button", { name: /חזרה|חזור|back/i })[0] as HTMLElement);
    expect(await screen.findByText("דף הפרויקט")).toBeInTheDocument();
  });

  it("FLOW-1157: on a cold open, with no name in the cache, reads the project's row of the month for its name", async () => {
    rpc.impl = (name) => {
      if (name === "project_cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "project_cash_month_lines") return Promise.resolve({ data: lines, error: null });
      if (name === "projects_cash_month") return Promise.resolve({ data: projectsMonth, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    const { container } = wrap(`/cash/${earlier}/out/ILS?project=p1`);
    expect(await screen.findByText(/^בית לדוגמה • /u)).toBeInTheDocument();
    expect(rpc.calls.find((c) => c.name === "projects_cash_month")?.args).toMatchObject({ p_month: `${earlier}-01`, p_project: "p1" });
    expect(container.querySelector(".ui-lines-sub-name")).toBeNull();
    expect(screen.getAllByRole("button", { name: /בית לדוגמה/ }).length).toBeGreaterThan(0);
  });
});

describe("Cash lines", () => {
  it("asks for the month, side and currency, and lists the lines with no minus under יצא", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    expect(await screen.findByText("בנק לדוגמה")).toBeInTheDocument();
    expect(rpc.calls.find((c) => c.name === "cash_month_lines")?.args).toMatchObject({
      p_month: `${earlier}-01`,
      p_side: "out",
      p_currency: "ILS",
      p_offset: 0,
    });
    expect(screen.getByRole("heading", { name: "יצא" })).toBeInTheDocument();
    expect(screen.queryByText(/^−₪1,200/)).toBeNull();
    expect(screen.getByRole("link", { name: /בנק לדוגמה/ })).toHaveAttribute("href", "/transactions/t1");
  });

  it("goes Back to Home on an earlier month", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    await screen.findByText("בנק לדוגמה");
    fireEvent.click(screen.getByRole("button", { name: /חזרה|חזור|back/i }));
    expect(await screen.findByText("בית")).toBeInTheDocument();
  });

  it("switches currency in place", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    await screen.findByText("בנק לדוגמה");
    fireEvent.click(screen.getByRole("radio", { name: "USD" }));
    await waitFor(() => {
      expect(rpc.calls.some((c) => c.name === "cash_month_lines" && (c.args as { p_currency: string }).p_currency === "USD")).toBe(true);
    });
  });

  it("loads every page before it shows the totals and the groups (FLOW-366)", async () => {
    const page = (id: string) => ({ ...lines.rows[0], transaction_id: id, description: id, supplier_name: id });
    rpc.impl = (name, args) => {
      if (name === "cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "cash_month_lines") {
        const offset = (args as { p_offset: number }).p_offset;
        return Promise.resolve({
          data: offset === 0 ? { rows: [page("t-first")], has_more: true } : { rows: [page("t-second")], has_more: false },
          error: null,
        });
      }
      return Promise.resolve({ data: null, error: null });
    };
    wrap(`/cash/${earlier}/out/ILS`);
    expect(await screen.findByText("t-second")).toBeInTheDocument();
    expect(rpc.calls.filter((c) => c.name === "cash_month_lines").map((c) => (c.args as { p_offset: number }).p_offset)).toEqual([0, 200]);
    expect(rpc.calls.find((c) => c.name === "cash_month_lines")?.args).toMatchObject({ p_limit: 200 });
    expect(screen.queryByRole("button", { name: "עוד תנועות" })).toBeNull();
  });

  it("flips the side in place and keeps the order chip", async () => {
    wrap(`/cash/${earlier}/out/ILS?order=amount`);
    await screen.findByText("בנק לדוגמה");
    // FLOW-965: the side switch is a tab list (two views of the month), the order chips one choice.
    expect(screen.getAllByRole("tablist", { name: "כיוון" }).length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByRole("tab", { name: "נכנס" })[0] as HTMLElement);
    await waitFor(() => {
      expect(rpc.calls.some((c) => c.name === "cash_month_lines" && (c.args as { p_side: string }).p_side === "in")).toBe(true);
    });
  });

  it("sets the order from the chips, and groups by project with the largest first", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    await screen.findByText("בנק לדוגמה");
    const chips = () => screen.getAllByRole("radiogroup", { name: "סדר" })[0] as HTMLElement;
    expect(within(chips()).getByRole("radio", { name: "לפי תאריך" })).toHaveAttribute("aria-checked", "true");
    fireEvent.click(within(chips()).getByRole("radio", { name: "לפי פרויקט" }));
    expect(await screen.findByRole("heading", { name: "בית לדוגמה" })).toBeInTheDocument();
    expect(within(chips()).getByRole("radio", { name: "לפי פרויקט" })).toHaveAttribute("aria-checked", "true");
    expect(within(chips()).getByRole("radio", { name: "לפי תאריך" })).toHaveAttribute("tabindex", "-1");
  });

  it("moves the order with the arrow keys, right to left", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    await screen.findByText("בנק לדוגמה");
    const chips = () => screen.getAllByRole("radiogroup", { name: "סדר" })[0] as HTMLElement;
    const group = chips();
    group.style.direction = "rtl";
    const byDate = within(group).getByRole("radio", { name: "לפי תאריך" });
    // A key acts on the focused chip, as a keyboard does.
    byDate.focus();
    fireEvent.keyDown(byDate, { key: "ArrowLeft" });
    await waitFor(() => {
      expect(within(chips()).getByRole("radio", { name: "לפי פרויקט" })).toHaveAttribute("aria-checked", "true");
    });
  });

  it("Home and End jump to the first and the last order", async () => {
    wrap(`/cash/${earlier}/out/ILS`);
    await screen.findByText("בנק לדוגמה");
    const chips = () => screen.getAllByRole("radiogroup", { name: "סדר" })[0] as HTMLElement;
    const radios = () => within(chips()).getAllByRole("radio");
    const first = radios()[0] as HTMLElement;
    first.focus();
    fireEvent.keyDown(first, { key: "End" });
    await waitFor(() => {
      expect(radios().at(-1)).toHaveAttribute("aria-checked", "true");
    });
    const last = radios().at(-1) as HTMLElement;
    last.focus();
    fireEvent.keyDown(last, { key: "Home" });
    await waitFor(() => {
      expect(radios()[0]).toHaveAttribute("aria-checked", "true");
    });
  });
});

describe("Cash lines profit leaves out (FLOW-418)", () => {
  it("reads the not_in_profit side, shows net less profit, and gives money out its minus", async () => {
    const capital = { ...lines.rows[0], transaction_id: "t2", part: null, supplier_name: "שותף לדוגמה", category_name: "השקעת בעלים", amount_minor: 45_000, side: "in" };
    rpc.impl = (name) => {
      if (name === "cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "cash_month_lines") return Promise.resolve({ data: { rows: [lines.rows[0], capital], has_more: false }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    wrap(`/cash/${earlier}/kept/ILS`);
    expect(await screen.findByText("בנק לדוגמה")).toBeInTheDocument();
    expect(rpc.calls.find((c) => c.name === "cash_month_lines")?.args).toMatchObject({ p_side: "not_in_profit", p_currency: "ILS" });
    expect(screen.getByRole("heading", { name: "לא נספר ברווח" })).toBeInTheDocument();
    // Net −₪1,150 less profit −₪400; the month sends no categories, so all of it is the rest.
    expect(document.querySelector(".ui-breakdown-total")?.textContent).toMatch(/^−₪750$/);
    expect(screen.getByText(/מזה −₪750 מע״מ והפרשים/)).toBeInTheDocument();
    expect(screen.getByText("−₪1,200")).toBeInTheDocument();
    expect(screen.getByText("+₪450")).toHaveClass("ui-income");
  });
});

/** The sum a group head shows (the row amounts repeat the figure, so the head is read on its own). */
function groupSum(title: string) {
  const region = screen.getByRole("region", { name: title });
  return region.querySelector(".ui-lines-group-sum")?.textContent ?? null;
}

describe("Cash lines groups", () => {
  // Invented rows: two projects on one side, the larger total first.
  const group = (id: string, project: string, side: "in" | "out", amount: number) => ({
    ...lines.rows[0],
    transaction_id: id,
    supplier_name: id,
    project_name: project,
    side,
    amount_minor: amount,
  });

  it("sums each project group, plus on money in and none under יצא, largest group first (decision 0181)", async () => {
    const inRows = [group("i1", "בית צפון", "in", 300_000), group("i2", "בית צפון", "in", 50_000), group("i3", "בית דרום", "in", 120_000)];
    rpc.impl = (name) => {
      if (name === "cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "cash_month_lines") return Promise.resolve({ data: { rows: inRows, has_more: false }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    wrap(`/cash/${earlier}/in/ILS?order=project`);
    await screen.findByText("i1");
    const headings = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(headings).toEqual(["בית צפון", "בית דרום"]);
    expect(groupSum("בית צפון")).toBe("+₪3,500");
    expect(groupSum("בית דרום")).toBe("+₪1,200");
  });

  it("orders by recurring or one-off once every line carries FLOW-1035's flag, and hides the chip while it is undefined", async () => {
    const flagged = [{ ...group("r1", "בית צפון", "out", 80_000), recurring: true }, { ...group("o1", "בית דרום", "out", 20_000), recurring: false }];
    rpc.impl = (name) => {
      if (name === "cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "cash_month_lines") return Promise.resolve({ data: { rows: flagged, has_more: false }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    wrap(`/cash/${earlier}/out/ILS?order=recurring`);
    await screen.findByText("r1");
    expect(screen.getAllByRole("radio", { name: "קבוע / חד-פעמי" }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).toEqual(["קבועים", "חד-פעמי"]);
  });

  it("without the flag, has no recurring chip and orders ?order=recurring by date", async () => {
    const plain = [group("o1", "בית צפון", "out", 80_000)];
    rpc.impl = (name) => {
      if (name === "cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "cash_month_lines") return Promise.resolve({ data: { rows: plain, has_more: false }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    wrap(`/cash/${earlier}/out/ILS?order=recurring`);
    await screen.findByText("o1");
    expect(screen.queryByRole("radio", { name: "קבוע / חד-פעמי" })).toBeNull();
    expect(screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"))).not.toContain("קבועים");
  });

  it("shows the group sum on יצא with no sign, and orders the groups by their totals", async () => {
    const outRows = [group("o1", "בית צפון", "out", 80_000), group("o2", "בית דרום", "out", 200_000)];
    rpc.impl = (name) => {
      if (name === "cash_months") return Promise.resolve({ data: months, error: null });
      if (name === "cash_month_lines") return Promise.resolve({ data: { rows: outRows, has_more: false }, error: null });
      return Promise.resolve({ data: null, error: null });
    };
    wrap(`/cash/${earlier}/out/ILS?order=project`);
    await screen.findByText("o1");
    const headings = screen.getAllByRole("region").map((region) => region.getAttribute("aria-label"));
    expect(headings).toEqual(["בית דרום", "בית צפון"]);
    expect(groupSum("בית דרום")).toBe("₪2,000");
  });
});
