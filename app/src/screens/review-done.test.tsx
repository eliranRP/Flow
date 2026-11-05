import { describe, expect, it } from "vitest";
import { reviewDoneLine } from "./review-shared";

// FLOW-1049 (V3-Review): the done frame's count line says how many lines were approved today.
describe("reviewDoneLine (FLOW-1049)", () => {
  it("says one line in the singular", () => {
    expect(reviewDoneLine(1)).toBe("שורה אחת אושרה היום");
  });

  it("says N lines in the plural", () => {
    expect(reviewDoneLine(3)).toBe("3 שורות אושרו היום");
    expect(reviewDoneLine(12)).toBe("12 שורות אושרו היום");
  });
});
