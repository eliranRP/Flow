// FLOW-364: Home's month logic. Invented figures only; amounts are agorot.
import { describe, expect, it } from "vitest";
import { canStepYear, changeTone, drawerCells, forecastMinor, homeMonthKey, homeMonthPath, splitParts } from "./home-month";

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

describe("splitParts", () => {
  it("splits a negative net into a left-out part and profit, and the percents add to 100", () => {
    const parts = splitParts(-94_600n, 12_000n);
    expect(parts.notCounted).toBe(-106_600n);
    expect(parts.visible).toBe(true);
    expect(parts.notCountedPct + parts.profitPct).toBe(100);
    expect(parts.notCountedPct).toBe(90);
    expect(parts.lead).toBe("out");
  });

  it("leads with capital when money in is the larger left-out part", () => {
    const parts = splitParts(80_000n, 10_000n);
    expect(parts.lead).toBe("in");
    expect(parts.notCountedPct).toBe(88);
    expect(parts.profitPct).toBe(12);
  });

  it("has no lead when profit is the larger part", () => {
    expect(splitParts(5_000n, 20_000n).lead).toBeNull();
  });

  it("hides the card when both parts are 0", () => {
    expect(splitParts(0n, 0n).visible).toBe(false);
  });
});

describe("forecastMinor", () => {
  it("adds the recurring money in and the open invoices, and takes off the recurring money out", () => {
    expect(forecastMinor(-94_600n, 12_000n, 31_500n, 46_000n)).toEqual({ minor: -68_100n, show: true });
  });

  it("hides the row when no addend besides the net is set", () => {
    expect(forecastMinor(-94_600n, 0n, 0n, 0n).show).toBe(false);
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
