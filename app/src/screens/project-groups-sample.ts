import type { Dashboard } from "@flow/shared";
import { sampleDashboard } from "../ui/screen-stories-support";

function groupedProject(id: string, name: string, status: "active" | "finished" = "active", groupId?: string): Dashboard["projects"][number] {
  return {
    ...(groupId != null ? { group_id: groupId } : {}),
    id,
    name,
    status,
    income_agorot: 10_000_000n,
    direct_agorot: 8_000_000n,
    shared_agorot: 0n,
    profit_before_shared_agorot: 2_000_000n,
    profit_agorot: 2_000_000n,
    by_currency: [],
  };
}

/** FLOW-406 (proj-b): four units in one group, two loose projects, two finished. Invented names. */
export const projectsGrouped: Dashboard = {
  ...sampleDashboard,
  projects: [
    groupedProject("u1", "דירה 1", "active", "g1"),
    groupedProject("u2", "דירה 2", "active", "g1"),
    groupedProject("u3", "דירה 3", "active", "g1"),
    groupedProject("u4", "דירה 4", "finished", "g1"),
    groupedProject("a", "וילה רעננה"),
    groupedProject("b", "מגדל משרדים פ״ת"),
    groupedProject("f1", "מחסן תמר", "finished"),
    groupedProject("f2", "חנות רימון", "finished"),
  ],
  groups: [
    {
      id: "g1",
      name: "בניין לדוגמה",
      sort_order: 0,
      project_count: 4,
      income_agorot: 40_000_000n,
      direct_agorot: 32_000_000n,
      shared_agorot: 0n,
      profit_before_shared_agorot: 8_000_000n,
      profit_agorot: 8_000_000n,
      by_currency: [],
    },
  ],
};
