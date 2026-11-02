import "../ui/lazy.css";
import { useEffect, useRef, useState } from "react";
import { Navigate, useParams } from "react-router-dom";
import { Amount } from "../ui/amount";
import { Button } from "../ui/button";
import { EmptyState, FailureLine } from "../ui/empty-state";
import { ChevronDownIcon } from "../ui/icons";
import { ProfitRowsSkeleton } from "../ui/screen-skeletons";
import { ScreenState } from "../ui/screen-state";
import { DelayedSkeleton } from "../ui/skeleton";
import { ReportSection } from "./reports-parts";
import { ALL_TIME, METRIC_KEYS, PART_KEYS, metricPage, partPage, type MetricKey, type PartKey } from "./project-returns-info";
import { AllCashOutMeta, FigureText, FormulaList, ReturnLinesSection, ReturnsHero, pageResolver } from "./project-returns-parts";
import { RETURNS_EMPTY, useCollapse, useReturnsPage, type RehabRead, type ReturnsSample } from "./project-returns-screen";
import type { PropertyReturns, RehabRow } from "./project-returns-data";
import { PAGE_LEARN } from "./project-returns-learn";
import { LearnButton } from "./project-returns-learn-sheet";

/* ------------------------------------------------------------------------------------------------
 * FLOW-451: a metric's page (board ConceptAMetricCoc) and a part's page (board
 * ConceptABuildingCost). Each leads with its figure, then its parts with their operators (each
 * opening where it comes from, a typed figure its edit sheet), and a part's transactions.
 * ---------------------------------------------------------------------------------------------- */

function isMetric(value: string | undefined): value is MetricKey {
  return value != null && (METRIC_KEYS as readonly string[]).includes(value);
}

function isPart(value: string | undefined): value is PartKey {
  return value != null && (PART_KEYS as readonly string[]).includes(value);
}

function MetricBody({ metric, r, base, search }: { metric: MetricKey; r: PropertyReturns; base: string; search: string }) {
  const collapse = useCollapse();
  const page = metricPage(metric, r);
  const resolve = pageResolver(base, search);
  const negative = page.value.kind === "text" && page.value.text.startsWith("−");
  return (
    <div className="ui-rep-content">
      <ReturnsHero
        figure={<span className={negative ? "ui-loss" : undefined}><FigureText value={page.value} currency={r.currency} loss /></span>}
        meta={page.cashOut == null ? page.caption : <AllCashOutMeta minor={page.cashOut} currency={r.currency} />}
      />
      {page.sections.map((section) => (
        <ReportSection
          key={section.key}
          id={section.key}
          title={section.title}
          total={section.total == null ? null : <FigureText value={section.total} currency={r.currency} />}
          collapse={collapse}
        >
          <FormulaList formula={section.formula} currency={r.currency} resolve={resolve} label={section.title} />
        </ReportSection>
      ))}
      {page.result == null ? null : (
        <ReportSection id="result" title="התוצאה" total={null} collapse={collapse}>
          {/* FLOW-462: the same row as every "=": the figure's name, the division under it, the figure. */}
          <FormulaList
            formula={{ rows: [], result: { key: "result", op: "=", label: page.title, hint: page.result.text, value: page.result.value } }}
            currency={r.currency}
            resolve={resolve}
            label="התוצאה"
          />
        </ReportSection>
      )}
    </div>
  );
}

