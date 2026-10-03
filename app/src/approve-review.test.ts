import { describe, expect, it } from "vitest";
import { ApproveNotice, isApproveRetry, readApproveOutcome } from "./approve-review";

describe("approve outcome", () => {
  it("treats an empty body as success", () => {
    expect(readApproveOutcome(null)).toBe("ok");
    expect(readApproveOutcome({ ok: true })).toBe("ok");
  });

  it("reads the app-only notices and a refusal", () => {
    expect(readApproveOutcome({ ok: false, error: { code: "stale" } })).toBe("stale");
    expect(readApproveOutcome({ ok: false, error: { code: "already_closed" } })).toBe("already_closed");
    expect(readApproveOutcome({ ok: false, error: { code: "not_found" } })).toBe("not_found");
    expect(readApproveOutcome({ ok: false, error: { code: "refused" } })).toBe("refused");
  });

  it("uses the two info sentences", () => {
    expect(new ApproveNotice("stale").message).toBe("השיוך עודכן. בדקו את הכרטיס.");
    expect(new ApproveNotice("already_closed").message).toBe("הפריט כבר טופל.");
  });

  it("retries a deadlock or a serialization failure", () => {
    expect(isApproveRetry(new Error("deadlock detected"))).toBe(true);
    expect(isApproveRetry(new Error("40P01"))).toBe(true);
    expect(isApproveRetry(new Error("40001"))).toBe(true);
    expect(isApproveRetry(new Error("serialization failure"))).toBe(true);
    expect(isApproveRetry(new Error("category is required"))).toBe(false);
  });
});
