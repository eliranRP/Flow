// FLOW-364: Home's month logic. Invented figures only; amounts are agorot.
import { describe, expect, it } from "vitest";
import { canStepYear, changeTone, drawerCells, homeMonthKey, homeMonthPath, homeMonthState, homeMonthSteps } from "./home-month";

const TODAY = "2026-10-11";

describe("homeMonthKey", () => {
  it("reads ?month= and falls back to the current month", () => {
    expect(homeMonthKey("", TODAY, "2025-03")).toBe("2026-10");
    expect(homeMonthKey("?month=2026-07", TODAY, "2025-03")).toBe("2026-07");
    expect(homeMonthKey("?month=soon", TODAY, "2025-03")).toBe("2026-10");
    expect(homeMonthKey("?month=2026-13", TODAY, "2025-03")).toBe("2026-10");
  });

  it("clamps to the first month with data and to the current month", () => {
    expect(homeMonthKey("?month=2026-12", TODAY, "2025-03")).toBe("2026-10");
    expect(homeMonthKey("?month=2024-01", TODAY, "2025-03")).toBe("2025-03");
    expect(homeMonthKey("?month=2024-01", TODAY, null)).toBe("2024-01");
  });
});

describe("homeMonthPath", () => {
  it("is / for the current month and ?month= for another", () => {
    expect(homeMonthPath("2026-10", "?month=2026-07", "2026-10")).toBe("/");
    expect(homeMonthPath("2026-07", "", "2026-10")).toBe("/?month=2026-07");
  });

  it("keeps the preview switch", () => {
    expect(homeMonthPath("2026-07", "?preview=empty", "2026-10")).toBe("/?month=2026-07&preview=empty");
    expect(homeMonthPath("2026-10", "?preview=empty", "2026-10")).toBe("/?preview=empty");
  });
});

describe("changeTone", () => {
  it("helps when money in goes up or money out goes down", () => {
    expect(changeTone("in", 1_000n)).toBe("helps");
    expect(changeTone("in", -1_000n)).toBe("hurts");
    expect(changeTone("out", -1_000n)).toBe("helps");
    expect(changeTone("out", 1_000n)).toBe("hurts");
  });

  it("has no tone for no change", () => {
    expect(changeTone("in", 0n)).toBeNull();
    expect(changeTone("out", 0n)).toBeNull();
  });
});

describe("drawerCells", () => {
  const net = { "2026-01": 500_00n, "2026-07": -200_00n, "2026-10": 100_00n };

  it("marks future months, the selected month and the months with data", () => {
    const cells = drawerCells(2026, net, "2026-01", TODAY, "2026-07");
    expect(cells).toHaveLength(12);
    expect(cells.find((cell) => cell.index === 0)).toEqual({ key: "2026-01", index: 0, state: "data", netMinor: 50_000n });
    expect(cells.find((cell) => cell.index === 6)).toEqual({ key: "2026-07", index: 6, state: "selected", netMinor: -20_000n });
    expect(cells.find((cell) => cell.index === 9)).toEqual({ key: "2026-10", index: 9, state: "data", netMinor: 10_000n });
    expect(cells.find((cell) => cell.index === 10)).toEqual({ key: "2026-11", index: 10, state: "future", netMinor: null });
  });

  it("marks the months with data pending while the year is read, with no net (FLOW-1139)", () => {
    const cells = drawerCells(2026, null, "2026-01", TODAY, "2026-07");
    expect(cells.find((cell) => cell.index === 0)).toEqual({ key: "2026-01", index: 0, state: "data", netMinor: null, pending: true });
    expect(cells.find((cell) => cell.index === 6)).toEqual({ key: "2026-07", index: 6, state: "selected", netMinor: null, pending: true });
    expect(cells.find((cell) => cell.index === 10)).toEqual({ key: "2026-11", index: 10, state: "future", netMinor: null });
  });

  it("disables months before the books' first month", () => {
    const cells = drawerCells(2025, {}, "2025-03", TODAY, "2026-10");
    expect(cells.find((cell) => cell.index === 1)?.state).toBe("before");
    expect(cells.find((cell) => cell.index === 2)?.state).toBe("data");
  });
});

describe("canStepYear", () => {
  it("steps only into years with months in the books and not past the current year", () => {
    expect(canStepYear(2026, 1, "2025-03", TODAY)).toBe(false);
    expect(canStepYear(2026, -1, "2025-03", TODAY)).toBe(true);
    expect(canStepYear(2025, -1, "2025-03", TODAY)).toBe(false);
    expect(canStepYear(2025, -1, null, TODAY)).toBe(true);
  });
});

