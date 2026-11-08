import { describe, expect, it } from "vitest";
import type { CashLine, ProjectCashRow, SearchRow } from "@flow/shared";
import type { ScheduleRow } from "./recurring-schedule";
import {
  budgetPercent,
  groupProjectRows,
  groupUnassignedRows,
  isOverBudget,
  kindFromType,
  kindLabel,
  netIn,
  orderActiveProjects,
  monthLineKey,
  projectLineGroups,
  projectMeta,
  projectsMonthTotals,
  resolveProjectKind,
  rowKind,
  suggestedProject,
  unassignedCountLabel,
} from "./project-list";

function row(over: Partial<ProjectCashRow> & { id: string; name: string }): ProjectCashRow {
  return {
    type: null,
    status: "active",
    is_overhead: false,
    group_id: null,
    created_at: "2026-09-01T00:00:00Z",
    finished_on: null,
    budget_minor: null,
    spent_minor: 0,
    cash: [],
    profit_month_minor: 0,
    profit_all_minor: 0,
    first_month: "2026-09-01",
    pending_count: 0,
    deletable: false,
    ...over,
  };
}

const ILS = "ILS";

describe("project list helpers (FLOW-445)", () => {
  it("meta is the type then the status, or פעיל when neither", () => {
    expect(projectMeta(row({ id: "a", name: "x", type: "flip", first_month: null }))).toBe("flip · חדש");
    expect(projectMeta(row({ id: "a", name: "x", type: "השכרה" }))).toBe("השכרה");
    expect(projectMeta(row({ id: "a", name: "x" }))).toBe("פעיל");
    expect(projectMeta(row({ id: "a", name: "x", type: "flip", status: "finished" }))).toBe("flip · הסתיים");
  });

  it("over budget only when spent is above the budget", () => {
    expect(isOverBudget({ budget_minor: 100, spent_minor: 101 })).toBe(true);
    expect(isOverBudget({ budget_minor: 100, spent_minor: 100 })).toBe(false);
    expect(isOverBudget({ budget_minor: null, spent_minor: 500 })).toBe(false);
  });

  it("new projects first (newest first), then by the month's cash size, ties by name", () => {
    const rows = [
      row({ id: "small", name: "Ashby Rd", cash: [{ currency: ILS, in_minor: 0, out_minor: 100, net_minor: -100 }] }),
      row({ id: "big", name: "Lark Hill", cash: [{ currency: ILS, in_minor: 0, out_minor: 900, net_minor: -900 }] }),
      row({ id: "newer", name: "Wren St", first_month: null, created_at: "2026-10-02T00:00:00Z" }),
      row({ id: "older", name: "Harrow Ln", first_month: null, created_at: "2026-10-01T00:00:00Z" }),
      row({ id: "fin", name: "Fenwick", status: "finished" }),
      row({ id: "over", name: "Overhead", is_overhead: true }),
    ];
    expect(orderActiveProjects(rows, ILS).map((r) => r.id)).toEqual(["newer", "older", "big", "small"]);
  });

  it("netIn reads one currency and is zero without a line", () => {
    expect(netIn([{ currency: ILS, in_minor: 5, out_minor: 0, net_minor: 5 }], ILS)).toBe(5);
    expect(netIn([], ILS)).toBe(0);
  });

  it("the unassigned link word follows the count", () => {
    expect(unassignedCountLabel(1)).toBe("שורה אחת בלי פרויקט");
    expect(unassignedCountLabel(3)).toBe("3 שורות בלי פרויקט");
  });
});

