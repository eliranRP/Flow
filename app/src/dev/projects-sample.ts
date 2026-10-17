import { type ProjectsCashMonth } from "@flow/shared";

/** The list's month cash for the same rows, in dollars: the board's amounts; one line with no project. */
export const devProjectsCash: NonNullable<ProjectsCashMonth> = {
  month: "2026-10-01",
  base_currency: "USD",
  basis: "paid",
  projects: [
    { id: "p1", name: "Halvorsen", type: "עבודה לקוח", status: "active", is_overhead: false, group_id: null, created_at: "2026-08-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 1_500_000, out_minor: 0, net_minor: 1_500_000 }], profit_month_minor: 1_500_000, profit_all_minor: 1_500_000, first_month: "2026-08-01", pending_count: 0, deletable: false },
    { id: "p2", name: "Lark Hill", type: "flip", status: "active", is_overhead: false, group_id: null, created_at: "2026-07-01T08:00:00Z", finished_on: null, budget_minor: 7_500_000, spent_minor: 6_130_000, cash: [{ currency: "USD", in_minor: 0, out_minor: 1_425_342, net_minor: -1_425_342 }], profit_month_minor: -1_425_342, profit_all_minor: -6_130_000, first_month: "2026-07-01", pending_count: 0, deletable: false },
    { id: "p3", name: "Elm Ct", type: "שיפוץ", status: "active", is_overhead: false, group_id: null, created_at: "2026-06-15T08:00:00Z", finished_on: null, budget_minor: 1_000_000, spent_minor: 1_044_000, cash: [{ currency: "USD", in_minor: 0, out_minor: 1_044_000, net_minor: -1_044_000 }], profit_month_minor: -1_044_000, profit_all_minor: -1_044_000, first_month: "2026-06-15", pending_count: 0, deletable: false },
    { id: "p4", name: "Birch St", type: "השכרה", status: "active", is_overhead: false, group_id: null, created_at: "2026-05-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 379_560, out_minor: 0, net_minor: 379_560 }], profit_month_minor: 379_560, profit_all_minor: 379_560, first_month: "2026-05-01", pending_count: 0, deletable: false },
    { id: "p5", name: "Willow Ave", type: "השכרה", status: "active", is_overhead: false, group_id: null, created_at: "2026-04-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 0, out_minor: 328_200, net_minor: -328_200 }], profit_month_minor: -328_200, profit_all_minor: -328_200, first_month: "2026-04-01", pending_count: 0, deletable: false },
    { id: "p6", name: "Fernview", type: "תיקון", status: "active", is_overhead: false, group_id: null, created_at: "2026-09-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 0, out_minor: 0, net_minor: 0 }], profit_month_minor: 0, profit_all_minor: 0, first_month: "2026-09-01", pending_count: 0, deletable: true },
    { id: "p7", name: "Okafor", type: "מטבח", status: "active", is_overhead: false, group_id: null, created_at: "2026-09-10T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 0, out_minor: 0, net_minor: 0 }], profit_month_minor: 0, profit_all_minor: 0, first_month: "2026-09-10", pending_count: 0, deletable: true },
    { id: "p8", name: "פרויקט ישן", type: "עבודה לקוח", status: "finished", is_overhead: false, group_id: null, created_at: "2026-02-01T08:00:00Z", finished_on: "2026-09-30", budget_minor: null, spent_minor: 0, cash: [], profit_month_minor: 0, profit_all_minor: 2_150_000, first_month: "2026-02-01", pending_count: 0, deletable: false },
    { id: "p0", name: "הוצאות כלליות", type: null, status: "active", is_overhead: true, group_id: null, created_at: "2026-01-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 0, out_minor: 760_000, net_minor: -760_000 }], profit_month_minor: -760_000, profit_all_minor: -760_000, first_month: "2026-01-01", pending_count: 0, deletable: false },
  ],
  unassigned: { count: 1, cash: [{ currency: "USD", in_minor: 41_218, out_minor: 0, net_minor: 41_218 }] },
};
