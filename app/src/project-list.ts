import { initialsOf, type ProjectCashRow, type ProjectsCashMonth } from "@flow/shared";

/**
 * FLOW-445: the Projects tab's list, as pure functions. The rows come from `projects_cash_month`;
 * the screen only lays them out.
 */

type Cash = ProjectCashRow["cash"];

/** A project's net for the month in one currency (minor units); zero when it has no line in it. */
export function netIn(cash: Cash, currency: string): number {
  return cash.find((row) => row.currency === currency)?.net_minor ?? 0;
}

/** Initials for the circle, the same rule as the shared Avatar, so a group row and a person row agree. */
export function projectInitials(name: string): string {
  return initialsOf(name)?.text ?? "";
}

/** "חדש" while the project has no line, invoice or month. A finished project shows "הסתיים" instead. */
export function projectStatusWord(row: Pick<ProjectCashRow, "status" | "first_month" | "is_overhead">): string | undefined {
  if (row.status === "finished") return "הסתיים";
  if (!row.is_overhead && row.first_month == null) return "חדש";
  return undefined;
}

/** The meta line: the owner's own type, then the status; "פעיל" when there is neither. */
export function projectMeta(row: ProjectCashRow): string {
  const parts = [row.type ?? undefined, projectStatusWord(row)].filter((part): part is string => part != null && part !== "");
  return parts.length > 0 ? parts.join(" · ") : "פעיל";
}

/** True when spent is over the budget (the "מעל התקציב" hint). */
export function isOverBudget(row: Pick<ProjectCashRow, "budget_minor" | "spent_minor">): boolean {
  return row.budget_minor != null && row.spent_minor > row.budget_minor;
}

/**
 * Active projects in the list's order: the new ones first (newest first), then the biggest cash
 * movement this month (by its size), ties by name. The overhead project is not in this list.
 */
export function orderActiveProjects(rows: ProjectCashRow[], currency: string): ProjectCashRow[] {
  const active = rows.filter((row) => row.status === "active" && !row.is_overhead);
  const rank = (row: ProjectCashRow) => (projectStatusWord(row) === "חדש" ? 0 : 1);
  return [...active].sort((a, b) => {
    const byRank = rank(a) - rank(b);
    if (byRank !== 0) return byRank;
    if (rank(a) === 0) {
      const byCreated = b.created_at.localeCompare(a.created_at);
      if (byCreated !== 0) return byCreated;
    } else {
      const bySize = Math.abs(netIn(b.cash, currency)) - Math.abs(netIn(a.cash, currency));
      if (bySize !== 0) return bySize;
    }
    return a.name.localeCompare(b.name, "he");
  });
}

/** The unassigned line count in words for the list's link: one line, or N lines. */
export function unassignedCountLabel(count: number): string {
  return count === 1 ? "שורה אחת בלי פרויקט" : `${String(count)} שורות בלי פרויקט`;
}

/** The overhead project row, when the company has one. */
export function overheadRow(month: NonNullable<ProjectsCashMonth>): ProjectCashRow | undefined {
  return month.projects.find((row) => row.is_overhead);
}