/** A metric: cash-on-cash, cap rate, DSCR or cash flow per unit, with what it is made of. */
export function PropertyMetricScreen({ sample, base: baseProp, learnOpen = false }: { sample?: ReturnsSample; base?: string; learnOpen?: boolean } = {}) {
  const page = useReturnsPage(sample, baseProp);
  const { metric: named, key } = useParams();
  const metric = named ?? key;
  if (!isMetric(metric)) return <Navigate replace to={`${page.base}${page.search}`} />;
  const title = page.returns == null ? "מדד" : metricPage(metric, page.returns).title;
  return (
    <ScreenState
      title={title}
      titleAside={<LearnButton learnKey={PAGE_LEARN.metric[metric]} title={title} initialOpen={learnOpen} />}
      kicker="השקעה"
      subtitle={page.subtitle}
      backTo={`${page.base}${page.search}`}
      phase={page.phase}
      onRetry={page.retry}
      empty={RETURNS_EMPTY}
    >
      {page.returns == null ? null : <MetricBody metric={metric} r={page.returns} base={page.base} search={page.search} />}
    </ScreenState>
  );
}

function PartBody({ part, r, base, search, projectId, sample }: { part: PartKey; r: PropertyReturns; base: string; search: string; projectId: string; sample?: ReturnsSample }) {
  const collapse = useCollapse();
  const page = partPage(part, r);
  const figure = page.formula.result?.value;
  const moneyIn = part === "money-in";
  // All the cash out is a good state: the money in below zero is no loss.
  return (
    <div className="ui-rep-content">
      <ReturnsHero figure={figure == null ? null : <FigureText value={figure} currency={r.currency} loss={!moneyIn} />} meta={page.meta} />
      <p className="ui-ret-body">{page.body}</p>
      <ReportSection id="calc" title="החישוב" total={<bdi dir="ltr" className="t-muted">{String(page.formula.rows.length + 1)}</bdi>} collapse={collapse}>
        <FormulaList formula={page.formula} currency={r.currency} resolve={pageResolver(base, search)} label={page.title} />
      </ReportSection>
      <ReturnLinesSection projectId={projectId} line={moneyIn ? "money_in" : "rehab"} categoryId={null} currency={r.currency} search={search} collapse={collapse} sample={sample?.lines} />
    </div>
  );
}

/** How many of the renovation's categories show before "עוד N קטגוריות". */
export const REHAB_SHOWN = 5;
export const REHAB_EMPTY = "אין עדיין הוצאות שיפוץ";

function moreLabel(count: number): string {
  return count === 1 ? "עוד קטגוריה אחת" : `עוד ${String(count)} קטגוריות`;
}

/** "עוד N קטגוריות": the rest of the rows' sum, so the rows drawn still add up; a tap shows them in place. */
function MoreRow({ rows, currency, onOpen }: { rows: readonly RehabRow[]; currency: string; onOpen: () => void }) {
  const sum = rows.reduce((total, row) => total + row.minor, 0n);
  return (
    <button type="button" className="ui-ret-row ui-ret-more m-press" onClick={onOpen}>
      <span className="ui-ret-op" aria-hidden="true">+</span>
      <span className="ui-ret-text"><span className="ui-ret-label">{moreLabel(rows.length)}</span></span>
      <span className="ui-ret-value"><Amount agorot={sum} currency={currency} /></span>
      <span className="ui-ret-go" aria-hidden="true"><ChevronDownIcon size={18} /></span>
    </button>
  );
}

/** The renovation's calculation: its categories, largest first, the first five and then the rest on a tap. */
function RehabCalc({ r, rows, base, search }: { r: PropertyReturns; rows: readonly RehabRow[]; base: string; search: string }) {
  const [all, setAll] = useState(false);
  const list = useRef<HTMLUListElement>(null);
  const folded = !all && rows.length > REHAB_SHOWN;
  const shown = folded ? rows.slice(0, REHAB_SHOWN) : rows;
  const formula = partPage("rehab", r, shown).formula;
  // The row that was tapped is gone: focus moves to the first row it showed.
  useEffect(() => {
    if (!all) return;
    list.current?.children.item(REHAB_SHOWN)?.querySelector<HTMLElement>("a, button")?.focus();
  }, [all]);
  return (
    <FormulaList
      formula={formula}
      currency={r.currency}
      resolve={pageResolver(base, search)}
      label="שיפוץ עד היום"
      listRef={list}
      more={folded ? <MoreRow rows={rows.slice(REHAB_SHOWN)} currency={r.currency} onOpen={() => { setAll(true); }} /> : undefined}
    />
  );
}

