import type { ProjectCategoryMonthRow, ProjectDetail } from "@flow/shared";
import { useState } from "react";
import { absAgorot } from "../agorot";
import type { PeriodChoice } from "../period";
import { categoryEntries, useProjectCategoryMonthsQuery, type CategoryItem, type CategoryLine } from "../project-category-months";
import { useCategoriesQuery } from "../use-books";
import { CategoryGroupRow, UpMark } from "../ui/category-group-row";
import { List, ListRow } from "../ui/list-row";
import { categoryHref } from "./project-category-screen";

export function withParam(search: string, key: string, value: string): string {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  params.set(key, value);
  return `?${params.toString()}`;
}

function pendingApprovalTitle(count: number): string {
  return count === 1 ? "1 ממתינה לאישור" : `${String(count)} ממתינות לאישור`;
}

/** The hidden word on a "—" row: a usual bill that has not come yet this month. */
export const NOT_IN_YET = "עוד לא הגיע";

/**
 * Confirmed categories, then the amount still waiting, so the lines match the project's expenses.
 * FLOW-401 v5: name and amount only. Grouped categories fold into one row that opens in place,
 * and in the month view a small up mark sits on a category above its usual month.
 */
export function ProjectCategories({
  project,
  search,
  categorySearch = search,
  categoryTo,
  period,
  sampleGroups,
  sampleMonths,
}: {
  project: NonNullable<ProjectDetail>;
  search: string;
  /** The category list opens on the project's period. */
  categorySearch?: string;
  categoryTo?: string;
  /** The project's period. Without it (a sample) nothing is read. */
  period?: PeriodChoice;
  /** Stories: the group of each category id. */
  sampleGroups?: Record<string, string>;
  /** Stories: project_category_months rows for the month shown. */
  sampleMonths?: ProjectCategoryMonthRow[];
}) {
  const live = period != null;
  const categories = useCategoriesQuery(live);
  const months = useProjectCategoryMonthsQuery(live ? project.id : "", period ?? null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const groupOf = new Map<string, string>(Object.entries(sampleGroups ?? {}));
  for (const row of categories.data ?? []) {
    if (row.group_name != null && row.group_name !== "") groupOf.set(row.id, row.group_name);
  }
  const monthRows = sampleMonths ?? months.data?.categories ?? null;
  const pendingOther = project.pending_other_currencies ?? [];
  // pending_count counts every waiting line; the non-ILS ones get their own rows below.
  const pendingOtherCount = pendingOther.reduce((sum, bucket) => sum + bucket.count, 0);
  const pending = Math.max(0, (project.pending_count ?? 0) - pendingOtherCount);
  const waiting = pending > 0;
  const categoryRows: CategoryLine[] = project.categories_by_currency ?? project.categories.map((category) => ({
    currency: "ILS" as const,
    id: category.id,
    name: category.name,
    amount_minor: category.amount_agorot,
    has_shared_share: category.has_shared_share,
  }));
  const grouped = new Map<string, CategoryLine[]>();
  for (const row of categoryRows) {
    const list = grouped.get(row.currency) ?? [];
    list.push(row);
    grouped.set(row.currency, list);
  }
  const currencies = [...grouped.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === "ILS") return -1;
    if (b === "ILS") return 1;
    return a.localeCompare(b);
  });
  const hasCategories = currencies.some((currency) => (grouped.get(currency)?.length ?? 0) > 0);
  if (!hasCategories && !waiting && pendingOther.length === 0) {
    return <p className="ui-page-pad t-hint">אין עדיין הוצאות מסווגות.</p>;
  }

  function categoryRow(item: CategoryItem) {
    const { line } = item;
    const href = line.id != null && !item.missing
      ? (categoryTo ?? categoryHref(project.id, line.id, line.currency, categorySearch))
      : undefined;
    return (
      <ListRow
        key={`${line.currency}:${line.id ?? line.name ?? ""}`}
        variant="project"
        title={line.name ?? "בלי קטגוריה"}
        agorot={absAgorot(line.amount_minor)}
        currency={line.currency}
        loss={false}
        mark={item.up ? <UpMark /> : undefined}
        missing={item.missing ? NOT_IN_YET : undefined}
        chevron={href != null}
        href={href}
        wrapHint={line.has_shared_share === true}
        hint={line.has_shared_share === true ? (
          <span className="ui-shared-note t-hint">כולל חלק מהוצאות משותפות</span>
        ) : undefined}
      />
    );
  }

  // The section is titled הוצאות, so the figures carry no minus (FLOW-328).
  return (
    <List>
      {currencies.flatMap((currency) => categoryEntries(grouped.get(currency) ?? [], groupOf, monthRows).map((entry) => {
        if (entry.kind === "category") return categoryRow(entry);
        const key = `${entry.currency}:${entry.name}`;
        const expanded = open.has(key);
        return (
          <CategoryGroupRow
            key={`group:${key}`}
            name={entry.name}
            agorot={absAgorot(entry.amount_minor)}
            currency={entry.currency}
            up={entry.up && !expanded}
            expanded={expanded}
            onToggle={() => {
              setOpen((current) => {
                const next = new Set(current);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                return next;
              });
            }}
          >
            {entry.items.map(categoryRow)}
          </CategoryGroupRow>
        );
      }))}
      {waiting ? (
        <ListRow
          variant="project"
          title={pendingApprovalTitle(pending)}
          agorot={absAgorot(project.pending_agorot ?? 0n)}
          currency="ILS"
          loss={false}
          chevron
          href={`/review${withParam(search, "project", project.id)}`}
        />
      ) : null}
      {pendingOther.map((bucket) => (
        <ListRow
          key={bucket.currency}
          variant="project"
          title={pendingApprovalTitle(bucket.count)}
          agorot={absAgorot(bucket.expense_minor)}
          currency={bucket.currency}
          loss={false}
          chevron
          href={`/review${withParam(search, "project", project.id)}`}
        />
      ))}
    </List>
  );
}
