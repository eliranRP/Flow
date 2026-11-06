import { fireEvent, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { homeActivityLines } from "../dev/home-activity-sample";
import { RECURRING_FIXTURE } from "../recurring-sample";
import type { ScheduleRow } from "../recurring-schedule";
import { renderWithProviders } from "../test-render";
import { israelToday } from "../ui/date-math";
import { activityGroups, HomeActivity, monthFilter, onceActivity, pastActivityGroups, scheduleActivity, type ActivityFilter, type HomeActivityData } from "./home-activity";

// This year's October, so the line dates read without a year.
const MONTH = `${israelToday().slice(0, 4)}-10`;
const LINES = homeActivityLines(MONTH);
const groupsFor = (filter: ActivityFilter, lines = LINES) => activityGroups({ schedule: RECURRING_FIXTURE, lines, filter, base: "USD", search: "" });

describe("the month's activity groups (FLOW-1036)", () => {
  it("puts late and soon charges in נותר לשלם, late first, and arrived ones in קבועים ששולמו", () => {
    const { left, paid } = scheduleActivity(RECURRING_FIXTURE, "");
    expect(left.map((row) => row.title)).toEqual([
      "Elm Row unit 2", "Brightline Power", "Juniper Pointe HOA", "Harborlink Internet", "Keystone Mutual", "Clearway Waste", "Docsuite",
    ]);
    expect(left[0]).toMatchObject({ mark: "late", meta: "איחר", income: true, minor: 165_000n });
    expect(left.find((row) => row.title === "Keystone Mutual")).toMatchObject({ mark: "due", meta: "צפוי ב־20", income: false });
    expect(paid.map((row) => row.title)).toEqual(["Bayside Water Utility", "Signalpoint Mobile", "Brightside Pest", "Birch Lane rent", "Juniper Ct rent"]);
    // An arrived charge shows what came, not its usual amount; it opens the charge's page.
    expect(paid[0]).toMatchObject({ mark: "paid", minor: 14_200n, href: "/recurring/expense/water", meta: "Elm Row · חשמל ומים" });
  });

  // FLOW-1079: a charge taken out of this month's forecast.
  it("moves a charge out of the forecast from נותר לשלם to הוצא מהצפי, which no total counts", () => {
    const keystone = "party:expense:insurance:USD";
    const { left, skipped } = scheduleActivity(RECURRING_FIXTURE, "", new Set([keystone]), "נובמבר");
    expect(left.some((row) => row.title === "Keystone Mutual")).toBe(false);
    expect(skipped).toEqual([expect.objectContaining({ title: "Keystone Mutual", meta: "לא צפוי בנובמבר", forecastKey: keystone })]);
    const groups = activityGroups({ schedule: RECURRING_FIXTURE, lines: LINES, filter: "all", base: "USD", search: "", skipped: new Set([keystone]), monthLabel: "נובמבר" });
    expect(groups.map((group) => group.id)).toEqual(["left", "skipped", "paid", "once"]);
    expect(groups[0]?.outMinor).toBe((groupsFor("all")[0]?.outMinor ?? 0n) - 21_200n);
  });

  it("leaves a charge due in a later month out", () => {
    const { left, paid } = scheduleActivity(RECURRING_FIXTURE, "");
    expect([...left, ...paid].some((row) => row.title === "Fernway Lawn")).toBe(false);
  });

  it("signs the server's negative expense amounts away", () => {
    const negative: ScheduleRow[] = RECURRING_FIXTURE.map((row) => (row.direction === "expense" ? { ...row, typical_amount_minor: -row.typical_amount_minor } : row));
    expect(scheduleActivity(negative, "").left.find((row) => row.title === "Brightline Power")?.minor).toBe(18_600n);
  });

  it("names a split party's charge by its project", () => {
    const split: ScheduleRow[] = [
      { ...RECURRING_FIXTURE[0], party_id: "servicer", project_id: "p1" } as ScheduleRow,
      { ...RECURRING_FIXTURE[0], party_id: "servicer", project_id: "p2" } as ScheduleRow,
    ];
    expect(scheduleActivity(split, "?preview=1").left.map((row) => row.href)).toEqual([
      "/recurring/expense/servicer?preview=1&project=p1",
      "/recurring/expense/servicer?preview=1&project=p2",
    ]);
  });

  it("puts the month's one-off lines in חד-פעמי, newest first, income as money in", () => {
    const once = onceActivity(LINES, "") ?? [];
    expect(once.map((row) => row.title)).toEqual(["Oakridge Lumber", "Juniper Ct closing", "Northstar Fuel", "Greenway Market"]);
    expect(once[1]).toMatchObject({ mark: "once", income: true, minor: 504_000n, href: "/transactions/t-sale" });
    expect(once[0]?.meta).toBe("09/10 · Birch Lane");
  });

  it("hides חד-פעמי while the server does not say which lines are recurring (BUILD-PLAN §5)", () => {
    expect(onceActivity(homeActivityLines(MONTH, { flag: false }), "")).toBeNull();
    expect(groupsFor("all", homeActivityLines(MONTH, { flag: false })).map((group) => group.id)).toEqual(["left", "paid"]);
  });

  it("shows three groups on הכול, two on קבועים and one on נותר לשלם", () => {
    expect(groupsFor("all").map((group) => group.id)).toEqual(["left", "paid", "once"]);
    expect(groupsFor("fixed").map((group) => group.id)).toEqual(["left", "paid"]);
    expect(groupsFor("left").map((group) => group.id)).toEqual(["left"]);
  });

  it("totals each group's money out and in, in the base currency only", () => {
    const [left, paid, once] = groupsFor("all");
    expect(left).toMatchObject({ outMinor: 18_600n + 21_200n + 31_000n + 13_000n + 8_800n + 3_600n, inMinor: 165_000n });
    expect(paid).toMatchObject({ outMinor: 14_200n + 8_400n + 6_500n, inMinor: 210_000n + 185_000n });
    expect(once).toMatchObject({ outMinor: 147_200n, inMinor: 504_000n });
    const euro = activityGroups({ schedule: RECURRING_FIXTURE, lines: [], filter: "left", base: "EUR", search: "" });
    expect(euro[0]).toMatchObject({ outMinor: 0n, inMinor: 0n });
  });

  it("drops a group with no rows, and adds nothing for a read still out", () => {
    expect(activityGroups({ schedule: null, lines: null, filter: "all", base: "USD", search: "" })).toEqual([]);
    expect(activityGroups({ schedule: [], lines: LINES, filter: "all", base: "USD", search: "" }).map((group) => group.id)).toEqual(["once"]);
  });
});

function renderActivity(activity: Partial<HomeActivityData>, filter: ActivityFilter = "all", onFilter = vi.fn()) {
  const data: HomeActivityData = { schedule: RECURRING_FIXTURE, scheduleFailed: false, lines: LINES, linesFailed: false, onRetry: vi.fn(), ...activity };
  renderWithProviders(
    <HomeActivity activity={data} filter={filter} onFilter={onFilter} markRef={() => undefined} docked={false} base="USD" search="" recurringHref="/recurring" />,
  );
  return data;
}

describe("HomeActivity", () => {
  it("heads each group with its count and total, and says a late charge in words", () => {
    renderActivity({});
    expect(screen.getByRole("heading", { name: "נותר לשלם" }).nextElementSibling?.textContent).toBe("7 · $962 לתשלום · +$1,650 להיכנס");
    expect(screen.getByRole("heading", { name: "חד-פעמי" }).nextElementSibling?.textContent).toBe("4 · $1,472 יצא · +$5,040 נכנס");
    expect(screen.getAllByText("איחר")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "כל הקבועים" })).toHaveAttribute("href", "/recurring");
  });

  it("picks a filter from its radio group", () => {
    const onFilter = vi.fn();
    renderActivity({}, "all", onFilter);
    fireEvent.click(screen.getByRole("radio", { name: "נותר לשלם" }));
    expect(onFilter).toHaveBeenCalledWith("left");
  });

  it("says a failed schedule read, with a retry", () => {
    const data = renderActivity({ schedule: null, scheduleFailed: true });
    expect(screen.getByText("רשימת התנועות לא נטענה")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "נסו שוב" }));
    expect(data.onRetry).toHaveBeenCalled();
  });

  it("says an empty month in words", () => {
    renderActivity({ schedule: [], lines: [] });
    expect(screen.getByText("עוד אין תנועות החודש")).toBeInTheDocument();
  });
});

