import type { ProjectRow } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { HOME_PROJECTS, homeProjects } from "./HomeScreen";

function project(id: string, profit: bigint, income = profit > 0n ? profit : 0n, direct = profit < 0n ? -profit : 0n): ProjectRow {
  return {
    id,
    name: id,
    status: "active",
    income_agorot: income,
    direct_agorot: direct,
    shared_agorot: 0n,
    profit_before_shared_agorot: profit,
    profit_agorot: profit,
    by_currency: [],
  };
}

describe("Home projects for the period (FLOW-411)", () => {
  it("lists losses first, the biggest on top, then the most profitable", () => {
    const rows = [project("p1", 10_000n), project("l1", -5_000n), project("p2", 30_000n), project("l2", -20_000n)];
    expect(homeProjects(rows, "ILS").map((row) => row.id)).toEqual(["l2", "l1", "p2", "p1"]);
  });

  it("leaves out projects with no lines in the period and stops at the cap", () => {
    const rows = [project("quiet", 0n, 0n, 0n), ...Array.from({ length: 7 }, (_, index) => project(`p${String(index)}`, BigInt(index + 1) * 1_000n))];
    const shown = homeProjects(rows, "ILS");
    expect(shown).toHaveLength(HOME_PROJECTS);
    expect(shown.map((row) => row.id)).not.toContain("quiet");
    expect(shown[0]?.id).toBe("p6");
  });

  it("keeps a project whose lines net to zero", () => {
    expect(homeProjects([project("even", 0n, 5_000n, 5_000n)], "ILS").map((row) => row.id)).toEqual(["even"]);
  });
});
