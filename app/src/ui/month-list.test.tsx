import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import { dayTitle, groupByDay, groupByMonth, type MonthAmount } from "./month-groups";
import { MonthList } from "./month-list";
import { expectRtl } from "./test-support";

type Row = { id: string; date: string; minor: bigint; currency: string; direction: "income" | "expense" };

const row = (id: string, date: string, minor: bigint, direction: Row["direction"], currency = "ILS"): Row => ({ id, date, minor, currency, direction });
const amountOf = (r: Row): MonthAmount => ({ minor: r.minor, currency: r.currency, direction: r.direction });
const dateOf = (r: Row) => r.date;

const NEWEST_FIRST: Row[] = [
  row("a", "2026-09-14", 1_200_000n, "income"),
  row("b", "2026-09-10", 350_000n, "expense"),
  row("c", "2026-08-28", 40_000n, "expense", "USD"),
  row("d", "2026-08-20", 150_000n, "income", "USD"),
  row("e", "2026-08-12", 220_000n, "expense"),
  row("f", "2026-08-05", 800_000n, "income"),
];

describe("groupByMonth", () => {
  it("groups newest first and totals each currency apart, ILS first", () => {
    const groups = groupByMonth(NEWEST_FIRST, dateOf, amountOf);
    expect(groups?.map((group) => group.title)).toEqual(["ספטמבר 2026", "אוגוסט 2026"]);
    expect(groups?.[0]?.totals).toEqual([{ currency: "ILS", incomeMinor: 1_200_000n, expenseMinor: 350_000n }]);
    expect(groups?.[1]?.totals).toEqual([
      { currency: "ILS", incomeMinor: 800_000n, expenseMinor: 220_000n },
      { currency: "USD", incomeMinor: 150_000n, expenseMinor: 40_000n },
    ]);
  });

  it("keeps the oldest-first order of the review queue", () => {
    const groups = groupByMonth([...NEWEST_FIRST].reverse(), dateOf, amountOf);
    expect(groups?.map((group) => group.key)).toEqual(["2026-08", "2026-09"]);
    expect(groups?.[0]?.rows.map((r) => r.id)).toEqual(["f", "e", "d", "c"]);
  });

  it("adds each row's shown whole-unit value, so the header matches the rows", () => {
    const groups = groupByMonth(
      [row("a", "2026-09-01", 10_050n, "expense"), row("b", "2026-09-02", 10_050n, "expense"), row("c", "2026-08-01", 100n, "income")],
      dateOf,
      amountOf,
    );
    // ₪100.50 shows as ₪100 (half to even) on each row, so the month shows ₪200, not ₪201.
    expect(groups?.[0]?.totals[0]?.expenseMinor).toBe(20_000n);
  });

  it("renders flat for one month, an unreadable date, or a month split into two runs", () => {
    expect(groupByMonth(NEWEST_FIRST.slice(0, 2), dateOf, amountOf)).toBeNull();
    expect(groupByMonth([row("a", "", 100n, "income"), ...NEWEST_FIRST], dateOf, amountOf)).toBeNull();
    const held = [NEWEST_FIRST[0], NEWEST_FIRST[2], NEWEST_FIRST[1]] as Row[];
    expect(groupByMonth(held, dateOf, amountOf)).toBeNull();
  });
});

function renderList(rows: Row[], complete?: boolean) {
  return render(
    <MonthList
      rows={rows}
      keyOf={(r) => r.id}
      dateOf={dateOf}
      amountOf={amountOf}
      complete={complete}
      renderRow={(r) => <p data-testid="row">{r.id}</p>}
    />,
  );
}

