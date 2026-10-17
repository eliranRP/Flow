import { describe, expect, it } from "vitest";
import { formatAmount } from "./amount";
import { roundedThousands } from "./investment-card";

describe("roundedThousands", () => {
  it("rounds to the nearest thousand, half up, and keeps the sign", () => {
    expect(roundedThousands(1_249_999n, "USD")).toBe(formatAmount(1_200_000n, "summary", "USD"));
    expect(roundedThousands(1_250_000n, "USD")).toBe(formatAmount(1_300_000n, "summary", "USD"));
    expect(roundedThousands(-1_250_000n, "USD")).toBe(formatAmount(-1_300_000n, "summary", "USD"));
  });
});
