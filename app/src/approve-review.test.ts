import { describe, expect, it } from "vitest";
import { ApproveNotice, isApproveRetry, readApproveOutcome } from "./approve-review";
import { assertNoError } from "./use-write";

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
    expect(readApproveOutcome({ surprise: true })).toBe("refused");
    expect(readApproveOutcome("nope")).toBe("refused");
  });

  it("uses the two info sentences", () => {
    expect(new ApproveNotice("stale").message).toBe("השיוך עודכן. בדקו את הכרטיס.");
    expect(new ApproveNotice("already_closed").message).toBe("הפריט כבר טופל.");
  });

  it("retries a serialization failure from the database error", () => {
    const thrown = (error: { message: string; code?: string }): Error => {
      try {
        assertNoError({ error });
      } catch (caught) {
        return caught as Error;
      }
      throw new Error("expected a database error");
    };
    const serialized = thrown({
      message: "could not serialize access due to concurrent update",
      code: "40001",
    });
    expect(serialized.message).toBe("could not serialize access due to concurrent update");
    expect(isApproveRetry(serialized)).toBe(true);
    expect(isApproveRetry(thrown({ message: "could not serialize access due to concurrent update" }))).toBe(false);
    expect(isApproveRetry(thrown({ message: "deadlock detected", code: "40P01" }))).toBe(true);
    expect(isApproveRetry(thrown({ message: "serialization failure" }))).toBe(true);
    expect(isApproveRetry(thrown({ message: "category is required" }))).toBe(false);
  });
});
