// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emptyProfitLabel } from "./home-label";

describe("emptyProfitLabel", () => {
  it("keeps the profit wording on the profit view", () => {
    expect(emptyProfitLabel).toBe("כאן יופיע הרווח של העסק");
  });
});
