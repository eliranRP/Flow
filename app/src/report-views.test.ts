import { describe, expect, it } from "vitest";
import {
  REPORTS_BALANCE,
  REPORTS_BY_PROJECT,
  REPORTS_CEDAR,
  REPORTS_MONTHS,
  REPORTS_OCTOBER,
  REPORTS_PROJECT_IDS,
  REPORTS_PROJECT_SHEETS,
  REPORTS_STATEMENT,
} from "./dev/reports-sample";
import { equityTotal } from "./reports";
import {
  balancePath,
  balanceProjectRows,
  balanceRouteOf,
  generalStatementRow,
  groupsNet,
  legacyReportsTarget,
  monthNeighbours,
  monthRange,
  netTotal,
  pnlMonthRows,
  pnlPath,
  pnlProjectGroups,
  pnlRouteOf,
  reportBackPath,
  reportProjectId,
  sheetEquity,
  shareStateOf,
  statementGroups,
} from "./report-views";

const CEDAR = REPORTS_PROJECT_IDS.cedar;
const at = (search: string) => new URLSearchParams(search);

describe("the reports' routes (BUILD-PLAN §5)", () => {
  it("reads the P&L's view, period and drill-down, and writes them back", () => {
    expect(pnlRouteOf(at(""))).toEqual({ period: { kind: "year" }, view: "category", drill: null });
    expect(pnlRouteOf(at("view=month&period=last_year"))).toEqual({ period: { kind: "last_year" }, view: "month", drill: null });
    expect(pnlRouteOf(at(`view=category&project=${CEDAR}`))).toEqual({ period: { kind: "year" }, view: "project", drill: { kind: "project", key: CEDAR } });
    expect(pnlRouteOf(at("project=overhead")).drill).toEqual({ kind: "project", key: "overhead" });
    expect(pnlRouteOf(at("month=2026-10")).drill).toEqual({ kind: "month", month: "2026-10" });
    expect(pnlRouteOf(at("month=2026-13&project=nope&view=bogus"))).toEqual({ period: { kind: "year" }, view: "category", drill: null });
    for (const search of ["?view=project", `?view=project&period=quarter&project=${CEDAR}`, "?view=month&period=custom&from=2026-01-01&to=2026-06-30&month=2026-03"]) {
      expect(pnlPath(pnlRouteOf(at(search.slice(1))))).toBe(`/reports/pnl${search}`);
    }
  });

  it("reads the balance sheet's view, date and property, and keeps a preview query", () => {
    expect(balanceRouteOf(at(""))).toEqual({ asOf: { kind: "today" }, view: "assets", project: null });
    expect(balanceRouteOf(at(`project=${CEDAR}&asof=last_month`))).toEqual({ asOf: { kind: "last_month" }, view: "project", project: CEDAR });
    // A general key is a P&L row only: the balance sheet has none.
    expect(balanceRouteOf(at("project=overhead")).project).toBeNull();
    expect(balancePath({ asOf: { kind: "today" }, view: "liabilities", project: null }, "?preview=empty")).toBe("/reports/balance?view=liabilities&preview=empty");
  });

  it("sends an old link on to its report with its state", () => {
    expect(legacyReportsTarget(at(""))).toBeNull();
    // The hub keeps its own period.
    expect(legacyReportsTarget(at("period=last_month&preview=empty"))).toBeNull();
    expect(legacyReportsTarget(at("kind=balance"))).toBe("/reports/balance?view=assets");
    expect(legacyReportsTarget(at(`kind=balance&asof=custom&date=2026-06-30&scope=project&project=${CEDAR}`))).toBe(`/reports/balance?view=project&asof=custom&date=2026-06-30&project=${CEDAR}`);
    expect(legacyReportsTarget(at("scope=by_project&period=quarter"))).toBe("/reports/pnl?view=project&period=quarter");
    // The project band's דוחות link (reportsTo), with the preview it carries.
    expect(legacyReportsTarget(at(`scope=project&project=${CEDAR}&preview=empty`))).toBe(`/reports/pnl?view=project&project=${CEDAR}&preview=empty`);
    expect(legacyReportsTarget(at("kind=pnl"))).toBe("/reports/pnl?view=category");
  });

  it("keeps the report's choices on the way back from its lines and accounts", () => {
    expect(reportBackPath("pnl", `?view=project&project=${CEDAR}&side=expense&category=c-tax&lfrom=2026-01-01&lto=2026-10-31&cur=USD`, ["side", "category", "lfrom", "lto", "cur"])).toBe(`/reports/pnl?view=project&project=${CEDAR}`);
    // The lines page's own split by project adds a project; Back drops it.
    expect(reportBackPath("pnl", `?view=category&side=income&scope=project&project=${CEDAR}`, ["side"])).toBe("/reports/pnl?view=category");
    expect(reportBackPath("balance", "kind=balance&asof=last_month&account=l-loan&cur=USD", ["account", "cur"])).toBe("/reports/balance?asof=last_month");
    expect(reportProjectId(at(`project=${CEDAR}`))).toBe(CEDAR);
    expect(reportProjectId(at("project=overhead"))).toBeNull();
  });

  it("gives the share sheet the report and its project", () => {
    expect(shareStateOf("pnl", { kind: "year" }, { kind: "today" }, CEDAR, true).scope).toEqual({ kind: "project", id: CEDAR });
    expect(shareStateOf("pnl", { kind: "year" }, { kind: "today" }, null, true).scope).toEqual({ kind: "by_project" });
    expect(shareStateOf("balance", { kind: "year" }, { kind: "today" }, "overhead", true).scope).toEqual({ kind: "all" });
  });
});

