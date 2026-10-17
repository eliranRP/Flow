import { onlineManager } from "@tanstack/react-query";
import type { SearchRow } from "@flow/shared";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import * as searchE2eFixture from "../dev/search-e2e-fixture";
import { allTime, periodPillLabel, presetPeriod } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase, type ScreenPhase } from "../query-phase";
import {
  EMPTY_FILTERS,
  SEARCH_DEBOUNCE_MS,
  SEARCH_MAX_LENGTH,
  filterSearchRows,
  hasChipFilters,
  readSearchFilters,
  searchCountWords,
  searchRowAmount,
  searchRowTotals,
  searchMonthTotals,
  searchRowTitle,
  searchTotalText,
  useDebounced,
  uniqueSearchRows,
  useSearchQuery,
  type SearchFilters,
} from "../search";
import { txnListState } from "../txn-nav";
import { useCategoriesQuery, useDashboardQuery } from "../use-books";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { ErrorState } from "../ui/error-state";
import { BackIcon, CloseIcon } from "../ui/icons";
import { IconButton } from "../ui/icon-button";
import { ListRow } from "../ui/list-row";
import { MonthList } from "../ui/month-list";
import { wantsSearchFocus } from "../ui/search-entry";
import { SearchField } from "../ui/search-field";
import { TabBar } from "../ui/tab-bar";
import type { StatementDetail } from "../ui/statement";
import { SearchFilterSheet, activeFilterCount, type SearchSheetProject } from "./search-filter-sheet";
import { SearchEmptyState, SearchingRows } from "./search-parts";
import { SearchStart, type QuickCheck } from "./search-start";
import { readRecentSearches, rememberRecentSearch } from "./search-recent";

export type SearchProject = SearchSheetProject;
export type SearchCategory = { id: string; name: string; kind: "expense" | "income"; hidden?: boolean };

/** Storybook and dev rows. The screen filters them with the server's rules for what it can see. */
export type SearchSample = {
  rows: SearchRow[];
  projects?: SearchProject[];
  categories?: SearchCategory[];
  /** Loading or a failed read, as the live screen would show it. */
  phase?: ScreenPhase;
  /** More lines than shown (the live screen's paging). */
  total?: number;
};

/** Dev-only fixture. A production build folds this to null and drops the module. */
const searchE2e = import.meta.env.DEV ? searchE2eFixture : null;

/** Each history entry keeps the filters it showed, so Back from a line reopens the same list. */
const remembered = new Map<string, { filters: SearchFilters; text: string }>();
const REMEMBER_MAX = 30;
/** History entries whose arrival already focused the field, with the visit that did it. */
const focusedEntries = new Map<string, object>();
/** The first entry of a page load (and every Storybook router). It is never remembered. */
const FIRST_ENTRY = "default";

function remember(key: string, filters: SearchFilters, text: string) {
  if (key === FIRST_ENTRY) return;
  remembered.delete(key);
  remembered.set(key, { filters, text });
  while (remembered.size > REMEMBER_MAX) {
    const oldest = remembered.keys().next().value;
    if (oldest == null) break;
    remembered.delete(oldest);
  }
}

/** Test hook: a fresh module state between unit tests. */
export function resetSearchMemory(): void {
  remembered.clear();
  focusedEntries.clear();
}

/** The two letters a project's shortcut shows, as the board's 36px tile does. */
function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word.charAt(0)).join("").toUpperCase();
}

/**
 * FLOW-368: one field with סינון beside it. Before anything is typed the screen offers the last
 * searches and three ready checks; once it has text or a filter, it shows the results with the
 * count, a project shortcut when the text names a project, and the months. A row opens the
 * transaction, and ˄ ˅ there walk the results.
 */