describe("project kind (FLOW-1044, plan §5)", () => {
  it("the overhead project is overhead whatever its type", () => {
    expect(resolveProjectKind({ overhead: true, type: "flip", budget: true })).toBe("overhead");
  });

  it("a type that names a kind wins over the data", () => {
    expect(resolveProjectKind({ overhead: false, type: "לקוח", budget: true })).toBe("client");
    expect(resolveProjectKind({ overhead: false, type: "flip" })).toBe("renovation");
    expect(resolveProjectKind({ overhead: false, type: "דירה להשכרה", value: false })).toBe("rental");
    expect(resolveProjectKind({ overhead: false, type: "תקורה" })).toBe("overhead");
    expect(kindFromType("מטבח")).toBeNull();
    expect(kindFromType(null)).toBeNull();
  });

  it("without a kind word: a budget or ARV is a renovation, rent or a value a rental, else a client", () => {
    expect(resolveProjectKind({ overhead: false, type: null, budget: true })).toBe("renovation");
    expect(resolveProjectKind({ overhead: false, type: "מטבח", arv: true })).toBe("renovation");
    expect(resolveProjectKind({ overhead: false, type: null, value: true })).toBe("rental");
    expect(resolveProjectKind({ overhead: false, type: null, rent: true })).toBe("rental");
    expect(resolveProjectKind({ overhead: false, type: null })).toBe("client");
  });

  it("a list row reads its type, its budget and the overhead flag", () => {
    expect(rowKind(row({ id: "a", name: "x", budget_minor: 100 }))).toBe("renovation");
    expect(rowKind(row({ id: "a", name: "x", type: "השכרה" }))).toBe("rental");
    expect(rowKind(row({ id: "a", name: "x" }))).toBe("client");
    expect(kindLabel("rental")).toBe("השכרה");
  });
});

describe("rows grouped by kind (FLOW-1044)", () => {
  const cash = (net: number) => [{ currency: ILS, in_minor: Math.max(net, 0), out_minor: Math.max(-net, 0), net_minor: net }];
  const rows = [
    row({ id: "lark", name: "Lark Hill", type: "flip", cash: cash(-900) }),
    row({ id: "tide", name: "Tidewater", type: "השכרה", cash: cash(300) }),
    row({ id: "okafor", name: "Okafor", cash: cash(4500) }),
    row({ id: "juniper", name: "Juniper Ct", budget_minor: 1000, cash: cash(-100) }),
    row({ id: "office", name: "Office", is_overhead: true, cash: cash(-500) }),
    row({ id: "wren", name: "Wren St", type: "flip", status: "finished", finished_on: "2026-09-30" }),
    row({ id: "ashby", name: "Ashby Rd", type: "flip", status: "finished", finished_on: "2026-10-15" }),
  ];

  it("active: the kinds in order, each group's rows in the list's order with its net", () => {
    const groups = groupProjectRows(rows, "active", ILS);
    expect(groups.map((group) => group.title)).toEqual(["שיפוץ", "השכרה", "לקוח", "תקורה"]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["lark", "juniper"]);
    expect(groups[0]?.net).toBe(-1000);
    expect(groups[3]?.rows.map((r) => r.id)).toEqual(["office"]);
  });

  it("finished: only the finished rows, the latest finished first; empty kinds are left out", () => {
    const groups = groupProjectRows(rows, "finished", ILS);
    expect(groups.map((group) => group.kind)).toEqual(["renovation"]);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["ashby", "wren"]);
  });

  it("all: active rows first, then the finished ones, in each kind", () => {
    const groups = groupProjectRows(rows, "all", ILS);
    expect(groups[0]?.rows.map((r) => r.id)).toEqual(["lark", "juniper", "ashby", "wren"]);
  });

  it("the band adds every project's month in the list's currency", () => {
    const totals = projectsMonthTotals({ month: "2026-10-01", base_currency: ILS, basis: "paid", projects: rows, unassigned: { count: 0, cash: [] } });
    expect(totals).toEqual({ in: 4800, out: 1500, net: 3300 });
  });

  it("budget percent floors, and is null with no budget", () => {
    expect(budgetPercent({ budget_minor: 1000, spent_minor: 829 })).toBe(82);
    expect(budgetPercent({ budget_minor: null, spent_minor: 829 })).toBeNull();
  });
});