/**
 * FLOW-460 (decision 0247): the renovation so far. Its figure, one line on what it counts, the
 * categories that count adding up to it (each opening its lines), its lines by month, and one quiet
 * link to the category settings for what is kept out.
 */
function RehabPartBody({ r, rehab, base, search, projectId, sample }: { r: PropertyReturns; rehab: RehabRead; base: string; search: string; projectId: string; sample?: ReturnsSample }) {
  const collapse = useCollapse();
  const page = partPage("rehab", r, rehab.rows ?? []);
  const settings = <Button variant="link" to={`/settings/categories${search}`} className="ui-ret-settings-link">מה לא נספר? לפי קטגוריה</Button>;
  if (rehab.rows != null && rehab.rows.length === 0 && (r.inputs.rehabMinor ?? 0n) === 0n) {
    return (
      <div className="ui-rep-content">
        <EmptyState title={REHAB_EMPTY} body="הוצאה בקטגוריה שנספרת בשיפוץ תופיע כאן." />
        {settings}
      </div>
    );
  }
  const figure = page.formula.result?.value;
  return (
    <div className="ui-rep-content">
      {/* The one line under the figure says what it counts; no meta repeats it. */}
      <ReturnsHero figure={figure == null ? null : <FigureText value={figure} currency={r.currency} />} meta={null} />
      <p className="ui-ret-body">{page.body}</p>
      <ReportSection id="calc" title="החישוב" total={rehab.rows == null ? null : <bdi dir="ltr" className="t-muted">{String(rehab.rows.length + 1)}</bdi>} collapse={collapse}>
        {rehab.rows != null ? (
          <RehabCalc r={r} rows={rehab.rows} base={base} search={search} />
        ) : rehab.failed ? (
          <FailureLine offline={rehab.offline} onRetry={rehab.retry} />
        ) : <DelayedSkeleton><ProfitRowsSkeleton /></DelayedSkeleton>}
      </ReportSection>
      <ReturnLinesSection projectId={projectId} line="rehab" categoryId={null} currency={r.currency} search={search} collapse={collapse} sample={sample?.lines} />
      {settings}
    </div>
  );
}

/** A part of a figure (the building cost, the money in the deal, the forced equity, the renovation) and its lines (rehab, or the money in's), all time. */
export function PropertyPartScreen({ sample, base: baseProp }: { sample?: ReturnsSample; base?: string } = {}) {
  const page = useReturnsPage(sample, baseProp);
  const { part: named, key } = useParams();
  const part = named ?? key;
  if (!isPart(part)) return <Navigate replace to={`${page.base}${page.search}`} />;
  const title = page.returns == null ? "חישוב" : partPage(part, page.returns).title;
  const back = page.returns == null ? "השקעה" : partPage(part, page.returns).back;
  // A part reads its lines since the purchase, not the last 12 months.
  const subtitle = page.name == null ? ALL_TIME : `${ALL_TIME} · ${page.name}`;
  return (
    <ScreenState
      title={title}
      titleAside={<LearnButton learnKey={PAGE_LEARN.part[part]} title={title} />}
      kicker={back}
      subtitle={subtitle}
      backTo={`${page.base}${page.search}`}
      phase={page.phase}
      onRetry={page.retry}
      empty={RETURNS_EMPTY}
    >
      {page.returns == null ? null : part === "rehab" ? (
        <RehabPartBody r={page.returns} rehab={page.rehab} base={page.base} search={page.search} projectId={page.projectId} sample={sample} />
      ) : <PartBody part={part} r={page.returns} base={page.base} search={page.search} projectId={page.projectId} sample={sample} />}
    </ScreenState>
  );
}
