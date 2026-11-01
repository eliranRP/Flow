import "../ui/lazy.css";
import { useState, type ReactNode } from "react";
import { Navigate, useLocation, useParams } from "react-router-dom";
import { useHomePreview, usePreviewSearch } from "../preview";
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
  usePropertyReturnsQuery,
  type PropertyReturns,
  type ReturnLine,
  type ReturnLinesPage,
} from "./project-returns-data";
import { LINE_TITLES, countHint, lineMinor } from "./project-returns-info";
import { ReturnLinesSection, ReturnsHero, investmentBase, withParam } from "./project-returns-parts";

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

export type ReturnsSample = { returns: PropertyReturns; projectName: string; lines?: ReturnLinesPage };

/** The returns read behind every returns page, and the project's name for the period line. */
export function useReturnsPage(sample: ReturnsSample | undefined, baseProp: string | undefined) {
  const { projectId = "" } = useParams();
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const [period] = useProjectPeriod();
  const read = usePropertyReturnsQuery(sample == null ? projectId : "");
  // The investment page read the project on the same period, so its name is usually there already.
  const project = useProjectQuery(sample == null ? projectId : "", period);
  const name = sample?.projectName ?? project.data?.name ?? null;
  const phase = sample != null ? ({ kind: "ready" } as const) : screenPhase(preview, read);
  return {
    projectId,
    search,
    base: baseProp ?? investmentBase(projectId),
    returns: sample?.returns ?? read.data ?? null,
    phase,
    retry: () => { void read.refetch(); },
    subtitle: name == null ? PERIOD_LINE : `${PERIOD_LINE} · ${name}`,
    name,
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

/** "איך מחושב התזרים": income, opex, NOI, debt service, CapEx, cash flow, and what is left out. */
function Statement({ r, base, search }: { r: PropertyReturns; base: string; search: string }) {
  const collapse = useCollapse();
  const st = r.statement;
  const cur = r.currency;
  const href = (line: ReturnLine) => `${base}/returns/${line}${search}`;
  const lines = st.counts.income + st.counts.opex + st.counts.debt_service + st.counts.capex;
  return (
    <div className="ui-rep-content">
      <ReturnsHero figure={<Amount agorot={st.cashFlowMinor} currency={cur} loss={st.cashFlowMinor < 0n} />} meta={`תזרים · 12 חודשים · ${countHint(lines)}`} />
      <ReportSection id="calc" title="החישוב" total={<span className="t-muted">5 שורות</span>} collapse={collapse}>
        <ul className="ui-rep-rows">
          <ReportRow name={LINE_TITLES.income} meta={countHint(st.counts.income)} amount={income(st.incomeMinor, cur)} href={href("income")} />
          <ReportRow name={LINE_TITLES.opex} meta={categoriesHint(st.counts.opex, st.byCategory.opex.length)} amount={money(st.opexMinor, cur)} href={href("opex")} />
        </ul>
        <ReportTotal label="רווח תפעולי (NOI)" amount={money(st.noiMinor, cur)} />
        <ul className="ui-rep-rows">
          <ReportRow name={LINE_TITLES.debt_service} meta={`${countHint(st.counts.debt_service)} · חלקי הלוואה`} amount={money(st.debtServiceMinor, cur)} href={href("debt_service")} />
          <ReportRow name={LINE_TITLES.capex} meta={`${countHint(st.counts.capex)} · קטגוריות שנספרות בשיפוץ`} amount={money(st.capexMinor, cur)} href={href("capex")} />
        </ul>
        <ReportTotal label="תזרים" amount={money(st.cashFlowMinor, cur)} strong />
      </ReportSection>
      <ReportSection id="out" title="מחוץ לחישוב" total={<span className="t-muted">1</span>} collapse={collapse}>
        <ul className="ui-rep-rows">
          <ReportRow name={LINE_TITLES.not_counted} meta={`${countHint(st.counts.not_counted)} · רכישה והעברות`} amount={money(st.notCountedMinor, cur)} href={href("not_counted")} />
        </ul>
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

/** A line's meta: its count, and opex's share of the rent. */
function lineMeta(line: ReturnLine, r: PropertyReturns, minor: bigint, count: number | null, name: string | null): string {
  const parts: string[] = [];
  if (line === "opex" && r.statement.incomeMinor > 0n && minor < 0n) {
    parts.push(`${String(Math.round((Number(-minor) / Number(r.statement.incomeMinor)) * 100))}% מהשכירות`);
  }
  if (count != null) parts.push(countHint(count));
  if (name != null) parts.push(name);
  return parts.join(" · ");
}

function LineBody({ line, categoryId, r, base, search, projectId, name, lines }: {
  line: ReturnLine;
  categoryId: string | null;
  r: PropertyReturns;
  base: string;
  search: string;
  projectId: string;
  name: string | null;
  lines?: ReturnLinesPage;
}) {
  const collapse = useCollapse();
  const cur = r.currency;
  const categories = line === "principal" ? [] : r.statement.byCategory[line];
  const category = categoryId == null ? null : categories.find((item) => item.id === categoryId) ?? null;
  const minor = category?.minor ?? lineMinor(line, r);
  const count = category?.count ?? (line === "principal" ? null : r.statement.counts[line]);
  const own = (value: bigint) => (line === "income" ? income(value, cur) : money(value, cur));
  return (
    <div className="ui-rep-content">
      <ReturnsHero figure={own(minor)} meta={lineMeta(line, r, minor, count, name)} />
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
      <ReturnLinesSection projectId={projectId} line={line} categoryId={categoryId} currency={cur} search={search} collapse={collapse} sample={lines} />
    </div>
  );
}

/** One line of the statement (or the principal parts): its categories, then its transactions by month. */
export function PropertyReturnLineScreen({ sample, base: baseProp }: { sample?: ReturnsSample; base?: string } = {}) {
  const page = useReturnsPage(sample, baseProp);
  const { line } = useParams();
  const location = useLocation();
  const categoryId = new URLSearchParams(location.search).get("category");
  if (!isReturnLine(line)) return <Navigate replace to={`${page.base}/returns${page.search}`} />;
  const category = categoryId == null || line === "principal" ? null : page.returns?.statement.byCategory[line].find((item) => item.id === categoryId) ?? null;
  const title = category?.name ?? LINE_TITLES[line];
  const principal = line === "principal";
  return (
    <ScreenState
      title={title}
      kicker={categoryId != null ? LINE_TITLES[line] : principal ? "השקעה" : "התזרים"}
      subtitle={page.subtitle}
      backTo={categoryId != null ? `${page.base}/returns/${line}${page.search}` : principal ? `${page.base}${page.search}` : `${page.base}/returns${page.search}`}
      phase={page.phase}
      onRetry={page.retry}
      empty={RETURNS_EMPTY}
    >
      {page.returns == null ? null : (
        <LineBody line={line} categoryId={categoryId} r={page.returns} base={page.base} search={page.search} projectId={page.projectId} name={page.name} lines={sample?.lines} />
      )}
    </ScreenState>
  );
}
