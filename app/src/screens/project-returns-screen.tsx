import "../ui/lazy.css";
import { useRef, useState, type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useHomePreview, usePreviewSearch } from "../preview";
import { formatDisplay } from "../ui/date-math";
import { useProjectPeriod } from "../project-period";
import { screenPhase } from "../query-phase";
import { useProjectQuery } from "../use-books";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { currencyWord } from "../ui/investment-card";
import { ScreenState } from "../ui/screen-state";
import { ReportRow, ReportSection, ReportTotal, type Collapse } from "./reports-parts";
import {
  RETURN_LINES,
  isAllTimeLine,
  usePropertyReturnsQuery,
  type PropertyReturns,
  type RehabRow,
  type ReturnLine,
  type ReturnLinesPage,
} from "./project-returns-data";
import { ALL_TIME, LINE_TITLES, acquisitionFormula, countHint, firstRentInPeriod, lineMinor } from "./project-returns-info";
import { PAGE_LEARN } from "./project-returns-learn";
import { LearnButton } from "./project-returns-learn-sheet";
import { FormulaList, ReturnLinesSection, ReturnsHero, investmentBase, pageResolver, withParam, type Resolve } from "./project-returns-parts";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451: the cash-flow statement (board ConceptAReturnMath) and one line's page (board
 * ConceptAOpex): its categories and its transactions, each opening the transaction's own page.
 * ---------------------------------------------------------------------------------------------- */

export const PERIOD_LINE = "12 חודשים אחרונים";

