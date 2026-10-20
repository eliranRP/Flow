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

function inputs(income: Group[], expense: Group[]) {
  return {
    currency: "USD",
    basis: "cash" as const,
    month: { income: 0n, expense: 0n },
    ytdProfit: null,
    projects: { income: read("income", income), expense: read("expense", expense) },
    categories: { income: null, expense: null },
    lines: [],
  };
}

const OVERHEAD = { id: "p9", name: "משרד החברה / תקורה" };

describe("the month's project rows", () => {
  it("no overhead project: a project holding a shared cost keeps its row; overhead and unassigned are one כללי row that opens nothing", () => {
    const model = buildProfitModel(
      inputs([group("p1", "בית הדקל", 500_000n, 1)], [group("p1", "בית הדקל", 200_000n, 2, true), group("overhead", null, 50_000n, 3), group("unassigned", null, 30_000n, 1)]),
      null,
    );
    expect(model.projects.map((row) => [row.key, row.name, row.projectId, row.income, row.expense, row.profit, row.count])).toEqual([
      ["p1", "בית הדקל", "p1", 500_000n, 200_000n, 300_000n, 3],
      ["", "כללי", null, 0n, 80_000n, -80_000n, 4],
    ]);
  });

  it("the overhead project's income, the overhead costs and the unassigned lines are one row under its name, opening it (owner 20/10)", () => {
    const model = buildProfitModel(
      inputs(
        [group("p1", "בית הדקל", 500_000n, 1), group("p9", "משרד החברה / תקורה", 15_800n, 1)],
        [group("p1", "בית הדקל", 200_000n, 2), group("p9", "משרד החברה / תקורה", 2_000n, 1), group("overhead", null, 14_800n, 3), group("unassigned", null, 30_000n, 1)],
      ),
      OVERHEAD,
    );
    expect(model.projects.map((row) => [row.key, row.name, row.projectId, row.income, row.expense, row.profit, row.count])).toEqual([
      ["p1", "בית הדקל", "p1", 500_000n, 200_000n, 300_000n, 3],
      ["", "משרד החברה / תקורה", "p9", 15_800n, 46_800n, -31_000n, 6],
    ]);
  });

  it("a renamed overhead project's row takes the new name", () => {
    const model = buildProfitModel(inputs([group("p9", "הנהלה ומשרד", 15_800n, 1)], [group("overhead", null, 14_800n, 3)]), { id: "p9", name: "הנהלה ומשרד" });
    expect(model.projects.map((row) => [row.name, row.projectId, row.profit])).toEqual([["הנהלה ומשרד", "p9", 1_000n]]);
  });
});
