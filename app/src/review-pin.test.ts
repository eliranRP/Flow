import { describe, expect, it } from "vitest";
import { pinReviewHead } from "./review-pin";

const a = { id: "r1", transaction_id: "t1" };
const b = { id: "r2", transaction_id: "t2" };
const c = { id: "r3", transaction_id: "t3" };

describe("pinReviewHead", () => {
  it("moves the pinned line to the head and keeps the rest in order", () => {
    expect(pinReviewHead([a, b, c], "t3")).toEqual([c, a, b]);
  });
  it("matches the line, not the review id, so a replaced row stays pinned", () => {
    expect(pinReviewHead([a, { id: "r9", transaction_id: "t2" }], "t2")[0]?.id).toBe("r9");
  });
  it("leaves the order when the pin is the head, missing, or unset", () => {
    const rows = [a, b];
    expect(pinReviewHead(rows, "t1")).toBe(rows);
    expect(pinReviewHead(rows, "gone")).toBe(rows);
    expect(pinReviewHead(rows, null)).toBe(rows);
  });
});
