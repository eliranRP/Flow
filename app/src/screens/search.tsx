import { onlineManager } from "@tanstack/react-query";
import type { SearchRow } from "@flow/shared";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import * as searchE2eFixture from "../dev/search-e2e-fixture";
import { periodLabel } from "../period";
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
  searchRowTitle,
  useDebounced,
  uniqueSearchRows,
  useSearchQuery,
  type SearchDirection,
  type SearchFilters,
} from "../search";
import { txnListState } from "../txn-nav";
import { useCategoriesQuery, useDashboardQuery } from "../use-books";
import { useSheetHistory } from "../ui/back";
import { Button } from "../ui/button";
import { Chip } from "../ui/chip";
import { EmptyState } from "../ui/empty-state";
import { ErrorState } from "../ui/error-state";
import { DocumentIcon, SearchIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { MonthList } from "../ui/month-list";
import { ChipScroller } from "../ui/chip-scroller";
import { PresetPeriodSheet } from "../ui/period-picker";
import { RadioRow } from "../ui/radio-row";
import { ScreenHeader } from "../ui/screen-header";
import { wantsSearchFocus } from "../ui/search-entry";
import { SearchField } from "../ui/search-field";
import { Sheet } from "../ui/sheet";
import { ListSkeleton } from "../ui/skeleton";
import type { StatementDetail } from "../ui/statement";

export type SearchProject = { id: string; name: string; status?: string };
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

/**
 * FLOW-323 option A: every transaction, newest first, with the search field and the filter chips
 * at the bottom above the keyboard (the thumb zone). FLOW-402 is this screen opened from a
 * project's "כל התנועות" with the project chip set. A row opens the transaction, and ˄ ˅ there
 * walk the results.
 */
export function SearchScreen({ sample }: { sample?: SearchSample } = {}) {
  const location = useLocation();
  const preview = useHomePreview();
  const previewSearch = usePreviewSearch();
  const fixture = sample == null && preview === "empty" ? searchE2e?.searchE2eFixture() ?? null : null;
  const local: SearchSample | null = sample ?? fixture;
  const [initial] = useState(() => {
    const kept = location.key === FIRST_ENTRY ? undefined : remembered.get(location.key);
    if (kept) return kept;
    const filters = readSearchFilters(new URLSearchParams(location.search), new Date(), { ids: local == null && preview === "off" ? "uuid" : "any" });
    return { filters, text: filters.q };
  });
  const [filters, setFilters] = useState<SearchFilters>(initial.filters);
  const [text, setText] = useState(initial.text);
  const settled = useDebounced(text, SEARCH_DEBOUNCE_MS);
  const active = useMemo(() => ({ ...filters, q: settled }), [filters, settled]);
  const [entryKey] = useState(location.key);
  useEffect(() => {
    remember(entryKey, { ...filters, q: text }, text);
  }, [entryKey, filters, text]);

  const live = local == null;
  const query = useSearchQuery(active, live);
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
  const refreshing = live && query.isPlaceholderData;
  const projects: SearchProject[] = local?.projects ?? dashboard.data?.projects ?? [];
  const categoryList: SearchCategory[] = local?.categories ?? categoryQuery.data ?? [];
  const categories = categoryList.filter((category) => category.hidden !== true);

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

  const screenRef = useRef<HTMLDivElement>(null);
  const dockRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const dock = dockRef.current;
    const screen = screenRef.current;
    if (!dock || !screen || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      screen.style.setProperty("--search-dock", `${String(Math.ceil(dock.getBoundingClientRect().height))}px`);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(dock);
    return () => {
      observer.disconnect();
    };
  }, []);

  const listFrom = `${location.pathname}${location.search}`;
  const ids = rows.map((row) => row.id);
  const projectName = (id: string | null) =>
    id == null ? null : id === "none" ? "בלי פרויקט" : projects.find((project) => project.id === id)?.name ?? null;
  const categoryName = (id: string | null) =>
    id == null ? null : id === "none" ? "בלי קטגוריה" : categories.find((category) => category.id === id)?.name ?? null;
  const update = (patch: Partial<SearchFilters>) => {
    setFilters((current) => ({ ...current, ...patch }));
  };
  const clearAll = () => {
    setFilters(EMPTY_FILTERS);
    setText("");
  };

  const typed = settled.trim();
  const filtered = typed !== "" || hasChipFilters(active);
  let body;
  if (phase.kind === "loading") {
    body = <ListSkeleton />;
  } else if (phase.kind === "error") {
    body = (
      <ErrorState
        offline={phase.offline || !onlineManager.isOnline()}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  } else if (rows.length === 0 && refreshing) {
    // The previous read found nothing and the next one is on its way: "לא מצאנו" would name
    // text the server has not answered yet.
    body = <ListSkeleton />;
  } else if (rows.length === 0 && filtered) {
    body = (
      <EmptyState
        icon={<SearchIcon />}
        title={typed !== "" ? `לא מצאנו ״${typed}״` : "אין תנועות שמתאימות לסינון"}
        body={hasChipFilters(active) ? "החיפוש הוא לפי ספק, לקוח או תיאור, בתוך הסינון שנבחר." : "החיפוש הוא לפי ספק, לקוח או תיאור."}
        action={(
          <Button variant="pill" onClick={clearAll}>
            {hasChipFilters(active) ? "ניקוי הסינון" : "ניקוי החיפוש"}
          </Button>
        )}
      />
    );
  } else if (rows.length === 0) {
    body = <EmptyState icon={<DocumentIcon />} title="עוד אין תנועות" body="תנועות מהבנק ומ־SUMIT יופיעו כאן." />;
  } else {
    body = (
      <>
        <MonthList
          rows={rows}
          keyOf={(row) => row.id}
          dateOf={(row) => row.doc_date}
          amountOf={searchRowAmount}
          complete={complete}
          cents
          net
          renderRow={(row) => (
            <ListRow
              variant="statement"
              title={searchRowTitle(row)}
              fallback="invoice"
              match={typed}
              details={searchRowDetails(row)}
              realCents
              pending={row.line_status === "pending"}
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
    <div className="ui-search-screen" ref={screenRef}>
      <ScreenHeader title="חיפוש" backTo={`/${previewSearch}`} />
      {/* FLOW-339 C6-6: the count only. The month heads carry the totals, and every row its amount. */}
      <p className="ui-search-count t-label" role="status">
        {phase.kind === "ready" && rows.length > 0 ? (
          <span>{searchCountWords(total)}</span>
        ) : null}
        {refreshing ? <span className="ui-spinner" role="img" aria-label="מחפש" /> : null}
      </p>
      <div className="ui-search-results">{body}</div>
      <div className="ui-search-dock" ref={dockRef}>
        <SearchChips
          filters={filters}
          projects={projects}
          categories={categories}
          projectLabel={projectName(filters.project)}
          categoryLabel={categoryName(filters.category)}
          onChange={update}
        />
        <div className="ui-search-dock-field">
          <SearchField
            label="חיפוש תנועות"
            value={text}
            onChange={setText}
            placeholder="חיפוש ספק, לקוח או תיאור"
            inputRef={inputRef}
            maxLength={SEARCH_MAX_LENGTH}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Line 2 of a result holds a status only (FLOW-339 option C): "מחוץ לרווח" on a kept-out line
 * (decision 0141 log), "ממתינה לאישור" on a line waiting for review. No date, project, category or
 * split: the month head dates the row, and the row's own screen shows the rest. בהמתנה is the chip.
 */
export function searchRowDetails(row: Pick<SearchRow, "kept_out" | "waiting_review">): StatementDetail[] {
  const details: StatementDetail[] = [];
  if (row.kept_out) details.push({ text: "מחוץ לרווח" });
  if (row.waiting_review) details.push({ text: "ממתינה לאישור", keep: true });
  return details;
}

function SearchChips({
  filters,
  projects,
  categories,
  projectLabel,
  categoryLabel,
  onChange,
}: {
  filters: SearchFilters;
  projects: SearchProject[];
  categories: SearchCategory[];
  projectLabel: string | null;
  categoryLabel: string | null;
  onChange: (patch: Partial<SearchFilters>) => void;
}) {
  const [projectOpen, setProjectOpen] = useState(false);
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [periodOpen, setPeriodOpen] = useState(false);
  const setProjectSheet = useSheetHistory("search-project", projectOpen, setProjectOpen);
  const setCategorySheet = useSheetHistory("search-category", categoryOpen, setCategoryOpen);
  const toggleDirection = (direction: SearchDirection) => {
    onChange({ direction: filters.direction === direction ? null : direction });
  };
  const period = filters.period;
  const active = projects.filter((project) => project.status !== "finished");
  const finished = projects.filter((project) => project.status === "finished");
  const expense = categories.filter((category) => category.kind === "expense");
  const income = categories.filter((category) => category.kind === "income");
  // A chip set on arrival (the project from "כל התנועות") is scrolled into the row's view.
  const chipsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const pressed = chipsRef.current?.querySelector('[aria-pressed="true"]');
    if (pressed instanceof HTMLElement && typeof pressed.scrollIntoView === "function") {
      pressed.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, []);
  return (
    <>
      {/* FLOW-347: תקופה first, so it is never the cut chip; the row's end fades while more wait. */}
      <ChipScroller className="ui-search-chips" label="סינון" scrollerRef={chipsRef}>
        <Chip pressed={period.kind !== "all"} onClick={() => { setPeriodOpen(true); }}>
          {period.kind === "all" ? "תקופה" : periodLabel(period)}
        </Chip>
        <Chip pressed={filters.direction === "expense"} onClick={() => { toggleDirection("expense"); }}>הוצאות</Chip>
        <Chip pressed={filters.direction === "income"} onClick={() => { toggleDirection("income"); }}>הכנסות</Chip>
        <Chip pressed={filters.project != null} onClick={() => { setProjectSheet(true); }}>
          {filters.project != null ? projectLabel ?? "פרויקט" : "פרויקט"}
        </Chip>
        <Chip pressed={filters.category != null} onClick={() => { setCategorySheet(true); }}>
          {filters.category != null ? categoryLabel ?? "קטגוריה" : "קטגוריה"}
        </Chip>
        <Chip pressed={filters.review} onClick={() => { onChange({ review: !filters.review }); }}>לאישור</Chip>
      </ChipScroller>
      <Sheet open={projectOpen} onOpenChange={setProjectSheet} title="פרויקט">
        <div role="radiogroup" aria-label="פרויקט">
          <RadioRow label="כל הפרויקטים" selected={filters.project == null} onSelect={() => { onChange({ project: null }); setProjectSheet(false); }} />
          {[...active, ...finished].map((project) => (
            <RadioRow
              key={project.id}
              label={project.name}
              hint={project.status === "finished" ? "הסתיים" : undefined}
              selected={filters.project === project.id}
              onSelect={() => { onChange({ project: project.id }); setProjectSheet(false); }}
            />
          ))}
          <RadioRow label="בלי פרויקט" selected={filters.project === "none"} onSelect={() => { onChange({ project: "none" }); setProjectSheet(false); }} />
        </div>
      </Sheet>
      <Sheet open={categoryOpen} onOpenChange={setCategorySheet} title="קטגוריה">
        <div role="radiogroup" aria-label="קטגוריה">
          <RadioRow label="כל הקטגוריות" selected={filters.category == null} onSelect={() => { onChange({ category: null }); setCategorySheet(false); }} />
          {[...expense, ...income].map((category) => (
            <RadioRow
              key={category.id}
              label={category.name}
              hint={category.kind === "income" ? "הכנסה" : undefined}
              selected={filters.category === category.id}
              onSelect={() => { onChange({ category: category.id }); setCategorySheet(false); }}
            />
          ))}
          <RadioRow label="בלי קטגוריה" selected={filters.category === "none"} onSelect={() => { onChange({ category: "none" }); setCategorySheet(false); }} />
        </div>
      </Sheet>
      <PresetPeriodSheet period={period} onChange={(next) => { onChange({ period: next }); }} open={periodOpen} onOpenChange={setPeriodOpen} />
    </>
  );
}
