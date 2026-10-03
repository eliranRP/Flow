import { describe, expect, it } from "vitest";
import { safeAppPath } from "./safe-return";

describe("safeAppPath", () => {
  it("keeps a same-app path and drops an open redirect", () => {
    expect(safeAppPath("/settings?sheet=sumit")).toBe("/settings?sheet=sumit");
    expect(safeAppPath("/settings?preview=empty&sheet=sumit")).toBe("/settings?preview=empty&sheet=sumit");
    expect(safeAppPath(" /onboarding ")).toBe("/onboarding");
    expect(safeAppPath(null)).toBeNull();
    expect(safeAppPath("")).toBeNull();
    expect(safeAppPath("https://evil.example/settings")).toBeNull();
    expect(safeAppPath("//evil.example")).toBeNull();
    expect(safeAppPath("/\\evil.example")).toBeNull();
    expect(safeAppPath("settings")).toBeNull();
    expect(safeAppPath("/settings\n")).toBeNull();
  });
});