export function SearchScreen({ sample }: { sample?: SearchSample } = {}) {
  const location = useLocation();
  const preview = useHomePreview();
  const previewSearch = usePreviewSearch();
  // Any preview value other than the states above reads as "empty" here; `search` is the board's sample.
  const boardSample = import.meta.env.DEV && new URLSearchParams(location.search).get("preview") === "search";
  const fixture = sample == null && preview === "empty"
    ? (boardSample ? searchE2e?.searchBoardFixture() : searchE2e?.searchE2eFixture()) ?? null
    : null;
  const local: SearchSample | null = sample ?? fixture;
  const [initial] = useState(() => {
    const kept = location.key === FIRST_ENTRY ? undefined : remembered.get(location.key);
    if (kept) return kept;
    const filters = readSearchFilters(new URLSearchParams(location.search), new Date(), { ids: local == null && preview === "off" ? "uuid" : "any" });
    return { filters, text: filters.q };
  });
  const [filters, setFilters] = useState<SearchFilters>(initial.filters);
  const [text, setText] = useState(initial.text);
  const [recent, setRecent] = useState<string[]>(() => (boardSample && searchE2e ? [...searchE2e.boardRecents] : readRecentSearches()));
  // `?sheet=filters` opens the sheet on arrival: a dev-only query the board proofs use.
  const [sheetOpen, setSheetOpen] = useState(() => import.meta.env.DEV && new URLSearchParams(location.search).get("sheet") === "filters");
  const [draft, setDraft] = useState<SearchFilters>(filters);
  const filterBtnRef = useRef<HTMLButtonElement>(null);
  const settled = useDebounced(text, SEARCH_DEBOUNCE_MS);
  const active = useMemo(() => ({ ...filters, q: settled }), [filters, settled]);
  const [entryKey] = useState(location.key);
  useEffect(() => {
    remember(entryKey, { ...filters, q: text }, text);
  }, [entryKey, filters, text]);

  const live = local == null;
  const typed = settled.trim();
  const filtered = typed !== "" || hasChipFilters(active);
  // The list is read only once something is typed or filtered: the start shows the checks instead.
  const query = useSearchQuery(active, live && filtered);
  const dashboard = useDashboardQuery(live);
  const categoryQuery = useCategoriesQuery(live);
  const phase: ScreenPhase = local
    ? sample?.phase ?? { kind: "ready" }
    : screenPhase(preview, query);
  const localRows = useMemo(() => (local ? filterSearchRows(local.rows, active) : null), [local, active]);
  const rows = localRows ?? uniqueSearchRows(query.data?.pages ?? []);
  const total = localRows ? Math.max(sample?.total ?? 0, localRows.length) : query.data?.pages[0]?.total ?? 0;
  // Live: done when the server has no next page (a repeated line, dropped above, still ends it).
  const complete = localRows ? rows.length >= total : !query.hasNextPage;
  // Live: every month's totals come with the first page, so a month still paging shows its own.
  const monthTotals = useMemo(() => searchMonthTotals(localRows ? null : query.data?.pages[0]?.months), [localRows, query.data]);
  // The count line's money: every matching line (the server's months), or the sample's rows.
  const totalText = useMemo(
    () => searchTotalText(monthTotals ? [...monthTotals.values()].flat() : searchRowTotals(rows)),
    [monthTotals, rows],
  );
  const refreshing = live && query.isPlaceholderData;
  const projects: SearchProject[] = local?.projects ?? dashboard.data?.projects ?? [];
  const categoryList: SearchCategory[] = local?.categories ?? categoryQuery.data ?? [];
  const categories = categoryList.filter((category) => category.hidden !== true);

  // The quick checks' counts, read on the start only. The month's first page decides the busiest
  // project (its most lines), so a month with more lines than one page may name another project.
  // The board's sample pins its month, so its proof does not drift after the month turns.
  const [checkNow] = useState(() => (boardSample ? new Date(2026, 9, 17) : new Date()));
  const reviewFilters = useMemo<SearchFilters>(() => ({ ...EMPTY_FILTERS, review: true }), []);
  const incomeFilters = useMemo<SearchFilters>(() => ({ ...EMPTY_FILTERS, direction: "income", period: presetPeriod("month", checkNow) }), [checkNow]);
  const monthFilters = useMemo<SearchFilters>(() => ({ ...EMPTY_FILTERS, period: presetPeriod("month", checkNow) }), [checkNow]);
  const reviewQuery = useSearchQuery(reviewFilters, live && !filtered);
  const incomeQuery = useSearchQuery(incomeFilters, live && !filtered);
  const monthQuery = useSearchQuery(monthFilters, live && !filtered);

  // The sheet counts its own draft, live, so "הצגת N תנועות" follows each tap.
  const draftActive = useMemo(() => ({ ...draft, q: active.q }), [draft, active.q]);
  const sheetQuery = useSearchQuery(draftActive, live && sheetOpen);
  const draftCount = local ? filterSearchRows(local.rows, draftActive).length : sheetQuery.data?.pages[0]?.total ?? null;

  // A fresh visit from the search icon types straight away. The title took focus first (its
  // effect runs before this one), so this wins. The icon's link state asks for focus once per
  // history entry: Back to the same entry finds it taken by an earlier visit and leaves focus
  // where it returns. StrictMode's second effect pass is the same visit, so it focuses again.
  const inputRef = useRef<HTMLInputElement>(null);
  // Read once on mount: a later change of the entry never moves focus.
  const arrival = useRef({ key: location.key, wants: wantsSearchFocus(location.state) });
  useEffect(() => {
    const { key, wants } = arrival.current;
    if (!wants) return;
    const owner = focusedEntries.get(key);
    if (owner != null && owner !== arrival.current) return;
    focusedEntries.set(key, arrival.current);
    while (focusedEntries.size > REMEMBER_MAX) {
      const oldest = focusedEntries.keys().next().value;
      if (oldest == null) break;
      focusedEntries.delete(oldest);
    }
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  const backTo = `/${previewSearch}`;
  const ids = rows.map((row) => row.id);
  const listFrom = `${location.pathname}${location.search}`;
  const projectName = (id: string | null) =>
    id == null ? null : id === "none" ? "בלי פרויקט" : projects.find((project) => project.id === id)?.name ?? null;
  const categoryName = (id: string | null) =>
    id == null ? null : id === "none" ? "בלי קטגוריה" : categories.find((category) => category.id === id)?.name ?? null;
  const update = (patch: Partial<SearchFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  };
  const clearChips = () => {
    setFilters((current) => ({ ...current, direction: null, period: allTime(), project: null, category: null, review: false }));
  };
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setText("");
  };
  const search = (value: string) => {
    setText(value);
    setRecent(rememberRecentSearch(value));
  };
  const openSheet = () => {
    setDraft(filters);
    setSheet(true);
  };
  const setSheet = useSheetHistory("search-filters", sheetOpen, setSheetOpen);
  const applyDraft = () => {
    setFilters((current) => ({
      ...current,
      direction: draft.direction,
      period: draft.period,
      project: draft.project,
      review: draft.review,
    }));
    setSheet(false);
  };

  const chips: Array<{ key: string; label: string; remove: () => void }> = [];
  if (filters.direction) chips.push({ key: "direction", label: filters.direction === "income" ? "הכנסות" : "הוצאות", remove: () => { update({ direction: null }); } });
  if (filters.period.kind !== "all") chips.push({ key: "period", label: periodPillLabel(filters.period), remove: () => { update({ period: allTime() }); } });
  if (filters.project != null) chips.push({ key: "project", label: projectName(filters.project) ?? "פרויקט", remove: () => { update({ project: null }); } });
  if (filters.category != null) chips.push({ key: "category", label: categoryName(filters.category) ?? "קטגוריה", remove: () => { update({ category: null }); } });
  if (filters.review) chips.push({ key: "review", label: "ממתינים לאישור", remove: () => { update({ review: false }); } });

  // The three checks (FLOW-368 §2.2). The busiest project is the one with the most lines this month.
  const monthRows = useMemo(
    () => (local ? filterSearchRows(local.rows, monthFilters) : uniqueSearchRows(monthQuery.data?.pages ?? [])),
    [local, monthFilters, monthQuery.data],
  );
  const busiest = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of monthRows) {
      if (row.project_id == null) continue;
      counts.set(row.project_id, (counts.get(row.project_id) ?? 0) + 1);
    }
    let best: { id: string; count: number } | null = null;
    for (const [id, count] of counts) if (best == null || count > best.count) best = { id, count };
    return best;
  }, [monthRows]);
  const busiestName = busiest == null ? null : projects.find((project) => project.id === busiest.id)?.name ?? null;
  // The project check counts every line of the project, as tapping it shows them (all time).
  const projectFilters = useMemo<SearchFilters>(() => ({ ...EMPTY_FILTERS, project: busiest?.id ?? null }), [busiest?.id]);
  const projectQuery = useSearchQuery(projectFilters, live && !filtered && busiest != null);
  const projectAllCount = local ? filterSearchRows(local.rows, projectFilters).length : projectQuery.data?.pages[0]?.total ?? null;
  const monthName = new Intl.DateTimeFormat("he-IL", { month: "long" }).format(checkNow);
  const countOf = (pages: { total: number } | undefined, applied: SearchFilters) => (
    local ? filterSearchRows(local.rows, applied).length : pages?.total ?? null
  );
  const checks: QuickCheck[] = [
    {
      key: "review",
      title: "ממתינים לאישור",
      hint: "תנועות ש־Flow לא בטוח לגביהן",
      count: countOf(reviewQuery.data?.pages[0], reviewFilters),
      onPick: () => { update({ review: true }); },
    },
    {
      key: "income",
      title: "הכנסות החודש",
      hint: `כל מה שנכנס ב${monthName}`,
      count: countOf(incomeQuery.data?.pages[0], incomeFilters),
      onPick: () => { update({ direction: "income", period: presetPeriod("month", checkNow) }); },
    },
  ];
  if (busiestName != null && busiest != null) {
    checks.push({
      key: "project",
      title: busiestName,
      hint: "כל התנועות של הפרויקט",
      count: projectAllCount,
      onPick: () => { update({ project: busiest.id }); },
    });
  }

  const shortcut = typed.length >= 3
    ? projects.find((project) => project.name.toLowerCase().includes(typed.toLowerCase())) ?? null
    : null;

  // The first read with text, before any line is in hand: the searching view, with no tab bar.
  const searching = filtered && (phase.kind === "loading" || (rows.length === 0 && refreshing));
  let body;
  if (!filtered) {
    body = <SearchStart recent={recent} checks={checks} onRecent={search} />;
  } else if (searching) {
    body = <SearchingRows allTime={active.period.kind === "all"} />;
  } else if (phase.kind === "error") {
    body = (
      <ErrorState
        offline={phase.offline || !onlineManager.isOnline()}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else if (rows.length === 0) {
    body = <SearchEmptyState text={typed} withChips={hasChipFilters(active)} onClearChips={clearChips} />;
  } else {
    body = (
      <>
        <p className="ui-search-count" role="status">
          <span>
            {searchCountWords(total)}
            {totalText != null ? (
              <>
                {" · "}
                <bdi dir="ltr" className="ui-num">{totalText}</bdi>
              </>
            ) : null}
          </span>
          {refreshing ? <span className="ui-spinner" role="img" aria-label="מחפש" /> : null}
        </p>
        {shortcut != null ? (
          <Link className="ui-search-project" to={`/projects/${shortcut.id}`}>
            <span className="ui-search-project-tile" aria-hidden="true">{initialsOf(shortcut.name)}</span>
            <span className="ui-search-project-text">
              <span className="ui-search-project-name">{shortcut.name}</span>
              <span className="ui-search-project-hint">פרויקט · לדף הפרויקט</span>
            </span>
            <span className="ui-search-project-chevron" aria-hidden="true">
              <BackIcon size={18} />
            </span>
          </Link>
        ) : null}
        <MonthList
          rows={rows}
          keyOf={(row) => row.id}
          dateOf={(row) => row.doc_date}
          amountOf={searchRowAmount}
          complete={complete}
          monthTotals={monthTotals}
          cents
          signedTotal
          renderRow={(row) => (
            <ListRow
              variant="statement"
              title={searchRowTitle(row)}
              fallback="invoice"
              match={typed}
              details={searchRowDetails(row)}
              note={row.waiting_review ? "ממתין לאישור" : undefined}
              setAside={row.kept_out}
              agorot={row.amount_net}
              currency={row.currency}
              sign={row.direction === "income" ? "in" : "out"}
              href={`/transactions/${row.id}${previewSearch}`}
              state={txnListState(ids, row.id, listFrom)}
            />
          )}
        />
        {!complete && live && query.hasNextPage ? (
          <div className="ui-page-pad ui-search-more">
            <Button
              variant="pill"
              busy={query.isFetchingNextPage}
              onClick={() => {
                void query.fetchNextPage();
              }}
            >
              עוד תנועות
            </Button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <div className="ui-search-screen">
      <div className="ui-search-head">
        <div className="ui-search-row">
          {searching ? null : (
            <IconButton to={backTo} label="חזרה לבית" className="ui-search-back">
              <BackIcon size={20} />
            </IconButton>
          )}
          <form
            role="search"
            className="ui-search-form"
            onSubmit={(event) => {
              event.preventDefault();
              search(text);
            }}
          >
            <SearchField
              label="חיפוש תנועות"
              value={text}
              onChange={setText}
              placeholder="ספק, לקוח, פרויקט או סכום"
              inputRef={inputRef}
              maxLength={SEARCH_MAX_LENGTH}
              busy={query.isFetching && filtered}
            />
          </form>
          {searching ? (
            <Link className="ui-search-cancel" to={backTo}>ביטול</Link>
          ) : (
            <button ref={filterBtnRef} type="button" className="ui-search-filter-btn" onClick={openSheet} aria-haspopup="dialog">
              סינון
              {activeFilterCount(filters) > 0 ? (
                <span className="ui-search-badge">{String(activeFilterCount(filters))}</span>
              ) : null}
            </button>
          )}
        </div>
        {chips.length > 0 ? (
          <div className="ui-search-active" role="list" aria-label="הסינון שנבחר">
            {chips.map((chip) => (
              <div role="listitem" key={chip.key}>
                <button
                  type="button"
                  className="ui-chip ui-chip-choice ui-search-active-chip"
                  aria-label={`הסרת ${chip.label}`}
                  onClick={() => {
                    chip.remove();
                    // The chip unmounts with its filter; focus goes to סינון so keyboard users keep their place.
                    filterBtnRef.current?.focus();
                  }}
                >
                  <span className="ui-chip-label" data-clip-ok="">{chip.label}</span>
                  <span className="ui-search-active-x" aria-hidden="true">
                    <CloseIcon size={12} />
                  </span>
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
      <div className="ui-search-results">
        {body}
        {!searching ? <TabBar section="home" /> : null}
      </div>
      <SearchFilterSheet
        open={sheetOpen}
        onOpenChange={setSheet}
        edit={draft}
        onDraft={(patch) => { setDraft((current) => ({ ...current, ...patch })); }}
        projects={projects}
        count={draftCount}
        onClear={() => { setDraft((current) => ({ ...current, direction: null, period: allTime(), project: null, review: false })); }}
        onApply={applyDraft}
      />
    </div>
  );
}

/**
 * Line 2 of a result (FLOW-368 §2.1): the day and month, the project, the category, all muted on one
 * line. A kept-out line adds "לא נספר ברווח" (decision 0141 log). "ממתין לאישור" is the line 3 note.
 */
export function searchRowDetails(row: Pick<SearchRow, "kept_out" | "doc_date" | "project_name" | "category_name">): StatementDetail[] {
  const details: StatementDetail[] = [{ text: `${row.doc_date.slice(8, 10)}/${row.doc_date.slice(5, 7)}` }];
  if (row.project_name) details.push({ text: row.project_name });
  if (row.category_name) details.push({ text: row.category_name });
  if (row.kept_out) details.push({ text: "לא נספר ברווח" });
  return details;
}
