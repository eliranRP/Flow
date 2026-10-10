// @vitest-environment node
import { beforeEach, describe, expect, it } from "vitest";
import { pinReviewHead, pinReviewLine, releaseReviewHold, reviewHold, reviewPin } from "./review-pin";

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

describe("the undo hold (FLOW-327 r1)", () => {
  beforeEach(() => {
    pinReviewLine(null);
  });
  it("keeps the held line pinned against the queue's pin of another card", () => {
    pinReviewLine("t2");
    pinReviewLine("t1", { hold: true });
    pinReviewLine("t2");
    expect(reviewPin()).toBe("t1");
    expect(reviewHold()).toBe("t1");
    expect(pinReviewHead([b, a], reviewPin())).toEqual([a, b]);
  });
  it("clears once the held line is the one pinned as shown", () => {
    pinReviewLine("t1", { hold: true });
    pinReviewLine("t1");
    expect(reviewHold()).toBeNull();
    pinReviewLine("t2");
    expect(reviewPin()).toBe("t2");
  });
  it("is released for a failed reopen, and only for that line", () => {
    pinReviewLine("t1", { hold: true });
    releaseReviewHold("t3");
    expect(reviewHold()).toBe("t1");
    releaseReviewHold("t1");
    expect(reviewHold()).toBeNull();
    pinReviewLine("t2");
    expect(reviewPin()).toBe("t2");
  });
  it("is dropped with a null pin", () => {
    pinReviewLine("t1", { hold: true });
    pinReviewLine(null);
    expect(reviewHold()).toBeNull();
    expect(reviewPin()).toBeNull();
  });
});
