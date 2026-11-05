// FLOW-364: Home's month logic. Invented figures only; amounts are agorot.
import { describe, expect, it } from "vitest";
import { canStepYear, changeTone, drawerCells, homeMonthKey, homeMonthPath } from "./home-month";

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
