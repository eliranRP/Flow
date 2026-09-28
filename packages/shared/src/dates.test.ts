import { describe, expect, it } from "vitest";
import { formatDayMonthYear, monthCells } from "./dates";

describe("hebrew dates", () => {
  it("shows day month year", () => {
    expect(formatDayMonthYear("2026-09-28")).toBe("28/09/2026");
  });

  it("starts the month grid on Sunday", () => {
    const cells = monthCells(2026, 9);
    expect(cells[0]?.iso).toBe("2026-08-30");
    expect(cells[0]?.inMonth).toBe(false);
    expect(cells.find((cell) => cell.iso === "2026-09-01")?.inMonth).toBe(true);
    expect(cells.length % 7).toBe(0);
  });
});
