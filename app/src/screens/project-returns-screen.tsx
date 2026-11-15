import "../ui/lazy.css";
import { useRef, type ReactNode } from "react";
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
import {
  RETURN_LINES,
  isAllTimeLine,
  usePropertyReturnsQuery,
  type PropertyReturns,
  type RehabRow,
  type ReturnLine,
  type ReturnLinesPage,
} from "./project-returns-data";
import { ALL_TIME, LINE_TITLES, acquisitionFormula, countHint, firstRentInPeriod, lineMinor, type FigureValue, type Formula, type FormulaRow } from "./project-returns-info";
import { PAGE_LEARN } from "./project-returns-learn";
import { LearnButton } from "./project-returns-learn-sheet";
import { CalcSection, FormulaList, ReturnLinesSection, ReturnsHero, investmentBase, pageResolver, type Resolve } from "./project-returns-parts";
import { ReturnsSkeleton } from "./project-skeletons";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451: the cash-flow statement (board ConceptAReturnMath) and one line's page (board
 * ConceptAOpex): its categories and its transactions, each opening the transaction's own page.
 * ---------------------------------------------------------------------------------------------- */

export const PERIOD_LINE = "12 חודשים אחרונים";

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
/** The statement as the board draws it: one list of + − = rows, the NOI between them. */
export function statementFormula(r: PropertyReturns): Formula {
  const st = r.statement;
  const money = (minor: bigint, income = false): FigureValue => ({ kind: "money", minor, income });
  return {
    rows: [
      { key: "income", op: "", label: LINE_TITLES.income, hint: countHint(st.counts.income), value: money(st.incomeMinor, true), target: { kind: "line", line: "income" } },
      { key: "opex", op: "−", label: LINE_TITLES.opex, hint: categoriesHint(st.counts.opex, st.byCategory.opex.length), value: money(st.opexMinor), target: { kind: "line", line: "opex" } },
      { key: "noi", op: "=", label: "רווח תפעולי (NOI)", hint: "לפני הלוואה", value: money(st.noiMinor) },
      { key: "debt", op: "−", label: LINE_TITLES.debt_service, hint: `${countHint(st.counts.debt_service)} · חלקי הלוואה`, value: money(st.debtServiceMinor), target: { kind: "line", line: "debt_service" } },
      { key: "capex", op: "−", label: LINE_TITLES.capex, hint: `${countHint(st.counts.capex)} · קטגוריות שנספרות בשיפוץ`, value: money(st.capexMinor), target: { kind: "line", line: "capex" } },
    ],
    result: { key: "cash", op: "=", label: "תזרים", value: money(st.cashFlowMinor) },
  };
}

/** What the cash flow leaves out: the holding and renovation before the first rent (when any), and the kept-out lines. */
export function outsideFormula(r: PropertyReturns): Formula {
  const st = r.statement;
  return {
    rows: [
      ...(st.beforeRentMinor === 0n ? [] : [{
        key: "before",
        op: "",
        label: "עלויות החזקה ושיפוץ לפני השכרה",
        hint: `${countHint(st.counts.before_rent)} · נכנס לכסף בעסקה`,
        value: { kind: "money", minor: st.beforeRentMinor },
        target: { kind: "line", line: "before_rent" },
      } satisfies FormulaRow]),
      { key: "not-counted", op: "", label: LINE_TITLES.not_counted, hint: `${countHint(st.counts.not_counted)} · ${NOT_COUNTED_HINT}`, value: { kind: "money", minor: st.notCountedMinor }, target: { kind: "line", line: "not_counted" } },
    ],
    result: null,
  };
}

/**
 * The cash flow (board V3-Calc): the figure and how it is made, then the calculation as + − = rows
 * (each opening its line), and what is left out.
 */
function Statement({ r, base, search }: { r: PropertyReturns; base: string; search: string }) {
  const st = r.statement;
  const cur = r.currency;
  const lines = st.counts.income + st.counts.opex + st.counts.debt_service + st.counts.capex;
  const resolve = pageResolver(base, search);
  const out = outsideFormula(r);
  return (
    <div className="ui-rep-content">
      <ReturnsHero figure={<Amount agorot={st.cashFlowMinor} currency={cur} loss={st.cashFlowMinor < 0n} />} meta={statementMeta(r, lines)} />
      <CalcSection title="החישוב" total={money(st.cashFlowMinor, cur)}>
        <FormulaList formula={statementFormula(r)} currency={cur} resolve={resolve} label="החישוב" />
      </CalcSection>
      <CalcSection title="מחוץ לחישוב" total={<span className="t-muted">{rowsCount(out.rows.length)}</span>}>
        <FormulaList formula={out} currency={cur} resolve={resolve} label="מחוץ לחישוב" />
      </CalcSection>
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
      headerClassName="ui-ret-head"
      title="תזרים"
      titleAside={<LearnButton learnKey={PAGE_LEARN.statement} title="תזרים" />}
      kicker="השקעה"
      subtitle={page.subtitle}
      backTo={`${page.base}${page.search}`}
      phase={page.phase}
      onRetry={page.retry}
      empty={RETURNS_EMPTY}
      loading={<ReturnsSkeleton />}
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

/** A line's categories as rows, largest first, each opening the line narrowed to it. */
function categoriesFormula(line: ReturnLine, categories: readonly { id: string | null; name: string | null; minor: bigint; count: number }[]): Formula {
  return {
    rows: categories.map((item): FormulaRow => ({
      key: item.id ?? "none",
      op: "",
      label: item.name ?? "בלי קטגוריה",
      hint: countHint(item.count),
      value: { kind: "money", minor: item.minor, income: line === "income" },
      target: item.id == null ? undefined : { kind: "line", line, categoryId: item.id },
    })),
    result: null,
  };
}

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
        <CalcSection title="החישוב" total={<bdi dir="ltr" className="t-muted">{String(calc.rows.length)}</bdi>}>
          <FormulaList formula={calc} currency={cur} resolve={resolve} label={LINE_TITLES[line]} />
        </CalcSection>
      )}
      {categoryId == null && categories.length > 0 ? (
        <CalcSection title="לפי קטגוריה" total={<bdi dir="ltr" className="t-muted">{String(categories.length)}</bdi>}>
          <FormulaList formula={categoriesFormula(line, categories)} currency={cur} resolve={links} label="לפי קטגוריה" />
        </CalcSection>
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
      headerClassName="ui-ret-head"
      title={title}
      titleAside={learnKey == null ? undefined : <LearnButton learnKey={learnKey} title={title} />}
      kicker={categoryId != null || line === "rehab" ? LINE_TITLES[line] : principal ? "השקעה" : "התזרים"}
      subtitle={page.subtitle}
      backTo={back}
      phase={page.phase}
      onRetry={page.retry}
      empty={RETURNS_EMPTY}
      loading={<ReturnsSkeleton />}
    >
      {page.returns == null ? null : (
        <LineBody line={line} categoryId={categoryId} category={category} r={page.returns} base={page.base} search={page.search} projectId={page.projectId} name={page.name} lines={sample?.lines} />
      )}
    </ScreenState>
  );
}
