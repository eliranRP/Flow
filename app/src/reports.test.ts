import { describe, expect, it } from "vitest";
import { REPORTS_BALANCE, REPORTS_BALANCE_SUSPENSE, REPORTS_EMPTY, REPORTS_STATEMENT, REPORTS_STATEMENT_ROW } from "./dev/reports-sample";
import {
  accountName,
  balanceChipLabel,
  balanceDate,
  balanceEmpty,
  balanceWarning,
  equityTotal,
  marginPercent,
  pnlChipLabel,
  pnlPresetLabel,
  pnlRange,
  projectKeyName,
  rangeDays,
  readCollapsed,
  reportSearch,
  reportStateOf,
  statementEmpty,
  statementSectionIds,
  writeCollapsed,
} from "./reports";

const TODAY = "2026-10-29";
const ID = "a0000000-0000-4000-8000-000000000161";

describe("the report's choices in the URL", () => {
  it("defaults to this year's P&L of every project", () => {
    expect(reportStateOf(new URLSearchParams(""))).toEqual({ kind: "pnl", period: { kind: "year" }, asOf: { kind: "today" }, scope: { kind: "all" } });
    expect(reportSearch(reportStateOf(new URLSearchParams("")))).toBe("");
  });

  it("round-trips every choice", () => {
    for (const search of [
      "?kind=balance&asof=last_quarter&scope=project&project=" + ID,
      "?period=custom&from=2026-10-05&to=2026-10-20&scope=by_project",
      "?period=last_month",
      "?kind=balance&asof=custom&date=2026-06-30",
    ]) {
      expect(reportSearch(reportStateOf(new URLSearchParams(search)))).toBe(search);
    }
  });

  it("drops what it can't read: a reversed or impossible range, a bad id, an unknown preset", () => {
    expect(reportStateOf(new URLSearchParams("period=custom&from=2026-10-20&to=2026-10-05")).period).toEqual({ kind: "year" });
    expect(reportStateOf(new URLSearchParams("period=custom&from=2026-02-30&to=2026-03-05")).period).toEqual({ kind: "year" });
    expect(reportStateOf(new URLSearchParams("scope=project&project=nope")).scope).toEqual({ kind: "all" });
    expect(reportStateOf(new URLSearchParams("period=week&asof=yesterday")).period).toEqual({ kind: "year" });
    expect(reportStateOf(new URLSearchParams("asof=custom&date=2026-13-01")).asOf).toEqual({ kind: "today" });
  });
});

describe("preset dates", () => {
  it("are cut at today and use whole months and quarters", () => {
    expect(pnlRange({ kind: "month" }, TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(pnlRange({ kind: "last_month" }, TODAY)).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(pnlRange({ kind: "quarter" }, TODAY)).toEqual({ from: "2026-10-01", to: TODAY });
    expect(pnlRange({ kind: "year" }, TODAY)).toEqual({ from: "2026-01-01", to: TODAY });
    expect(pnlRange({ kind: "last_year" }, TODAY)).toEqual({ from: "2025-01-01", to: "2025-12-31" });
    expect(pnlRange({ kind: "all" }, TODAY)).toEqual({ from: null, to: null });
  });

  it("cross a year in January", () => {
    expect(pnlRange({ kind: "last_month" }, "2026-01-15")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(balanceDate({ kind: "last_quarter" }, "2026-02-10")).toBe("2025-12-31");
    expect(balanceDate({ kind: "last_month" }, "2026-03-31")).toBe("2026-02-28");
  });

  it("name themselves on the chip and in the sheet", () => {
    expect(pnlChipLabel({ kind: "year" }, TODAY)).toBe("השנה · 2026");
    expect(pnlChipLabel({ kind: "custom", from: "2026-10-05", to: "2026-10-20" }, TODAY)).toBe("05/10/2026–20/10/2026");
    expect(pnlPresetLabel("last_month", TODAY)).toEqual({ label: "חודש שעבר", dates: "ספטמבר 2026" });
    expect(balanceChipLabel({ kind: "custom", date: "2026-06-30" }, TODAY)).toBe("נכון ל־30/06/2026");
    expect(balanceChipLabel({ kind: "today" }, TODAY)).toBe("היום");
  });

  it("count a range's days with both ends", () => {
    expect(rangeDays("2026-10-05", "2026-10-20")).toBe(16);
    expect(rangeDays("2026-10-05", "2026-10-05")).toBe(1);
  });
});

describe("the P&L statement", () => {
  it("gives the margin on income, and none without income", () => {
    expect(marginPercent(REPORTS_STATEMENT_ROW)).toBe(30);
    expect(marginPercent({ income_minor: 0n, net_minor: -100n })).toBeNull();
  });

  it("knows an empty statement", () => {
    expect(statementEmpty(REPORTS_STATEMENT)).toBe(false);
    expect(statementEmpty(REPORTS_EMPTY)).toBe(true);
  });

  it("lists every section כיווץ הכל closes: the two sides and each parent", () => {
    expect(statementSectionIds(REPORTS_STATEMENT_ROW)).toEqual(["USD:income", "USD:expense", "USD:expense:c-props", "USD:expense:c-general"]);
  });

  it("names the overhead and unassigned keys", () => {
    expect(projectKeyName({ key: "overhead", name: null })).toBe("הוצאות כלליות");
    expect(projectKeyName({ key: "unassigned", name: null })).toBe("בלי פרויקט");
    expect(projectKeyName({ key: ID, name: "Cedar St" })).toBe("Cedar St");
  });
});

describe("the balance sheet", () => {
  it("names system accounts in Hebrew and keeps a company's own", () => {
    expect(accountName({ name: "Loan principal", is_system: true })).toBe("קרן הלוואה");
    expect(accountName({ name: "Bank/Clearing", is_system: true })).toBe("בנק");
    expect(accountName({ name: "Accumulated depreciation", is_system: true })).toBe("פחת שנצבר");
    expect(accountName({ name: "Deposits paid", is_system: false })).toBe("Deposits paid");
  });

  it("leads with owner equity plus the running profit", () => {
    const row = REPORTS_BALANCE.currencies[0];
    if (row == null) throw new Error("no row");
    expect(equityTotal(row)).toBe(28_500_000n);
    expect(row.total_assets_minor).toBe(row.total_liabilities_and_equity_minor);
  });

  it("says when Suspense is not zero", () => {
    const plain = REPORTS_BALANCE.currencies[0];
    const suspense = REPORTS_BALANCE_SUSPENSE.currencies[0];
    if (plain == null || suspense == null) throw new Error("no row");
    expect(balanceWarning(plain)).toBeNull();
    expect(balanceWarning(suspense)).toEqual({ amount: 125_000n, count: 1 });
    expect(balanceEmpty(REPORTS_BALANCE)).toBe(false);
    expect(balanceEmpty({ currencies: [] })).toBe(true);
  });
});

describe("collapsed sections", () => {
  it("are remembered per report", () => {
    writeCollapsed("pnl", new Set(["USD:income"]));
    writeCollapsed("balance", new Set(["USD:assets"]));
    expect([...readCollapsed("pnl")]).toEqual(["USD:income"]);
    expect([...readCollapsed("balance")]).toEqual(["USD:assets"]);
  });

  it("read as none when storage holds something else", () => {
    window.localStorage.setItem("flow.reports.collapsed.pnl", "{not json");
    expect(readCollapsed("pnl").size).toBe(0);
    window.localStorage.setItem("flow.reports.collapsed.pnl", JSON.stringify([1, "USD:expense"]));
    expect([...readCollapsed("pnl")]).toEqual(["USD:expense"]);
  });
});