describe("a past month's activity (FLOW-1056)", () => {
  const pastFor = (filter: ActivityFilter, lines: typeof LINES | null = LINES) => pastActivityGroups({ lines, filter, base: "USD", search: "" });

  it("groups the month's lines by the server's flag: recurring as קבועים (paid), one-off as חד-פעמי", () => {
    const [fixed, once] = pastFor("all");
    expect(fixed).toMatchObject({ id: "fixed", title: "קבועים", outMinor: 14_200n, inMinor: 210_000n, due: false });
    expect(fixed?.rows.map((row) => row.title)).toEqual(["Bayside Water Utility", "Birch Lane rent"]);
    expect(fixed?.rows.every((row) => row.mark === "paid")).toBe(true);
    expect(once).toMatchObject({ id: "once", title: "חד-פעמי", outMinor: 147_200n, inMinor: 504_000n });
    expect(once?.rows.every((row) => row.mark === "once")).toBe(true);
  });

  it("shows one group for קבועים and חד-פעמי, and nothing for a read still out", () => {
    expect(pastFor("fixed").map((group) => group.id)).toEqual(["fixed"]);
    expect(pastFor("once").map((group) => group.id)).toEqual(["once"]);
    expect(pastFor("all", null)).toEqual([]);
  });

  it("keeps every line in one group while the server does not say which are recurring", () => {
    const unflagged = homeActivityLines(MONTH, { flag: false });
    expect(pastFor("all", unflagged).map((group) => [group.id, group.rows.length])).toEqual([["lines", 6]]);
  });

  it("reads a current month's filter it does not have as הכול", () => {
    expect(monthFilter("left", true)).toBe("all");
    expect(monthFilter("once", false)).toBe("all");
    expect(monthFilter("once", true)).toBe("once");
  });

  function renderPast(over: Partial<HomeActivityData> = {}) {
    const data: HomeActivityData = { schedule: null, scheduleFailed: false, lines: LINES, linesFailed: false, onRetry: vi.fn(), past: { more: true }, ...over };
    renderWithProviders(
      <HomeActivity
        activity={data}
        filter="left"
        onFilter={vi.fn()}
        markRef={() => undefined}
        docked={false}
        base="USD"
        search=""
        recurringHref="/recurring"
        close={{ name: "אוקטובר", inMinor: 3_276_500n, outMinor: 6_694_000n, linesHref: "/cash/2026-10/out" }}
      />,
    );
  }

  it("titles the list with the month and how it finished, filters with חד-פעמי, and ends with the month's lines", () => {
    renderPast();
    const title = screen.getByRole("heading", { name: "הפעילות באוקטובר" });
    expect(title.nextElementSibling?.textContent).toBe("נכנס $32,765 · יצא $66,940");
    expect(screen.queryByRole("radio", { name: "נותר לשלם" })).toBeNull();
    expect(screen.getByRole("radio", { name: "הכול" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("radio", { name: "חד-פעמי" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "כל התנועות באוקטובר" })).toHaveAttribute("href", "/cash/2026-10/out");
    expect(screen.queryByRole("link", { name: "כל הקבועים" })).toBeNull();
  });

  it("says a past month with no lines in words, and loads with skeleton rows", () => {
    renderPast({ lines: [], past: { more: false } });
    expect(screen.getByText("אין תנועות באוקטובר")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "כל התנועות באוקטובר" })).toBeNull();
  });
});