/** Which sections are closed: all open on arrival. */
export function useCollapse(): Collapse {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  return {
    isOpen: (id) => !closed.has(id),
    onToggle: (id) => {
      setClosed((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    },
  };
}

/** `rehab`: the renovation's categories (FLOW-460); none when left out. */
export type ReturnsSample = { returns: PropertyReturns; projectName: string; lines?: ReturnLinesPage; rehab?: readonly RehabRow[] };

/** The renovation's categories from the project's own read: null while it loads. */
export type RehabRead = { rows: readonly RehabRow[] | null; failed: boolean; offline: boolean; retry: () => void };

/** The returns read behind every returns page, and the project's name for the period line. */
export function useReturnsPage(sample: ReturnsSample | undefined, baseProp: string | undefined, allTime = false) {
  const { projectId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const [period] = useProjectPeriod();
  const read = usePropertyReturnsQuery(sample == null ? projectId : "");
  // The investment page read the project on the same period, so its name is usually there already.
  const project = useProjectQuery(sample == null ? projectId : "", period);
  const name = sample?.projectName ?? project.data?.name ?? null;
  const phase = sample != null ? ({ kind: "ready" } as const) : screenPhase(preview, read);
  const investment = project.data?.investment;
  const rehab: RehabRead = {
    rows: sample != null
      ? (sample.rehab ?? [])
      : investment == null
        ? (project.data === undefined ? null : [])
        : (investment.rehab_by_category ?? []).map((row) => ({ id: row.category_id, name: row.name, minor: row.amount_minor })),
    failed: sample == null && project.isError,
    offline: project.isPaused,
    retry: () => { void project.refetch(); },
  };
  return {
    projectId,
    search,
    base: baseProp ?? investmentBase(projectId),
    returns: sample?.returns ?? read.data ?? null,
    phase,
    retry: () => { void read.refetch(); },
    subtitle: name == null ? (allTime ? ALL_TIME : PERIOD_LINE) : `${allTime ? ALL_TIME : PERIOD_LINE} · ${name}`,
    name,
    rehab,
  };
}

export const RETURNS_EMPTY = <EmptyState title="אין עדיין נתונים" body="התשואה תופיע כאן כשיהיו תנועות בנכס." />;

function income(minor: bigint, currency: string): ReactNode {
  return <Amount agorot={minor} currency={currency} income />;
}

function money(minor: bigint, currency: string): ReactNode {
  return <Amount agorot={minor} currency={currency} />;
}

function categoriesHint(count: number, categories: number): string {
  if (categories <= 1) return countHint(count);
  return `${countHint(count)} · ${String(categories)} קטגוריות`;
}

/** "6 שורות", "שורה אחת": a section's count, with its unit. */
export function rowsCount(count: number): string {
  return count === 1 ? "שורה אחת" : `${String(count)} שורות`;
}

export const NOT_COUNTED_HINT ="רכישה, סגירה ותקבולי הלוואות";

/** "תזרים · מהשכירות הראשונה ב־01/04/2026 · 59 תנועות": the statement starts at the first rent when it falls in the period. */
function statementMeta(r: PropertyReturns, lines: number): string {
  const first = firstRentInPeriod(r);
  return `תזרים · ${first == null ? "12 חודשים" : `מהשכירות הראשונה ב־${formatDisplay(first)}`} · ${countHint(lines)}`;
}

/**
 * "איך מחושב התזרים": income, opex, NOI, debt service, CapEx, cash flow, and what is left out: the
 * holding and renovation before the first rent (only when there are any), and the kept-out lines.
 */
function Statement({ r, base, search }: { r: PropertyReturns; base: string; search: string }) {
  const collapse = useCollapse();
  const st = r.statement;
  const cur = r.currency;
  const href = (line: ReturnLine) => `${base}/returns/${line}${search}`;
  const lines = st.counts.income + st.counts.opex + st.counts.debt_service + st.counts.capex;
  const beforeRent = st.beforeRentMinor !== 0n;
  // Each block of the calculation: its rows, then its total line. The count is of what is drawn (FLOW-457).
  const operating = [
    <ReportRow key="income" name={LINE_TITLES.income} meta={countHint(st.counts.income)} amount={income(st.incomeMinor, cur)} href={href("income")} />,
    <ReportRow key="opex" name={LINE_TITLES.opex} meta={categoriesHint(st.counts.opex, st.byCategory.opex.length)} amount={money(st.opexMinor, cur)} href={href("opex")} />,
  ];
  const below = [
    <ReportRow key="debt" name={LINE_TITLES.debt_service} meta={`${countHint(st.counts.debt_service)} · חלקי הלוואה`} amount={money(st.debtServiceMinor, cur)} href={href("debt_service")} />,
    <ReportRow key="capex" name={LINE_TITLES.capex} meta={`${countHint(st.counts.capex)} · קטגוריות שנספרות בשיפוץ`} amount={money(st.capexMinor, cur)} href={href("capex")} />,
  ];
  const out = [
    beforeRent ? (
      <ReportRow key="before" name="עלויות החזקה ושיפוץ לפני השכרה" meta={`${countHint(st.counts.before_rent)} · נכנס לכסף בעסקה`} amount={money(st.beforeRentMinor, cur)} href={href("before_rent")} />
    ) : null,
    <ReportRow key="not-counted" name={LINE_TITLES.not_counted} meta={`${countHint(st.counts.not_counted)} · ${NOT_COUNTED_HINT}`} amount={money(st.notCountedMinor, cur)} href={href("not_counted")} />,
  ].filter((row) => row != null);
  return (
    <div className="ui-rep-content">
      <ReturnsHero figure={<Amount agorot={st.cashFlowMinor} currency={cur} loss={st.cashFlowMinor < 0n} />} meta={statementMeta(r, lines)} />
      <ReportSection id="calc" title="החישוב" total={<span className="t-muted">{rowsCount(operating.length + 1 + below.length + 1)}</span>} collapse={collapse}>
        <ul className="ui-rep-rows">{operating}</ul>
        <ReportTotal label="רווח תפעולי (NOI)" amount={money(st.noiMinor, cur)} />
        <ul className="ui-rep-rows">{below}</ul>
        <ReportTotal label="תזרים" amount={money(st.cashFlowMinor, cur)} strong />
      </ReportSection>
      <ReportSection id="out" title="מחוץ לחישוב" total={<span className="t-muted">{rowsCount(out.length)}</span>} collapse={collapse} fixed={out.length === 1}>
        <ul className="ui-rep-rows">{out}</ul>
      </ReportSection>
      {r.otherCurrencies.length > 0 ? (
        <p className="ui-ret-caption">{`תנועות ${r.otherCurrencies.map(currencyWord).join(", ")} לא נספרות כאן.`}</p>
      ) : null}
      <Button variant="link" to={`/settings/categories${search}`} className="ui-ret-settings-link">מה נספר איפה · לפי קטגוריה</Button>
    </div>
  );
}

export function PropertyStatementScreen({ sample, base: baseProp }: { sample?: ReturnsSample; base?: string } = {}) {
  const page = useReturnsPage(sample, baseProp);
  return (
    <ScreenState
      title="איך מחושב התזרים"
      titleAside={<LearnButton learnKey={PAGE_LEARN.statement} title="תזרים" />}
      kicker="השקעה"
      subtitle={page.subtitle}
      backTo={`${page.base}${page.search}`}
      phase={page.phase}
      onRetry={page.retry}
      empty={RETURNS_EMPTY}
    >
      {page.returns == null ? null : <Statement r={page.returns} base={page.base} search={page.search} />}
    </ScreenState>
  );
}

function isReturnLine(value: string | undefined): value is ReturnLine {
  return value != null && (RETURN_LINES as readonly string[]).includes(value);
}

/** A line's meta: its count, and opex's share of the rent; a line of the money in reads since the purchase. */
function lineMeta(line: ReturnLine, r: PropertyReturns, minor: bigint, count: number | null, name: string | null): string {
  const parts: string[] = isAllTimeLine(line) ? [ALL_TIME] : [];
  if (line === "opex" && r.statement.incomeMinor > 0n && minor < 0n) {
    parts.push(`${String(Math.round((Number(-minor) / Number(r.statement.incomeMinor)) * 100))}% מהשכירות`);
  }
  if (count != null) parts.push(countHint(count));
  if (name != null) parts.push(name);
  return parts.join(" · ");
}

function periodCategories(line: ReturnLine, r: PropertyReturns) {
  return line === "principal" || isAllTimeLine(line) ? [] : r.statement.byCategory[line];
}

type LineCategory = { name: string | null; minor: bigint; count: number | null };

/** The category a line page narrows to: the period's, or the renovation's since the purchase (FLOW-460). */
function lineCategory(line: ReturnLine, r: PropertyReturns, rehab: readonly RehabRow[] | null, categoryId: string | null): LineCategory | null {
  if (categoryId == null) return null;
  if (line === "rehab") {
    const row = rehab?.find((item) => item.id === categoryId);
    // A cost, as the line's own figure and its transactions read.
    return row == null ? null : { name: row.name, minor: -row.minor, count: null };
  }
  return periodCategories(line, r).find((item) => item.id === categoryId) ?? null;
}

function LineBody({ line, categoryId, category, r, base, search, projectId, name, lines }: {
  line: ReturnLine;
  categoryId: string | null;
  category: LineCategory | null;
  r: PropertyReturns;
  base: string;
  search: string;
  projectId: string;
  name: string | null;
  lines?: ReturnLinesPage;
}) {
  const collapse = useCollapse();
  const cur = r.currency;
  // The returns read has the period's categories only: a line since the purchase lists its transactions.
  const categories = periodCategories(line, r);
  const minor = category?.minor ?? lineMinor(line, r);
  const count = category?.count ?? (line === "principal" || isAllTimeLine(line) ? null : r.statement.counts[line]);
  const own = (value: bigint) => (line === "income" ? income(value, cur) : money(value, cur));
  const linesRef = useRef<HTMLElement>(null);
  // FLOW-466: a loan paid out at closing is in the price, so the page adds it up to the purchase row's figure.
  const calc = line === "acquisition" && categoryId == null ? acquisitionFormula(r) : null;
  const links = pageResolver(base, search);
  // The bank lines are the transactions below: their row opens that section and moves focus to it.
  const resolve: Resolve = (target) => (target.kind === "line" && target.line === line ? { onClick: () => {
    // Focus scrolls the months into view.
    linesRef.current?.focus();
  } } : links(target));
  const heroMinor = calc?.result?.value.kind === "money" ? calc.result.value.minor : minor;
  return (
    <div className="ui-rep-content">
      <ReturnsHero figure={heroMinor == null ? <span className="ui-ret-missing">חסר</span> : own(heroMinor)} meta={lineMeta(line, r, minor ?? 0n, count, name)} />
      {calc == null ? null : (
        <ReportSection id="calc" title="החישוב" total={<bdi dir="ltr" className="t-muted">{String(calc.rows.length)}</bdi>} collapse={collapse}>
          <FormulaList formula={calc} currency={cur} resolve={resolve} label={LINE_TITLES[line]} />
        </ReportSection>
      )}
      {categoryId == null && categories.length > 0 ? (
        <ReportSection id="cats" title="לפי קטגוריה" total={<bdi dir="ltr" className="t-muted">{String(categories.length)}</bdi>} collapse={collapse}>
          <ul className="ui-rep-rows">
            {categories.map((item) => (
              <ReportRow
                key={item.id ?? "none"}
                name={item.name ?? "בלי קטגוריה"}
                meta={countHint(item.count)}
                amount={own(item.minor)}
                href={item.id == null ? undefined : `${base}/returns/${line}${withParam(search, "category", item.id)}`}
              />
            ))}
          </ul>
        </ReportSection>
      ) : null}
      <ReturnLinesSection projectId={projectId} line={line} categoryId={categoryId} currency={cur} search={search} sample={lines} sectionRef={linesRef} />
    </div>
  );
}

/** One line of the statement (or the principal parts): its categories, then its transactions by month. */
export function PropertyReturnLineScreen({ sample, base: baseProp }: { sample?: ReturnsSample; base?: string } = {}) {
  const { line: named, key } = useParams();
  const line = named ?? key;
  const page = useReturnsPage(sample, baseProp, line != null && isAllTimeLine(line));
  const location = useLocation();
  const categoryId = new URLSearchParams(location.search).get("category");
  if (!isReturnLine(line)) return <Navigate replace to={`${page.base}/returns${page.search}`} />;
  const category = page.returns == null ? null : lineCategory(line, page.returns, page.rehab.rows, categoryId);
  const title = category?.name ?? LINE_TITLES[line];
  // The principal and the money in's lines open from the investment page; the rest from the statement.
  const principal = line === "principal" || isAllTimeLine(line);
  // FLOW-462: a line with its own reading guide (the principal), not narrowed to a category.
  const learnKey = categoryId == null && line in PAGE_LEARN.line ? PAGE_LEARN.line[line as keyof typeof PAGE_LEARN.line] : null;
  // The renovation's lines open from its own page (FLOW-460).
  const back = line === "rehab"
    ? `${page.base}/part/rehab${page.search}`
    : categoryId != null ? `${page.base}/returns/${line}${page.search}` : principal ? `${page.base}${page.search}` : `${page.base}/returns${page.search}`;
  return (
    <ScreenState
      title={title}
      titleAside={learnKey == null ? undefined : <LearnButton learnKey={learnKey} title={title} />}
      kicker={categoryId != null || line === "rehab" ? LINE_TITLES[line] : principal ? "השקעה" : "התזרים"}
      subtitle={page.subtitle}
      backTo={back}
      phase={page.phase}
      onRetry={page.retry}
      empty={RETURNS_EMPTY}
    >
      {page.returns == null ? null : (
        <LineBody line={line} categoryId={categoryId} category={category} r={page.returns} base={page.base} search={page.search} projectId={page.projectId} name={page.name} lines={sample?.lines} />
      )}
    </ScreenState>
  );
}