describe("MonthList", () => {
  it("names each month with a heading and shows income with no plus and − expenses per currency", () => {
    expectRtl();
    renderList(NEWEST_FIRST);
    expect(screen.getAllByRole("heading", { level: 2 }).map((node) => node.textContent)).toEqual(["ספטמבר 2026", "אוגוסט 2026"]);
    const august = screen.getByRole("group", { name: "אוגוסט 2026" });
    const totals = august.querySelector(".ui-month-totals");
    expect(totals?.textContent).toBe("הכנסות ₪8,000הוצאות −₪2,200הכנסות $1,500הוצאות −$400");
    expect(within(august).getAllByTestId("row").map((node) => node.textContent)).toEqual(["c", "d", "e", "f"]);
    for (const figure of august.querySelectorAll("bdi")) expect(figure.getAttribute("dir")).toBe("ltr");
  });

  it("leaves out a side that is zero", () => {
    renderList([row("a", "2026-09-01", 50_000n, "expense"), row("b", "2026-08-01", 70_000n, "income")]);
    const september = screen.getByRole("group", { name: "ספטמבר 2026" });
    expect(september.querySelector(".ui-month-totals")?.textContent).toBe("הוצאות −₪500");
    expect(document.body.textContent).not.toMatch(/[+−]₪0\b/);
  });

  it("leaves out a zero expense side too", () => {
    renderList([row("a", "2026-09-01", 50_000n, "income"), row("b", "2026-08-01", 70_000n, "expense")]);
    expect(screen.getByRole("group", { name: "ספטמבר 2026" }).querySelector(".ui-month-totals")?.textContent).toBe("הכנסות ₪500");
  });

  it("totals stored-negative expenses by their size, with one minus", () => {
    renderList([row("a", "2026-09-02", -35_000n, "expense"), row("b", "2026-09-01", -15_000n, "expense"), row("c", "2026-08-01", 70_000n, "income")]);
    expect(screen.getByRole("group", { name: "ספטמבר 2026" }).querySelector(".ui-month-totals")?.textContent).toBe("הוצאות −₪500");
  });

  it("draws no empty total line when a currency rounds to zero", () => {
    renderList([row("a", "2026-09-01", 40n, "expense", "USD"), row("b", "2026-09-02", 50_000n, "expense"), row("c", "2026-08-01", 70_000n, "income")]);
    const september = screen.getByRole("group", { name: "ספטמבר 2026" });
    expect(september.querySelectorAll(".ui-month-line")).toHaveLength(1);
  });

  it("shows only the name of the last month while more rows may load", () => {
    renderList(NEWEST_FIRST, false);
    expect(screen.getByRole("group", { name: "ספטמבר 2026" }).querySelector(".ui-month-totals")).not.toBeNull();
    expect(screen.getByRole("group", { name: "אוגוסט 2026" }).querySelector(".ui-month-totals")).toBeNull();
  });

  it("renders a single month as the plain list", () => {
    renderList(NEWEST_FIRST.slice(0, 2));
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.getAllByTestId("row")).toHaveLength(2);
  });

  it("uses the heading style for month heads and the income colour for the income total", () => {
    renderList(NEWEST_FIRST);
    for (const head of screen.getAllByRole("heading", { level: 2 })) expect(head).toHaveClass("t-heading");
    const august = screen.getByRole("group", { name: "אוגוסט 2026" });
    const figures = Array.from(august.querySelectorAll(".ui-month-totals bdi"));
    expect(figures.filter((node) => node.classList.contains("ui-income")).map((node) => node.textContent)).toEqual(["₪8,000", "$1,500"]);
    expect(figures.filter((node) => node.textContent.startsWith("−")).every((node) => !node.classList.contains("ui-income"))).toBe(true);
  });
});

describe("day heads (FLOW-305)", () => {
  // 00:30 on 7 October in Israel is still 6 October in UTC.
  const justAfterMidnight = new Date("2026-10-06T21:30:00Z");
  // 00:30 on 1 January 2026 in Israel is still 2025 in UTC.
  const newYear = new Date("2025-12-31T22:30:00Z");

  it("says היום and אתמול by the Israel day, not the UTC day", () => {
    expect(dayTitle("2026-10-07", justAfterMidnight)).toBe("היום");
    expect(dayTitle("2026-10-06", justAfterMidnight)).toBe("אתמול");
    expect(dayTitle("2026-10-05", justAfterMidnight)).toBe("יום ב׳ · 05/10");
  });

  it("adds the year to a day in another year, and yesterday crosses the year", () => {
    expect(dayTitle("2026-01-01", newYear)).toBe("היום");
    expect(dayTitle("2025-12-31", newYear)).toBe("אתמול");
    expect(dayTitle("2025-12-30", newYear)).toBe("יום ג׳ · 30/12/2025");
  });

  it("groups rows by day in their order and never repeats a day head for a held row", () => {
    const rows = [row("a", "2026-10-07", 1n, "income"), row("b", "2026-10-07", 1n, "income"), row("c", "2026-10-05", 1n, "income"), row("d", "2026-10-07", 1n, "income")];
    const days = groupByDay(rows, dateOf, justAfterMidnight);
    expect(days?.map((day) => day.title)).toEqual(["היום", "יום ב׳ · 05/10"]);
    expect(days?.map((day) => day.rows.map((r) => r.id))).toEqual([["a", "b"], ["c", "d"]]);
    expect(groupByDay([row("x", "", 1n, "income")], dateOf)).toBeNull();
  });

  it("draws day heads as h3 under each month's h2, and in a one-month list", () => {
    // Pin the clock: a day in another year adds "/2026" to the head.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-07T09:00:00Z"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const { unmount } = render(
      <MonthList rows={NEWEST_FIRST} keyOf={(r) => r.id} dateOf={dateOf} amountOf={amountOf} days renderRow={(r) => <p>{r.id}</p>} />,
    );
    const september = screen.getByRole("group", { name: "ספטמבר 2026" });
    expect(within(september).getAllByRole("heading", { level: 3 }).map((node) => node.textContent)).toEqual(["יום ב׳ · 14/09", "יום ה׳ · 10/09"]);
    unmount();
    render(<MonthList rows={NEWEST_FIRST.slice(0, 2)} keyOf={(r) => r.id} dateOf={dateOf} amountOf={amountOf} days renderRow={(r) => <p>{r.id}</p>} />);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(2);
  });

  it("shows exact cents in the month totals when the rows do", () => {
    render(
      <MonthList
        rows={[row("a", "2026-09-01", 10_050n, "expense"), row("b", "2026-09-02", 10_050n, "expense"), row("c", "2026-08-01", 100n, "income")]}
        keyOf={(r) => r.id}
        dateOf={dateOf}
        amountOf={amountOf}
        cents
        renderRow={(r) => <p>{r.id}</p>}
      />,
    );
    expect(screen.getByRole("group", { name: "ספטמבר 2026" }).querySelector(".ui-month-totals")?.textContent).toBe("הוצאות −₪201.00");
    expect(screen.getByRole("group", { name: "אוגוסט 2026" }).querySelector(".ui-month-totals")?.textContent).toBe("הכנסות ₪1.00");
  });
});
