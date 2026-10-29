import "../ui/lazy.css";
import type { BreakdownLinesPage } from "@flow/shared";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { lineInitials } from "../cash-lines-groups";
import { getSupabase } from "../lib/supabase";
import { loadReadSchemas } from "../load-read-schemas";
import { useHomePreview, usePreviewSearch } from "../preview";
import { categoryName, dateRangeText, reportStateOf } from "../reports";
import { Amount } from "../ui/amount";
import { PageLoadFailed, useOnline } from "../ui/band-states";
import { Button } from "../ui/button";
import { HEBREW_MONTHS } from "../ui/date-math";
import { rowSource } from "../ui/line-marks";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { SearchField } from "../ui/search-field";
import { ProfitRowsSkeleton } from "../ui/screen-skeletons";
import { DelayedSkeleton } from "../ui/skeleton";
import { waitForAccessToken } from "../wait-for-session";
import { memo, useDeferredValue, useEffect, useMemo, useState } from "react";
import { SearchSnippet, searchText, searchWords } from "./report-lines-snippet";
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
    // One project's report: its lines, read by project (FLOW-165).
    projectId: ((scope) => (scope.kind === "project" ? scope.id : null))(reportStateOf(params).scope),
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
    ...(args.projectId != null ? { p_project_id: args.projectId } : {}),
    p_limit: PAGE,
    p_offset: offset,
  });
  if (error) throw error;
  // Null: the project is not this company's (or is gone); it has no lines here.
  const page = (await loadReadSchemas()).breakdownLinesSchema.parse(data);
  return page ?? { rows: [], has_more: false };
}

