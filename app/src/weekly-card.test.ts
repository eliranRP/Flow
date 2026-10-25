// FLOW-956: the days Home shows last week's card, and its dismissal.
import { beforeEach, describe, expect, it } from "vitest";
import { cardWeek, hideWeeklyCard, weeklyCardHidden } from "./weekly-card";

describe("cardWeek", () => {
  it("is last week's Sunday from Sunday to Tuesday", () => {
    expect(cardWeek("2026-10-11")).toBe("2026-10-04");
    expect(cardWeek("2026-10-12")).toBe("2026-10-04");
    expect(cardWeek("2026-10-13")).toBe("2026-10-04");
  });

  it("is null from Wednesday to Saturday", () => {
    for (const day of ["2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"]) expect(cardWeek(day)).toBeNull();
  });

  it("crosses a month", () => {
    expect(cardWeek("2026-11-02")).toBe("2026-10-25");
  });
});

describe("the card's dismissal", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("hides that week only", () => {
    expect(weeklyCardHidden("2026-10-04")).toBe(false);
    hideWeeklyCard("2026-10-04");
    expect(weeklyCardHidden("2026-10-04")).toBe(true);
    expect(weeklyCardHidden("2026-10-11")).toBe(false);
  });
});
