import { describe, expect, it } from "vitest";
import { projectsCashMonthSchema } from "./projects-cash";

// Invented projects only.
const row = {
  id: "p1",
  name: "בית הברוש",
  type: null,
  status: "active",
  is_overhead: false,
  created_at: "2026-01-01T00:00:00Z",
  finished_on: null,
  budget_minor: null,
  spent_minor: 0,
  cash: [{ currency: "ILS", in_minor: 100_000, out_minor: 40_000, net_minor: 60_000 }],
  profit_all_minor: 60_000,
  first_month: "2026-01-01",
};
const answer = { base_currency: "ILS", projects: [row], unassigned: { count: 0, cash: [] } };

describe("projectsCashMonthSchema", () => {
  it("reads the list's answer: no month, basis, group_id, pending_count or deletable (FLOW-1204, FLOW-1205)", () => {
    const parsed = projectsCashMonthSchema.parse(answer);
    expect(parsed?.projects[0]?.name).toBe("בית הברוש");
    expect(parsed?.projects[0]?.pending_count).toBeUndefined();
    expect(parsed?.projects[0]?.deletable).toBeUndefined();
  });

  it("reads a project's own answer, which has the menu's two figures", () => {
    const parsed = projectsCashMonthSchema.parse({ ...answer, projects: [{ ...row, pending_count: 2, deletable: true }] });
    expect(parsed?.projects[0]).toMatchObject({ pending_count: 2, deletable: true });
  });

  it("reads null when no company is readable or the project is another company's", () => {
    expect(projectsCashMonthSchema.parse(null)).toBeNull();
  });
});