describe("the P&L's views", () => {
  const [row] = REPORTS_STATEMENT.currencies;
  if (row == null) throw new Error("the sample has a statement");

  it("lists the category view as income, the plain expenses, then each parent category, adding up to the net", () => {
    const groups = statementGroups(row);
    expect(groups.map((group) => group.title)).toEqual(["הכנסות", "הוצאות אחרות", "הוצאות הנכסים", "הוצאות כלליות"]);
    expect(groupsNet(groups)).toBe(row.net_minor);
    for (const group of groups) expect(group.rows.reduce((sum, item) => sum + item.amount, 0n)).toBe(group.total);
  });

  it("splits by project, the general expenses in their own group, so the groups add up to the whole", () => {
    const groups = pnlProjectGroups(REPORTS_BY_PROJECT, "USD");
    expect(groups.projects.map((project) => project.name)).toEqual(["Cedar St", "Maple Ave", "Oak Ridge", "Riverside Commons Phase Two Townhomes"]);
    expect(groups.general).toEqual([{ key: "overhead", name: "הוצאות כלליות", income: 0n, expense: 580_000n, net: -580_000n }]);
    expect(netTotal(groups.projects)).toBe(3_480_000n);
    expect(netTotal(groups.projects) + netTotal(groups.general)).toBe(row.net_minor);
  });

  it("drills a project into its own P&L whose totals equal the row tapped", () => {
    const tapped = pnlProjectGroups(REPORTS_BY_PROJECT, "USD").projects.find((project) => project.key === CEDAR);
    const [own] = REPORTS_CEDAR.currencies;
    if (tapped == null || own == null) throw new Error("Cedar St is in the sample");
    const groups = statementGroups(own);
    expect(groupsNet(groups)).toBe(tapped.net);
    expect(groups.find((group) => group.key === "income")?.total).toBe(tapped.income);
    expect(groups.filter((group) => group.tone === "cost").reduce((sum, group) => sum + group.total, 0n)).toBe(tapped.expense);
  });

  it("drills the general expenses from the by-project read itself", () => {
    const general = generalStatementRow(REPORTS_BY_PROJECT, "overhead", "USD");
    if (general == null) throw new Error("the sample has overhead");
    expect(groupsNet(statementGroups(general))).toBe(-580_000n);
    expect(generalStatementRow(REPORTS_BY_PROJECT, "unassigned", "USD")).toBeNull();
  });

  it("lists the months newest first, and a month's drill-down adds up to its row", () => {
    const rows = pnlMonthRows(REPORTS_MONTHS, "USD");
    expect(rows[0]).toEqual({ key: "2026-10", name: "אוקטובר 2026", income: 960_000n, expense: 580_000n, net: 380_000n });
    expect(netTotal(rows)).toBe(row.net_minor);
    const [october] = REPORTS_OCTOBER.currencies;
    if (october == null) throw new Error("the sample has October");
    expect(groupsNet(statementGroups(october))).toBe(rows[0]?.net);
  });

  it("reads a month to its last day, or to today in the current month", () => {
    expect(monthRange("2026-02", "2026-10-31")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(monthRange("2026-10", "2026-10-15")).toEqual({ from: "2026-10-01", to: "2026-10-15" });
  });

  it("finds a drilled month's neighbours among the listed months, or none at either end (FLOW-1092)", () => {
    const keys = ["2026-10", "2026-09", "2026-07"];
    expect(monthNeighbours(keys, "2026-09")).toEqual({ earlier: "2026-07", later: "2026-10" });
    expect(monthNeighbours(keys, "2026-10")).toEqual({ earlier: "2026-09", later: null });
    expect(monthNeighbours(keys, "2026-07")).toEqual({ earlier: null, later: "2026-09" });
    // A month with no row of its own (August) still steps to the months around it.
    expect(monthNeighbours(keys, "2026-08")).toEqual({ earlier: "2026-07", later: "2026-09" });
    expect(monthNeighbours([], "2026-08")).toEqual({ earlier: null, later: null });
  });
});

describe("the balance sheet by project", () => {
  const [company] = REPORTS_BALANCE.currencies;
  if (company == null) throw new Error("the sample has a sheet");

  it("lists each property's equity, largest first, then the rest, adding up to the company's equity", () => {
    const rows = balanceProjectRows(company, REPORTS_PROJECT_SHEETS);
    expect(rows.map((item) => [item.name, item.equity])).toEqual([
      ["Oak Ridge", 9_570_000n],
      ["Cedar St", 8_660_000n],
      ["Maple Ave", 6_370_000n],
      ["בנק ושאר", 3_900_000n],
    ]);
    expect(rows.reduce((sum, item) => sum + item.equity, 0n)).toBe(equityTotal(company));
  });

  it("drills a property into its own sheet whose equity equals the row tapped", () => {
    const oak = REPORTS_PROJECT_SHEETS.find((sheet) => sheet.project_id === REPORTS_PROJECT_IDS.oak)?.currencies[0];
    if (oak == null) throw new Error("Oak Ridge is in the sample");
    expect(sheetEquity(oak)).toBe(balanceProjectRows(company, REPORTS_PROJECT_SHEETS)[0]?.equity);
  });
});