/** The rows by month, newest first: "אוקטובר 2026" and its lines. */
export function linesByMonth<Row extends { doc_date: string }>(rows: readonly Row[]): { key: string; title: string; rows: Row[] }[] {
  const groups = new Map<string, Row[]>();
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
 * Whether a line matches the search (owner, 2026-10-29): every word is in its supplier, description,
 * project, date (dd/mm) or amount ("189.15", "189"). An empty search matches every line.
 */
export function lineMatches(row: LineRow, query: string, { description = true } = {}): boolean {
  const words = searchWords(query);
  if (words.length === 0) return true;
  const abs = row.amount_minor < 0n ? -row.amount_minor : row.amount_minor;
  const amount = `${String(abs / 100n)}.${String(abs % 100n).padStart(2, "0")}`;
  const haystack = searchText([row.supplier_name ?? "", description ? row.description : "", row.project_name ?? "בלי פרויקט", `${row.doc_date.slice(8, 10)}/${row.doc_date.slice(5, 7)}`, amount].join(" "));
  return words.every((word) => haystack.includes(word));
}

/** Whether the search matched the line only through the description its title (the supplier) hides. */
function matchedByDescription(row: LineRow, query: string): boolean {
  return row.supplier_name != null && searchText(query) !== "" && !lineMatches(row, query, { description: false });
}

/**
 * A row's title and hint: the supplier over its date and project. When the search matched only the
 * description the supplier hides, the description is the title and the supplier moves to the hint
 * (FLOW-167); a project one of the words matched stays in the hint, after the supplier, which names
 * the line (FLOW-169, "heater cedar"; review of #868). A description title wraps while a search is on (`wrap`, up to three lines) and is
 * drawn by `SearchSnippet`, which starts it late when the matched words would fall past those lines;
 * `full` keeps the whole text for screen readers. A line with no supplier is titled by its description
 * already.
 */
export function lineText(row: LineRow, query: string): { title: string; full: string | null; hint: string; wrap: boolean } {
  const date = `${row.doc_date.slice(8, 10)}/${row.doc_date.slice(5, 7)}`;
  const project = row.project_name ?? "בלי פרויקט";
  const byDescription = matchedByDescription(row, query) || (row.supplier_name == null && searchText(query) !== "");
  if (!byDescription) return { title: row.supplier_name ?? row.description, full: null, hint: `${date} · ${project}`, wrap: false };
  if (row.supplier_name == null) return { title: row.description, full: row.description, hint: `${date} · ${project}`, wrap: true };
  const projectText = searchText(project);
  const matchedProject = searchWords(query).some((word) => projectText.includes(word));
  const hint = matchedProject ? `${date} · ${row.supplier_name} · ${project}` : `${date} · ${row.supplier_name}`;
  return { title: row.description, full: row.description, hint, wrap: true };
}

/** The app's search for the same words in this category ("none": the lines with no category, as /search reads it), all dates, keeping the preview flag. */
export function searchPath(query: string, category: string, search: string): string {
  const params = new URLSearchParams(search);
  params.set("q", query.trim());
  params.set("category", category);
  return `/search?${params.toString()}`;
}

/** A search shows once the list is long enough to need it. */
const SEARCH_FROM = 6;

/**
 * FLOW-161 (board ReportCategoryDrill): one category's lines for the report's period: the total, its split by
 * project, and the lines by month, each opening the transaction page. One project's report reads that
 * project's lines, page by page (FLOW-165).
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
  const [query, setQuery] = useState("");
  // The list, its count and its hints follow a deferred copy, so typing stays quick on a long period:
  // the field updates at once, and the memoized list below renders again only for the deferred words.
  const deferred = useDeferredValue(query);
  const searching = searchText(deferred) !== "";
  const read = useInfiniteQuery({
    queryKey: ["breakdown-lines", "report", preview, args.side, args.category, args.from ?? "", args.to ?? "", currency, args.projectId ?? ""],
    enabled: sample == null && preview === "off",
    initialPageParam: 0,
    queryFn: ({ pageParam }) => fetchPage(args, currency, pageParam),
    getNextPageParam: (last, pages) => (last.has_more ? pages.length * PAGE : undefined),
  });
  const { fetchNextPage, hasNextPage, isFetchingNextPage, isFetchNextPageError } = read;
  // One project's report reads that project's lines (p_project_id, FLOW-165), so the pages need no filter.
  const pages = read.data?.pages;
  const rows = useMemo(() => sample?.rows ?? pages?.flatMap((page) => page.rows) ?? null, [sample, pages]);
  const shown = useMemo(() => (rows == null ? [] : searching ? rows.filter((row) => lineMatches(row, deferred)) : rows), [rows, searching, deferred]);
  const hasMore = sample?.hasMore ?? read.hasNextPage;
  // A search looks at every line of the period, so it reads the pages not loaded yet too.
  useEffect(() => {
    if (searching && hasNextPage && !isFetchingNextPage && !isFetchNextPageError) void fetchNextPage();
  }, [searching, hasNextPage, isFetchingNextPage, isFetchNextPageError, fetchNextPage]);
  const title = categoryName(args.name);
  // Back to the report, with its own choices (the drill keys ride along and are ignored there).
  const back = `/reports${location.search}`;
  const header = <ScreenHeader layout="stacked" title={title} backTo={back} backText="דוחות" subtitle={args.projectName != null ? `${dateRangeText(args.from, args.to)} · ${args.projectName}` : dateRangeText(args.from, args.to)} />;
  if (rows == null) {
    return (
      <div className="ui-rep-screen">
        {header}
        {read.isError ? <PageLoadFailed title={`${title} לא נטען`} offline={!online} onRetry={() => { void read.refetch(); }} /> : <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>}
      </div>
    );
  }
  // The read's whole-group total and count (FLOW-165), so a long category shows its full figure; the loaded
  // rows are the fallback for an older payload and the fixtures.
  const firstPage = read.data?.pages[0];
  const total = sample == null && firstPage?.total_minor != null ? firstPage.total_minor : rows.reduce((sum, row) => sum + row.amount_minor, 0n);
  const lineCount = sample == null && firstPage?.count != null ? firstPage.count : rows.length;
  const signed = args.side === "income" ? total : -total;
  // The split adds up the loaded rows only: while the summary is the whole group's and pages remain, it is left out.
  const partial = hasMore && lineCount > rows.length;
  const split = partial ? [] : linesByProject(rows);
  // A page that fails stops the read (the effect's guard); the line says so and offers the retry. While the
  // retry runs the query keeps its error, so the line goes back to reading until that page answers.
  const readFailed = searching && sample == null && isFetchNextPageError && !isFetchingNextPage;
  const stillReading = searching && sample == null && hasNextPage && !readFailed;
  const collapse: Collapse = { isOpen: () => splitOpen, onToggle: () => { setSplitOpen((open) => !open); } };
  return (
    <div className="ui-rep-screen">
      {header}
      <div className="ui-rep-content">
        <ReportSummary label={args.side === "income" ? "הכנסות" : "הוצאות"} amount={signed} currency={currency} loss={false} sub={lineCount === 1 ? "תנועה אחת" : `${String(lineCount)} תנועות${hasMore && lineCount === rows.length ? " ועוד" : ""}`} />
        {rows.length >= SEARCH_FROM || hasMore ? (
          <div className="ui-rep-search">
            <SearchField label="חיפוש בתנועות" value={query} onChange={setQuery} placeholder="ספק, פרויקט, סכום או תאריך" busy={stillReading} />
            {/* Mounted before the first word, so a screen reader hears the first count too. */}
            <p className="t-caption t-muted" role="status">
              {!searching ? "" : readFailed ? `${shown.length === 0 ? "אין התאמות" : `${String(shown.length)} מתאימות`} בתנועות שנטענו. חלק מהתנועות לא נטענו.` : stillReading ? "מחפשים בכל התנועות…" : shown.length === 0 ? "אין תנועות שמתאימות לחיפוש" : shown.length === 1 ? "תנועה אחת מתאימה" : `${String(shown.length)} תנועות מתאימות`}
            </p>
            {searching && shown.length === 0 && !stillReading && !readFailed ? (
              <Button variant="secondary" to={searchPath(deferred, args.category, search)}>לחיפוש בכל התנועות</Button>
            ) : null}
            {readFailed ? <Button variant="secondary" onClick={() => { void fetchNextPage(); }}>נסו שוב</Button> : null}
          </div>
        ) : null}
        {split.length > 1 && !searching ? (
          <ReportSection id="split" title="לפי פרויקט" total={<span className="t-muted">{String(split.length)}</span>} collapse={collapse}>
            <ul className="ui-rep-rows">
              {split.map((item) => <ReportRow key={item.name} name={item.name} amount={<Amount agorot={args.side === "income" ? item.total : -item.total} currency={currency} />} />)}
            </ul>
          </ReportSection>
        ) : null}
        <LineGroups rows={shown} query={deferred} side={args.side} search={search} />
        {hasMore && !searching ? (
          <div className="ui-rep-more-wrap">
            <Button variant="secondary" busy={read.isFetchingNextPage} onClick={() => { void read.fetchNextPage(); }}>עוד תנועות</Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** The lines by month. Memoized, so a keystroke the list has not caught up with does not render it again. */
const LineGroups = memo(function LineGroups({ rows, query, side, search }: { rows: readonly LineRow[]; query: string; side: "income" | "expense"; search: string }) {
  return linesByMonth(rows).map((group) => (
    <section key={group.key} className="ui-lines-group" aria-label={group.title}>
      <div className="ui-lines-group-head">
        <h2 className="t-section ui-lines-group-title">{group.title}</h2>
      </div>
      <List layout="flat">
        {group.rows.map((row) => {
          const text = lineText(row, query);
          return (
            <ListRow
              key={`${row.transaction_id}:${row.part ?? ""}`}
              layout="flat"
              variant="transaction"
              title={text.wrap ? <SearchSnippet key={query} text={text.title} query={query} /> : text.title}
              wrapTitle={text.wrap}
              titleFull={text.full ?? undefined}
              hint={text.hint}
              agorot={row.amount_minor}
              currency={row.currency}
              sign={side === "income" ? "in" : "out"}
              source={rowSource(row.source)}
              initials={lineInitials(row.supplier_name ?? row.description)}
              href={`/transactions/${row.transaction_id}${search}`}
            />
          );
        })}
      </List>
    </section>
  ));
});
