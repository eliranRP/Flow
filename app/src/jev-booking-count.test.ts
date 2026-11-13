import { describe, expect, it } from "vitest";
import { reviewWaiting } from "./jev-booking-count";

/** FLOW-955 (owner, 2026-10-22): Home's לאישור count includes Jev's bookings waiting for review. */
describe("Home's review count", () => {
  it("adds Jev's waiting bookings to the queue's own items", () => {
    expect(reviewWaiting(3, 2)).toBe(5);
    expect(reviewWaiting(0, 1)).toBe(1);
  });

  it("is the queue alone while the bookings read is out or failed", () => {
    expect(reviewWaiting(4, undefined)).toBe(4);
  });
});
