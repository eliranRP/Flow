import "../ui/lazy.css";
import type { BreakdownLinesPage } from "@flow/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { lineInitials } from "../cash-lines-groups";
import { getSupabase } from "../lib/supabase";
import { loadReadSchemas } from "../load-read-schemas";
import { useHomePreview, usePreviewSearch } from "../preview";
import { categoryName, dateRangeText } from "../reports";
import { Amount } from "../ui/amount";
import { PageLoadFailed, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { HEBREW_MONTHS, formatDisplay } from "../ui/date-math";
import { rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { ProfitRowsSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";
import { waitForAccessToken } from "../wait-for-session";
import { useEffect, useState } from "react";
import { ReportRow, ReportSection, ReportSummary, type Collapse } from "./reports-parts";

type LinesPage = NonNullable<BreakdownLinesPage>;
type LineRow = LinesPage["rows"][number];

/** A fixture: the rows the read would return. */
export type ReportLinesSample = { rows: LineRow[]; hasMore?: boolean };

const PAGE = 100;

/** What the drill-down shows, from its query string (the reports screen writes it). */
export function reportLinesArgs(params: URLSearchParams) {
  const side = params.get("side") === "income" ? "income" : "expense";
  return {
    side,
    category: params.get("category") ?? "none",
    name: params.get("name"),
    from: params.get("from"),
    to: params.get("to"),
    projectName: params.get("pname"),
    currency: /^[A-Z]{3}$/.test(params.get("cur") ?? "") ? (params.get("cur") ?? "ILS") : "ILS",
  } as const;
}

async function fetchPage(args: ReturnType<typeof reportLinesArgs>, currency: string, offset: number): Promise<LinesPage> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  await waitForAccessToken(supabase);
  const { data, error } = await supabase.rpc("get_breakdown_lines", {
    ...(args.from != null && args.to != null ? { p_from: args.from, p_to: args.to } : {}),
    p_direction: args.side,
    p_group_by: "category",
    p_group_key: args.category,
    p_currency: currency,
    p_limit: PAGE,
    p_offset: offset,
  });
  if (error) throw error;
  const page = (await loadReadSchemas()).breakdownLinesSchema.parse(data);
  return page ?? { rows: [], has_more: false };
}

/** The rows by month, newest first: "אוקטובר 2026" and its lines. */
export function linesByMonth(rows: readonly LineRow[]): { key: string; title: string; rows: LineRow[] }[] {
  const groups = new Map<string, LineRow[]>();
  for (const row of rows) {
    const key = row.doc_date.slice(0, 7);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return [...groups.entries()]
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .map(([key, list]) => ({ key, title: `${HEBREW_MONTHS[Number(key.slice(5, 7)) - 1] ?? key} ${key.slice(0, 4)}`, rows: list }));
}

/** The rows' totals per project, largest first. */
export function linesByProject(rows: readonly LineRow[]): { name: string; total: bigint }[] {
  const totals = new Map<string, bigint>();
  for (const row of rows) {
    const name = row.project_name ?? "בלי פרויקט";
    totals.set(name, (totals.get(name) ?? 0n) + row.amount_minor);
  }
  return [...totals.entries()].map(([name, total]) => ({ name, total })).sort((a, b) => (a.total === b.total ? a.name.localeCompare(b.name) : b.total > a.total ? 1 : -1));
}

/**
 * FLOW-161 (board ReportCategoryDrill): one category's lines for the report's period: the total, its split by
 * project, and the lines by month, each opening the transaction page. One project's report keeps that project.
 */
export function ReportLinesScreen({ sample }: { sample?: ReportLinesSample } = {}) {
  const location = useLocation();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const online = useOnline();
  const params = new URLSearchParams(location.search);
  const args = reportLinesArgs(params);
  const currency = args.currency;
  const [splitOpen, setSplitOpen] = useState(true);
  const read = useInfiniteQuery({
    queryKey: ["breakdown-lines", "report", preview, args.side, args.category, args.from ?? "", args.to ?? "", currency],
    enabled: sample == null && preview === "off",
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPage(args, currency, pageParam),
    getNextPageParam: (last, pages) => (last.has_more ? pages.length * PAGE : undefined),
  });
  const all = sample?.rows ?? read.data?.pages.flatMap((page) => page.rows) ?? null;
  const rows = all == null ? null : args.projectName == null ? all : all.filter((row) => row.project_name === args.projectName);
  const hasMore = sample?.hasMore ?? read.hasNextPage;
  // The read has no project filter, so a one-project drill-down filters the loaded pages: read them all first.
  const { fetchNextPage, hasNextPage, isFetchingNextPage } = read;
  const filterByProject = args.projectName != null;
  useEffect(() => {
    if (filterByProject && hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [filterByProject, hasNextPage, isFetchingNextPage, fetchNextPage]);
  const title = categoryName(args.name);
  // Back to the report, with its own choices (the drill keys ride along and are ignored there).
  const back = `/reports${location.search}`;
  const header = <ScreenHeader layout="stacked" title={title} backTo={back} backText="דוחות" subtitle={dateRangeText(args.from, args.to, formatDisplay)} />;
  if (rows == null) {
    return (
      <div className="ui-rep-screen">
        {header}
        {read.isError ? <PageLoadFailed title={`${title} לא נטען`} offline={!online} onRetry={() => { void read.refetch(); }} /> : <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>}
      </div>
    );
  }
  const total = rows.reduce((sum, row) => sum + row.amount_minor, 0n);
  const signed = args.side === "income" ? total : -total;
  const split = linesByProject(rows);
  const collapse: Collapse = { isOpen: () => splitOpen, onToggle: () => { setSplitOpen((open) => !open); } };
  return (
    <div className="ui-rep-screen">
      {header}
      <div className="ui-rep-content">
        <ReportSummary label={args.side === "income" ? "הכנסות" : "הוצאות"} amount={signed} currency={currency} loss={false} sub={rows.length === 1 ? "תנועה אחת" : `${String(rows.length)} תנועות${hasMore ? " ועוד" : ""}`} />
        {split.length > 1 ? (
          <ReportSection id="split" title="לפי פרויקט" total={<span className="t-muted">{String(split.length)}</span>} collapse={collapse}>
            <ul className="ui-rep-rows">
              {split.map((item) => <ReportRow key={item.name} name={item.name} amount={<Amount agorot={args.side === "income" ? item.total : -item.total} currency={currency} />} />)}
            </ul>
          </ReportSection>
        ) : null}
        {linesByMonth(rows).map((group) => (
          <section key={group.key} className="ui-lines-group" aria-label={group.title}>
            <div className="ui-lines-group-head">
              <h2 className="t-section ui-lines-group-title">{group.title}</h2>
            </div>
            <List layout="flat">
              {group.rows.map((row) => (
                <ListRow
                  key={`${row.transaction_id}:${row.part ?? ""}`}
                  layout="flat"
                  variant="transaction"
                  title={row.supplier_name ?? row.description}
                  hint={`${row.doc_date.slice(8, 10)}/${row.doc_date.slice(5, 7)} · ${row.project_name ?? "בלי פרויקט"}`}
                  agorot={row.amount_minor}
                  currency={row.currency}
                  sign={args.side === "income" ? "in" : "out"}
                  source={rowSource(row.source)}
                  initials={lineInitials(row.supplier_name ?? row.description)}
                  href={`/transactions/${row.transaction_id}${search}`}
                />
              ))}
            </List>
          </section>
        ))}
        {hasMore ? (
          <div className="ui-rep-more-wrap">
            <Button variant="secondary" busy={read.isFetchingNextPage} onClick={() => { void read.fetchNextPage(); }}>עוד תנועות</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
