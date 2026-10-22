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

describe("gross-up drill-down lines (FLOW-947)", () => {
  it("a contra gross-up part keeps grossUp and shows as a credit under its own category", () => {
    const model = buildProfitModel({
      currency: "USD",
      basis: "cash",
      month: { income: 0n, expense: 0n },
      ytdProfit: null,
      projects: { income: null, expense: null },
      categories: { income: null, expense: null },
      lines: [{
        direction: "expense",
        categoryKey: "c-tax",
        categoryName: "Property taxes",
        rows: [
          // A contra gross-up part comes back as a negative expense magnitude (a credit); signed +.
          { transaction_id: "t1", part: null, description: "Escrow refund", supplier_name: null, project_name: "Alpha", category_name: "Property taxes", doc_date: "2026-10-10", currency: "USD", amount_minor: -85_077n, shared: false, gross_up: true },
          { transaction_id: "t2", part: null, description: "Tax bill", supplier_name: null, project_name: "Alpha", category_name: "Property taxes", doc_date: "2026-10-09", currency: "USD", amount_minor: 24_948n, shared: false, gross_up: false },
        ],
      }],
    }, null);
    const tax = model.lines.filter((line) => line.categoryKey === "c-tax");
    expect(tax.find((line) => line.transactionId === "t1")).toMatchObject({ grossUp: true, amount: 85_077n });
    expect(tax.find((line) => line.transactionId === "t2")).toMatchObject({ grossUp: false, amount: -24_948n });
  });
});

describe("kept-out categories and lines (FLOW-954)", () => {
  it("reads the kept-out groups in the company currency, and keeps their lines out of the counted list", () => {
    const expense: Breakdown = {
      ...(read("expense", []) as NonNullable<Breakdown>),
      group_by: "category",
      excluded_groups: [
        { currency: "USD", key: "c-principal", name: "קרן הלוואה", amount_minor: 35_000n, count: 1, projects: 1, loan_part: "principal" },
        { currency: "USD", key: "c-buy", name: "רכישת נכס", amount_minor: 8_000_000n, count: 1, projects: 1, loan_part: null },
        { currency: "ILS", key: "c-other", name: "אחר", amount_minor: 100n, count: 1, projects: 1, loan_part: null },
      ],
    };
    const model = buildProfitModel({
      ...inputs([], []),
      categories: { income: null, expense },
      lines: [{
        direction: "expense",
        categoryKey: "",
        categoryName: "",
        keptOut: true,
        rows: [
          { transaction_id: "t1", part: null, description: "Example Mortgage", supplier_name: null, project_name: "Alpha", category_name: null, doc_date: "2026-10-07", currency: "USD", amount_minor: 35_000n, shared: false, category_id: "c-principal" },
        ],
      }],
    }, null);
    expect(model.keptOut.map((row) => [row.key, row.direction, row.total, row.loanPart])).toEqual([
      ["c-buy", "expense", 8_000_000n, null],
      ["c-principal", "expense", 35_000n, "principal"],
    ]);
    expect(model.lines).toEqual([]);
    expect(model.keptOutLines).toEqual([expect.objectContaining({ transactionId: "t1", categoryKey: "c-principal", amount: -35_000n, keptOut: true })]);
  });
});
