import { describe, expect, it } from "vitest";
import { safeAppPath } from "./safe-return";

describe("safeAppPath", () => {
  it("accepts only the two settings paths", () => {
    expect(safeAppPath("/settings")).toBe("/settings");
    expect(safeAppPath("/settings?sheet=sumit")).toBe("/settings?sheet=sumit");
  });

  it("drops dot-segment, scheme, and encoded open redirects", () => {
    const rejected = [
      "/..//evil.com",
      "/.//evil.com",
      "/%2e%2e//evil.com",
      "/%252e%252e//evil.com",
      "/%2e%2e/%2e%2e//evil.com",
      "/a/..//evil.com",
      "/\\evil",
      "\\\\evil",
      "javascript:alert(1)",
      "data:text/html,hi",
      "/%2F%2Fevil.com",
      "/%5Cevil",
      "/settings\t",
      "/settings\n",
      "/settings@evil.com",
      " /settings",
      "https://flow.invalid/settings?sheet=sumit",
      "https://evil.example/settings",
      "//evil.example",
      "/settings?preview=empty&sheet=sumit",
      "/onboarding",
      "settings",
      "",
      null,
    ];
    for (const value of rejected) expect(safeAppPath(value)).toBeNull();
  });
});
