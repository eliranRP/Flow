// @vitest-environment node
import { describe, expect, it } from "vitest";
import { emptyHomeLabel, emptyProfitLabel } from "./home-label";

describe("emptyHomeLabel", () => {
  it("names the תזרים on the cash Home's first run (FLOW-362)", () => {
    expect(emptyHomeLabel).toBe("כאן יופיע התזרים של העסק");
  });

  it("keeps the profit wording on the profit view", () => {
    expect(emptyProfitLabel).toBe("כאן יופיע הרווח של העסק");
  });
});
