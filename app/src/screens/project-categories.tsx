import type { CategoryRow, ProjectCategoryMonthRow, ProjectDetail } from "@flow/shared";
import { useState } from "react";
import { absAgorot } from "../agorot";
import { isCurrentPeriod, type PeriodChoice } from "../period";
import { categoryEntries, missingRows, useProjectCategoryMonthsQuery, type CategoryItem, type CategoryLine } from "../project-category-months";
import { useCategoriesQuery } from "../use-books";
import { CategoryGroupRow, UpMark } from "../ui/category-group-row";
import { InboxIcon } from "../ui/icons";
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
/** FLOW-406 (decision 0164): a parent's own lines, last inside its fold. */
export const OWN_LINES = "בלי תת-קטגוריה";

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
  sampleCategories,
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
  /** Stories: list_categories rows, for the parents (FLOW-406). */
  sampleCategories?: CategoryRow[];
  /** Stories: project_category_months rows for the month shown. */
  sampleMonths?: ProjectCategoryMonthRow[];
}) {
  const live = period != null;
  const categories = useCategoriesQuery(live);
  const months = useProjectCategoryMonthsQuery(live ? project.id : "", period ?? null);
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const groupOf = new Map<string, string>(Object.entries(sampleGroups ?? {}));
  // FLOW-406: a sub-category folds under its parent, and the parent's own lines join it as
  // "בלי תת-קטגוריה". An older payload with no parent ids folds by group_name.
  const own = new Set<string>();
  const listed = sampleCategories ?? categories.data ?? [];
  const names = new Map(listed.map((row) => [row.id, row.name]));
  for (const row of listed) {
    const parentName = row.parent_id == null ? undefined : names.get(row.parent_id);
    if (row.parent_id != null && parentName != null) {
      groupOf.set(row.id, parentName);
      groupOf.set(row.parent_id, parentName);
      own.add(row.parent_id);
    } else if (row.group_name != null && row.group_name !== "") {
      groupOf.set(row.id, row.group_name);
    }
  }
  // A past month's missing bill never came: "—" with "not in yet" is only for the open month.
  const current = period == null || isCurrentPeriod(period);
  const allMonthRows = sampleMonths ?? months.data?.categories ?? null;
  const monthRows = current ? allMonthRows : (allMonthRows ?? []).filter((row) => row.flag !== "missing");
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
  // A currency with only a bill not in yet still gets its "—" rows.
  for (const row of monthRows ?? []) {
    if (row.flag === "missing" && row.id != null && !grouped.has(row.currency)) grouped.set(row.currency, []);
  }
  const currencies = [...grouped.keys()].sort((a, b) => {
    if (a === b) return 0;
    if (a === "ILS") return -1;
    if (b === "ILS") return 1;
    return a.localeCompare(b);
  });
  const hasCategories = currencies.some((currency) => (grouped.get(currency)?.length ?? 0) > 0 || missingRows(monthRows, currency).length > 0);
  if (!hasCategories && !waiting && pendingOther.length === 0) {
    return <p className="ui-page-pad t-hint">אין עדיין הוצאות מסווגות.</p>;
  }

  function categoryRow(item: CategoryItem, inGroup = false) {
    const { line } = item;
    const href = line.id != null && !item.missing
      ? (categoryTo ?? categoryHref(project.id, line.id, line.currency, categorySearch))
      : undefined;
    return (
      <ListRow
        key={`${line.currency}:${line.id ?? line.name ?? ""}`}
        variant="project"
        title={inGroup && line.id != null && own.has(line.id) ? OWN_LINES : line.name ?? "בלי קטגוריה"}
        agorot={absAgorot(line.amount_minor)}
        currency={line.currency}
        loss={false}
        mark={item.up != null ? <UpMark kind={item.up} /> : undefined}
        missing={item.missing ? NOT_IN_YET : undefined}
        chevron={href != null}
        chevronSpace={href == null}
        href={href}
        wrapHint={line.has_shared_share === true}
        hint={line.has_shared_share === true ? (
          <span className="ui-shared-note t-hint">כולל חלק מהוצאות משותפות</span>
        ) : undefined}
      />
    );
  }

  // The section is titled הוצאות, so the figures carry no minus (FLOW-328).
  // FLOW-334: the waiting rows carry Home's review icon and tint, so they don't read as categories.
  return (
    <List>
      {currencies.flatMap((currency) => categoryEntries(currency, grouped.get(currency) ?? [], groupOf, monthRows).map((entry) => {
        if (entry.kind === "category") return categoryRow(entry);
        const key = `${entry.currency}:${entry.name}`;
        const expanded = open.has(key);
        return (
          <CategoryGroupRow
            key={`group:${key}`}
            name={entry.name}
            agorot={absAgorot(entry.amount_minor)}
            currency={entry.currency}
            up={expanded ? null : entry.up}
            missing={entry.missing ? NOT_IN_YET : undefined}
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
            {[
              ...entry.items.filter((item) => item.line.id == null || !own.has(item.line.id)),
              ...entry.items.filter((item) => item.line.id != null && own.has(item.line.id)),
            ].map((item) => categoryRow(item, true))}
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
          icon={<InboxIcon />}
          className="ui-row-pending"
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
          icon={<InboxIcon />}
          className="ui-row-pending"
          chevron
          href={`/review${withParam(search, "project", project.id)}`}
        />
      ))}
    </List>
  );
}
