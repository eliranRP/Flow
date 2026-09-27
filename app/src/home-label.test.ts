import { describe, expect, it } from "vitest";
import { homeGreeting, profitBandLabel } from "./home-label";

describe("profitBandLabel", () => {
  it("names the month once figures exist", () => {
    expect(profitBandLabel(true, new Date("2026-09-15T12:00:00Z"))).toBe("רווח נקי בספטמבר");
  });

  it("keeps the first-run placeholder when there is no figure", () => {
    expect(profitBandLabel(false)).toBe("כאן יופיע הרווח הנקי של העסק");
  });
});

describe("homeGreeting", () => {
  it("uses an ellipsis until the owner name is known", () => {
    expect(homeGreeting(null)).toBe("שלום, …");
    expect(homeGreeting("  ")).toBe("שלום, …");
    expect(homeGreeting("אלירן")).toBe("שלום, אלירן");
  });
});
