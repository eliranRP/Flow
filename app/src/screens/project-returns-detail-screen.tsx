import "../ui/lazy.css";
import { Navigate, useParams } from "react-router-dom";
import { ScreenState } from "../ui/screen-state";
import { ReportSection } from "./reports-parts";
import { METRIC_KEYS, PART_KEYS, metricPage, partPage, type MetricKey, type PartKey } from "./project-returns-info";
import { FigureText, FormulaList, ReturnLinesSection, ReturnsHero, pageResolver } from "./project-returns-parts";
import { RETURNS_EMPTY, useCollapse, useReturnsPage, type ReturnsSample } from "./project-returns-screen";
import type { PropertyReturns } from "./project-returns-data";

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
      <ReturnsHero figure={<span className={negative ? "ui-loss" : undefined}><FigureText value={page.value} currency={r.currency} loss /></span>} meta={page.caption} />
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
          <div className="ui-ret-row ui-ret-result">
            <span className="ui-ret-op" aria-hidden="true">=</span>
            <span className="ui-ret-text"><bdi dir="ltr" className="ui-ret-label ui-num">{page.result.text}</bdi></span>
            <span className="ui-ret-value"><FigureText value={page.result.value} currency={r.currency} /></span>
          </div>
        </ReportSection>
      )}
    </div>
  );
}

/** A metric: cash-on-cash, cap rate, DSCR or cash flow per unit, with what it is made of. */
export function PropertyMetricScreen({ sample, base: baseProp }: { sample?: ReturnsSample; base?: string } = {}) {
  const page = useReturnsPage(sample, baseProp);
  const { metric } = useParams();
  if (!isMetric(metric)) return <Navigate replace to={`${page.base}${page.search}`} />;
  const title = page.returns == null ? "מדד" : metricPage(metric, page.returns).title;
  return (
    <ScreenState title={title} kicker="השקעה" subtitle={page.subtitle} backTo={`${page.base}${page.search}`} phase={page.phase} onRetry={page.retry} empty={RETURNS_EMPTY}>
      {page.returns == null ? null : <MetricBody metric={metric} r={page.returns} base={page.base} search={page.search} />}
    </ScreenState>
  );
}

function PartBody({ part, r, base, search, projectId, sample }: { part: PartKey; r: PropertyReturns; base: string; search: string; projectId: string; sample?: ReturnsSample }) {
  const collapse = useCollapse();
  const page = partPage(part, r);
  const figure = page.formula.result?.value;
  return (
    <div className="ui-rep-content">
      <ReturnsHero figure={figure == null ? null : <FigureText value={figure} currency={r.currency} loss />} meta={page.meta} />
      <p className="ui-ret-body">{page.body}</p>
      <ReportSection id="calc" title="החישוב" total={<bdi dir="ltr" className="t-muted">{String(page.formula.rows.length + 1)}</bdi>} collapse={collapse}>
        <FormulaList formula={page.formula} currency={r.currency} resolve={pageResolver(base, search)} label={page.title} />
      </ReportSection>
      <ReturnLinesSection projectId={projectId} line="rehab" categoryId={null} currency={r.currency} search={search} collapse={collapse} sample={sample?.lines} />
    </div>
  );
}

/** A part of a figure (the building cost, the money in the deal, the forced equity) and its rehab lines, all time. */
export function PropertyPartScreen({ sample, base: baseProp }: { sample?: ReturnsSample; base?: string } = {}) {
  const page = useReturnsPage(sample, baseProp);
  const { part } = useParams();
  if (!isPart(part)) return <Navigate replace to={`${page.base}${page.search}`} />;
  const title = page.returns == null ? "חישוב" : partPage(part, page.returns).title;
  const back = page.returns == null ? "השקעה" : partPage(part, page.returns).back;
  // A part reads the rehab lines since the purchase, not the last 12 months.
  const subtitle = page.name == null ? "מאז הקנייה" : `מאז הקנייה · ${page.name}`;
  return (
    <ScreenState title={title} kicker={back} subtitle={subtitle} backTo={`${page.base}${page.search}`} phase={page.phase} onRetry={page.retry} empty={RETURNS_EMPTY}>
      {page.returns == null ? null : <PartBody part={part} r={page.returns} base={page.base} search={page.search} projectId={page.projectId} sample={sample} />}
    </ScreenState>
  );
}