describe("Home on a month to come (FLOW-1056, FLOW-1066)", () => {
  // TODAY is October 2026: the forecast runs from November 2026 to October 2027.
  it("reads ?month= as any month of the forecast with it on, clamped to its last month", () => {
    expect(homeMonthKey("?month=2026-11", TODAY, "2025-03", true)).toBe("2026-11");
    expect(homeMonthKey("?month=2027-03", TODAY, "2025-03", true)).toBe("2027-03");
    expect(homeMonthKey("?month=2027-10", TODAY, "2025-03", true)).toBe("2027-10");
    expect(homeMonthKey("?month=2027-11", TODAY, "2025-03", true)).toBe("2027-10");
    expect(homeMonthKey("?month=2030-01", TODAY, "2025-03", true)).toBe("2027-10");
    expect(homeMonthKey("?month=2026-11", TODAY, "2025-03")).toBe("2026-10");
  });

  it("names the three month states", () => {
    expect(homeMonthState("2026-07", "2026-10")).toBe("past");
    expect(homeMonthState("2026-10", "2026-10")).toBe("current");
    expect(homeMonthState("2026-11", "2026-10")).toBe("future");
    expect(homeMonthState("2027-05", "2026-10")).toBe("future");
  });

  it("steps through the forecast's months, one back from each, and no later than its last", () => {
    expect(homeMonthSteps("2026-10", "2026-10", "2025-03", true)).toEqual({ earlierKey: "2026-09", laterKey: "2026-11" });
    expect(homeMonthSteps("2026-11", "2026-10", "2025-03", true)).toEqual({ earlierKey: "2026-10", laterKey: "2026-12" });
    expect(homeMonthSteps("2027-03", "2026-10", "2025-03", true)).toEqual({ earlierKey: "2027-02", laterKey: "2027-04" });
    expect(homeMonthSteps("2027-10", "2026-10", "2025-03", true)).toEqual({ earlierKey: "2027-09", laterKey: null });
    // Without the forecast (a preview), the current month has no later arrow; a past month always has one.
    expect(homeMonthSteps("2026-10", "2026-10", "2025-03", false)).toEqual({ earlierKey: "2026-09", laterKey: null });
    expect(homeMonthSteps("2025-03", "2026-10", "2025-03", false)).toEqual({ earlierKey: null, laterKey: "2025-04" });
  });

  it("steps from December to January's forecast across the year", () => {
    expect(homeMonthSteps("2026-12", "2026-12", "2025-03", true).laterKey).toBe("2027-01");
    expect(homeMonthSteps("2027-01", "2026-12", "2025-03", true).earlierKey).toBe("2026-12");
  });

  it("marks every month of the forecast in the drawer, and a picked one as selected with no net", () => {
    const net = { "2026-10": 100_00n };
    const cells = drawerCells(2026, net, "2026-01", TODAY, "2026-10", true);
    expect(cells.find((cell) => cell.index === 10)?.state).toBe("forecast");
    expect(cells.find((cell) => cell.index === 11)?.state).toBe("forecast");
    const picked = drawerCells(2026, net, "2026-01", TODAY, "2026-11", true);
    expect(picked.find((cell) => cell.index === 10)).toEqual({ key: "2026-11", index: 10, state: "selected", netMinor: null });
  });

  it("reaches past December: next year's months to the last are forecast, the ones after it disabled", () => {
    const cells = drawerCells(2027, {}, "2026-01", TODAY, "2026-10", true);
    expect(cells.slice(0, 10).every((cell) => cell.state === "forecast")).toBe(true);
    expect(cells[10]?.state).toBe("future");
    expect(cells[11]?.state).toBe("future");
    expect(drawerCells(2027, {}, "2026-01", TODAY, "2027-10", true)[9]).toEqual({ key: "2027-10", index: 9, state: "selected", netMinor: null });
  });

  it("steps the drawer's year to the forecast's last year and no further", () => {
    expect(canStepYear(2026, 1, "2025-03", TODAY, true)).toBe(true);
    expect(canStepYear(2027, 1, "2025-03", TODAY, true)).toBe(false);
    expect(canStepYear(2026, 1, "2025-03", "2026-01-15", true)).toBe(true);
  });
});
