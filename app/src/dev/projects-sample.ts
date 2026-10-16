import { type Dashboard, type ProjectsCashMonth } from "@flow/shared";

/** FLOW-445: the Projects list on the board's frame: seven active projects, the overhead row, and one line with no project. Invented names, about the board's lengths. */
export const devProjectsRows: NonNullable<Dashboard["projects"]> = [
  { id: "p1", name: "Henderson", status: "active", state_label: "עבודה לקוח • תשלום 2 מתוך 4", income_agorot: 1_500_000n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 1_500_000n, profit_agorot: 1_500_000n, by_currency: [] },
  { id: "p2", name: "Oak Ridge", status: "active", state_label: "flip • בשיפוץ", income_agorot: 0n, direct_agorot: 1_425_342n, shared_agorot: 0n, profit_before_shared_agorot: -1_425_342n, profit_agorot: -1_425_342n, by_currency: [] },
  { id: "p3", name: "Pine Ct", status: "active", state_label: "שיפוץ • לפני השכרה • מעל התקציב", income_agorot: 0n, direct_agorot: 1_044_000n, shared_agorot: 0n, profit_before_shared_agorot: -1_044_000n, profit_agorot: -1_044_000n, by_currency: [] },
  { id: "p4", name: "Cedar St", status: "active", state_label: "השכרה • מושכר", income_agorot: 379_560n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 379_560n, profit_agorot: 379_560n, by_currency: [] },
  { id: "p5", name: "Maple Ave", status: "active", state_label: "דופלקס להשכרה • 2 יחידות", income_agorot: 0n, direct_agorot: 328_200n, shared_agorot: 0n, profit_before_shared_agorot: -328_200n, profit_agorot: -328_200n, by_currency: [] },
  { id: "p6", name: "Ridgeview", status: "active", state_label: "תיקון גג • חשבונית פתוחה", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n, by_currency: [] },
  { id: "p7", name: "Patel", status: "active", state_label: "מטבח • עבודה לקוח", income_agorot: 0n, direct_agorot: 0n, shared_agorot: 0n, profit_before_shared_agorot: 0n, profit_agorot: 0n, by_currency: [] },
  { id: "p0", name: "הוצאות כלליות", status: "active", state_label: "תקורה • לא פרויקט", income_agorot: 0n, direct_agorot: 760_000n, shared_agorot: 0n, profit_before_shared_agorot: -760_000n, profit_agorot: -760_000n, by_currency: [] },
];

/** The list's month cash for the same rows, in dollars: the board's amounts; one line with no project. */
export const devProjectsCash: NonNullable<ProjectsCashMonth> = {
  month: "2026-10-01",
  base_currency: "USD",
  basis: "paid",
  projects: [
    { id: "p1", name: "Henderson", type: "עבודה לקוח", status: "active", is_overhead: false, group_id: null, created_at: "2026-08-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 1_500_000, out_minor: 0, net_minor: 1_500_000 }], profit_month_minor: 1_500_000, profit_all_minor: 1_500_000, first_month: "2026-08-01", pending_count: 0, deletable: false },
    { id: "p2", name: "Oak Ridge", type: "flip", status: "active", is_overhead: false, group_id: null, created_at: "2026-07-01T08:00:00Z", finished_on: null, budget_minor: 7_500_000, spent_minor: 6_130_000, cash: [{ currency: "USD", in_minor: 0, out_minor: 1_425_342, net_minor: -1_425_342 }], profit_month_minor: -1_425_342, profit_all_minor: -6_130_000, first_month: "2026-07-01", pending_count: 0, deletable: false },
    { id: "p3", name: "Pine Ct", type: "שיפוץ", status: "active", is_overhead: false, group_id: null, created_at: "2026-06-15T08:00:00Z", finished_on: null, budget_minor: 1_000_000, spent_minor: 1_044_000, cash: [{ currency: "USD", in_minor: 0, out_minor: 1_044_000, net_minor: -1_044_000 }], profit_month_minor: -1_044_000, profit_all_minor: -1_044_000, first_month: "2026-06-15", pending_count: 0, deletable: false },
    { id: "p4", name: "Cedar St", type: "השכרה", status: "active", is_overhead: false, group_id: null, created_at: "2026-05-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 379_560, out_minor: 0, net_minor: 379_560 }], profit_month_minor: 379_560, profit_all_minor: 379_560, first_month: "2026-05-01", pending_count: 0, deletable: false },
    { id: "p5", name: "Maple Ave", type: "השכרה", status: "active", is_overhead: false, group_id: null, created_at: "2026-04-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 0, out_minor: 328_200, net_minor: -328_200 }], profit_month_minor: -328_200, profit_all_minor: -328_200, first_month: "2026-04-01", pending_count: 0, deletable: false },
    { id: "p6", name: "Ridgeview", type: "תיקון", status: "active", is_overhead: false, group_id: null, created_at: "2026-09-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 0, out_minor: 0, net_minor: 0 }], profit_month_minor: 0, profit_all_minor: 0, first_month: "2026-09-01", pending_count: 0, deletable: true },
    { id: "p7", name: "Patel", type: "מטבח", status: "active", is_overhead: false, group_id: null, created_at: "2026-09-10T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 0, out_minor: 0, net_minor: 0 }], profit_month_minor: 0, profit_all_minor: 0, first_month: "2026-09-10", pending_count: 0, deletable: true },
    { id: "p0", name: "הוצאות כלליות", type: null, status: "active", is_overhead: true, group_id: null, created_at: "2026-01-01T08:00:00Z", finished_on: null, budget_minor: null, spent_minor: 0, cash: [{ currency: "USD", in_minor: 0, out_minor: 760_000, net_minor: -760_000 }], profit_month_minor: -760_000, profit_all_minor: -760_000, first_month: "2026-01-01", pending_count: 0, deletable: false },
  ],
  unassigned: { count: 1, cash: [{ currency: "USD", in_minor: 41_218, out_minor: 0, net_minor: 41_218 }] },
};
