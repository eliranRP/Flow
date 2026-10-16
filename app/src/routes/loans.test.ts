import { describe, expect, it } from "vitest";
import { loansPathFor } from "./loans";

describe("loansPathFor", () => {
  it("moves the old settings loan pages under /loans", () => {
    expect(loansPathFor("/settings/loans")).toBe("/loans");
    expect(loansPathFor("/settings/loans/abc")).toBe("/loans/abc");
    expect(loansPathFor("/settings/loans/abc/future/2027")).toBe("/loans/abc/future/2027");
  });
});
