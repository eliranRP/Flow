import { describe, expect, it } from "vitest";
import { emptyHomeLabel } from "./home-label";

describe("emptyHomeLabel", () => {
  it("keeps the first-run placeholder when there is no figure", () => {
    expect(emptyHomeLabel).toBe("כאן יופיע הרווח של העסק");
  });
});
