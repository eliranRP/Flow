import { describe, expect, it } from "vitest";
import { roundedThousands } from "./investment-card";

describe("roundedThousands", () => {
  it("rounds to the nearest thousand, half up, and keeps the sign", () => {
    expect(roundedThousands(1_249_999n, "USD")).toBe("$12K");
    expect(roundedThousands(1_250_000n, "USD")).toBe("$13K");
    expect(roundedThousands(-1_250_000n, "USD")).toBe("−$13K");
  });
});
