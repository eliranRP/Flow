import type { Breakdown } from "@flow/shared";
import { describe, expect, it } from "vitest";
import { buildProfitModel } from "./use-company-profit";

type Group = NonNullable<Breakdown>["groups"][number];

function read(direction: "income" | "expense", groups: Group[]): Breakdown {
  return { direction, basis: "cash", group_by: "project", from: "2026-10-01", to: "2026-10-31", totals: [], groups, excluded: [], review_count: 0 };
}

function group(key: string, name: string | null, minor: bigint, count: number, shared = false): Group {
  return { currency: "USD", key, name, shared, amount_minor: minor, count };
}

describe("the month's project rows", () => {
  it("get_breakdown's keys: a project holding a shared cost keeps its row; overhead and unassigned are one כללי row with no project", () => {
    const model = buildProfitModel({
      currency: "USD",
      basis: "cash",
      month: { income: 500_000n, expense: 280_000n },
      ytdProfit: null,
      projects: {
        income: read("income", [group("p1", "בית הדקל", 500_000n, 1)]),
        expense: read("expense", [group("p1", "בית הדקל", 200_000n, 2, true), group("overhead", null, 50_000n, 3), group("unassigned", null, 30_000n, 1)]),
      },
      categories: { income: null, expense: null },
      lines: [],
    });
    expect(model.projects.map((row) => [row.key, row.name, row.projectId, row.income, row.expense, row.profit, row.count])).toEqual([
      ["p1", "בית הדקל", "p1", 500_000n, 200_000n, 300_000n, 3],
      ["", "כללי", null, 0n, 80_000n, -80_000n, 4],
    ]);
  });
});
