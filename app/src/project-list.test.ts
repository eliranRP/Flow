import { describe, expect, it } from "vitest";
import type { ProjectCashRow } from "@flow/shared";
import { isOverBudget, netIn, orderActiveProjects, projectInitials, projectMeta, unassignedCountLabel } from "./project-list";

function row(over: Partial<ProjectCashRow> & { id: string; name: string }): ProjectCashRow {
  return {
    type: null,
    status: "active",
    is_overhead: false,
    group_id: null,
    created_at: "2026-09-01T00:00:00Z",
    finished_on: null,
    budget_minor: null,
    spent_minor: 0,
    cash: [],
    profit_month_minor: 0,
    profit_all_minor: 0,
    first_month: "2026-09-01",
    pending_count: 0,
    deletable: false,
    ...over,
  };
}

const ILS = "ILS";

describe("project list helpers (FLOW-445)", () => {
  it("initials are the first letter of the first two words, Latin uppercased", () => {
    expect(projectInitials("lark hill")).toBe("LH");
    expect(projectInitials("Okafor")).toBe("O");
    expect(projectInitials("  Juniper  Ct  Extra ")).toBe("JC");
  });

  it("meta is the type then the status, or פעיל when neither", () => {
    expect(projectMeta(row({ id: "a", name: "x", type: "flip", first_month: null }))).toBe("flip · חדש");
    expect(projectMeta(row({ id: "a", name: "x", type: "השכרה" }))).toBe("השכרה");
    expect(projectMeta(row({ id: "a", name: "x" }))).toBe("פעיל");
    expect(projectMeta(row({ id: "a", name: "x", type: "flip", status: "finished" }))).toBe("flip · הסתיים");
  });

  it("over budget only when spent is above the budget", () => {
    expect(isOverBudget({ budget_minor: 100, spent_minor: 101 })).toBe(true);
    expect(isOverBudget({ budget_minor: 100, spent_minor: 100 })).toBe(false);
    expect(isOverBudget({ budget_minor: null, spent_minor: 500 })).toBe(false);
  });

  it("new projects first (newest first), then by the month's cash size, ties by name", () => {
    const rows = [
      row({ id: "small", name: "Ashby Rd", cash: [{ currency: ILS, in_minor: 0, out_minor: 100, net_minor: -100 }] }),
      row({ id: "big", name: "Lark Hill", cash: [{ currency: ILS, in_minor: 0, out_minor: 900, net_minor: -900 }] }),
      row({ id: "newer", name: "Wren St", first_month: null, created_at: "2026-10-02T00:00:00Z" }),
      row({ id: "older", name: "Harrow Ln", first_month: null, created_at: "2026-10-01T00:00:00Z" }),
      row({ id: "fin", name: "Fenwick", status: "finished" }),
      row({ id: "over", name: "Overhead", is_overhead: true }),
    ];
    expect(orderActiveProjects(rows, ILS).map((r) => r.id)).toEqual(["newer", "older", "big", "small"]);
  });

  it("netIn reads one currency and is zero without a line", () => {
    expect(netIn([{ currency: ILS, in_minor: 5, out_minor: 0, net_minor: 5 }], ILS)).toBe(5);
    expect(netIn([], ILS)).toBe(0);
  });

  it("the unassigned link word follows the count", () => {
    expect(unassignedCountLabel(1)).toBe("שורה אחת בלי פרויקט");
    expect(unassignedCountLabel(3)).toBe("3 שורות בלי פרויקט");
  });
});