describe("the project page's month lines (FLOW-1044)", () => {
  function charge(over: Partial<ScheduleRow> & { party_id: string; state: ScheduleRow["state"] }): ScheduleRow {
    return {
      direction: "expense",
      party_name: over.party_id,
      currency: ILS,
      typical_amount_minor: -1000,
      amount_minor: null,
      typical_day: 10,
      pace: "month",
      next_due_month: "2026-11",
      expected_by: "2026-11-10",
      project_id: "p1",
      project_name: "Lark Hill",
      category_id: null,
      category_name: null,
      ...over,
    };
  }
  function cashLine(id: string, recurring?: boolean): CashLine {
    return {
      transaction_id: id,
      part: null,
      description: id,
      supplier_name: null,
      project_name: null,
      category_name: null,
      doc_date: "2026-11-02",
      cash_month_date: "2026-11-02",
      currency: ILS,
      amount_minor: 500n,
      side: "out",
      recurring,
    };
  }
  const schedule = [
    charge({ party_id: "soon20", state: "soon", typical_day: 20 }),
    charge({ party_id: "late", state: "late", typical_day: 25 }),
    charge({ party_id: "soon5", state: "soon", typical_day: 5 }),
    charge({ party_id: "paid", state: "arrived", amount_minor: -980 }),
    charge({ party_id: "later", state: "later" }),
    charge({ party_id: "other", state: "soon", project_id: "p2" }),
  ];

  it("left holds the project's late then soon charges by day; paid the arrived ones", () => {
    const groups = projectLineGroups(schedule, [], "p1", "all");
    expect(groups.left.map((row) => row.party_id)).toEqual(["late", "soon5", "soon20"]);
    expect(groups.paid.map((row) => row.party_id)).toEqual(["paid"]);
  });

  it("הכול lists every line of the month, a recurring charge's too, newest first; the other filters none (FLOW-1112)", () => {
    const lines = [{ ...cashLine("a", true), cash_month_date: "2026-11-02" }, { ...cashLine("b", false), cash_month_date: "2026-11-05" }, cashLine("c")];
    expect(projectLineGroups(schedule, lines, "p1", "all").lines.map((line) => line.transaction_id)).toEqual(["b", "a", "c"]);
    expect(projectLineGroups(schedule, lines, "p1", "fixed").lines).toEqual([]);
    expect(projectLineGroups(schedule, lines, "p1", "left").lines).toEqual([]);
  });

  it("keys a line split between a counted and a kept-out part apart in the two reads (FLOW-1112)", () => {
    const counted = { ...cashLine("s"), in_pnl: true };
    const kept = { ...cashLine("s"), in_pnl: false };
    expect(monthLineKey(counted)).not.toBe(monthLineKey(kept));
    expect(monthLineKey({ ...cashLine("s"), part: "principal" })).toBe("s:principal:out:counted");
  });

  it("נותר לשלם keeps only what is left", () => {
    const groups = projectLineGroups(schedule, [], "p1", "left");
    expect(groups.paid).toEqual([]);
    expect(groups.left).toHaveLength(3);
  });
});

describe("lines with no project (FLOW-1044)", () => {
  function line(over: Partial<SearchRow> & { id: string; doc_date: string; amount_net: bigint }): SearchRow {
    return {
      description: "line",
      direction: "expense",
      currency: ILS,
      project_id: null,
      category_id: null,
      project_name: null,
      category_name: null,
      supplier_name: null,
      customer_name: null,
      waiting_review: false,
      kept_out: false,
      split_parts: 0,
      loan_matched: false,
      ...over,
    };
  }

  it("groups by month, newest first, each with its count and net", () => {
    const groups = groupUnassignedRows([
      line({ id: "a", doc_date: "2026-10-03", amount_net: -500n }),
      line({ id: "b", doc_date: "2026-11-02", amount_net: -1000n }),
      line({ id: "c", doc_date: "2026-10-20", amount_net: 300n, direction: "income" }),
      line({ id: "d", doc_date: "2026-10-21", amount_net: -900n, kept_out: true }),
    ]);
    expect(groups.map((group) => group.month)).toEqual(["2026-11", "2026-10"]);
    expect(groups[1]?.rows.map((r) => r.id)).toEqual(["d", "c", "a"]);
    expect(groups[1]?.net).toBe(-200n);
    expect(groups[0]?.net).toBe(-1000n);
  });

  it("suggests the one project its category names, and none when several or none do", () => {
    const projects = [{ id: "lark", name: "Lark Hill" }, { id: "tide", name: "Tidewater" }];
    expect(suggestedProject("Lark Hill · repairs", projects)?.id).toBe("lark");
    expect(suggestedProject("repairs", projects)).toBeNull();
    expect(suggestedProject(null, projects)).toBeNull();
    expect(suggestedProject("Lark Hill / Tidewater", projects)).toBeNull();
  });
});
