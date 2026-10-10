import type { CashMonths, CashYears } from "@flow/shared";
import { Navigate, useParams } from "react-router-dom";
import { cashHistoryLabel, cashYearMonths, cashYearSummaryRows, cashYearTitle, cashYearTotals, isCashYear, shownTotalRows } from "../cash";
import { useHomePreview, usePreviewSearch } from "../preview";
import {
  projectCashHistoryPath,
  projectCashYearMonthRows,
  projectCashYearRows,
  useProjectCashYearMonthsQuery,
  useProjectCashYearsQuery,
} from "../project-cash";
import { screenPhase } from "../query-phase";
import { CashRows } from "../ui/cash-rows";
import { israelToday } from "../ui/date-math";
import { SectionHead } from "../ui/layout";
import { CashHistoryBand, CashHistoryNotReady } from "./cash-history";

/**
 * The project page's "לכל החודשים" (owner, 2026-10-10: the project page like Home). Home's history
 * pages (FLOW-417) for one project: the net since its first cash month, then a row per year; a
 * year opens its months, and a month opens the project's month page.
 */

/** /projects/:projectId/cash/history: the project's net since its first cash month, then each year. */
export function ProjectCashHistoryScreen({ sample, projectId: sampleProjectId }: { sample?: NonNullable<CashYears>; projectId?: string } = {}) {
  const params = useParams();
  const projectId = sampleProjectId ?? params.projectId ?? "";
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const query = useProjectCashYearsQuery(projectId, sample == null);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, query);
  const back = `/projects/${projectId}${search}`;
  const data = sample ?? query.data ?? null;
  if (phase.kind !== "ready" || data == null) {
    return (
      <CashHistoryNotReady
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        back={back}
        title="תזרים"
        section="שנים"
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }
  const totals = shownTotalRows(data.by_currency, data.base_currency);
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <CashHistoryBand
        back={back}
        label={cashHistoryLabel(data.first_month)}
        figures={totals.map((row) => ({ agorot: row.net_minor, currency: row.currency, loss: row.net_minor < 0n }))}
      />
      <SectionHead title="שנים" />
      <CashRows rows={projectCashYearRows(projectId, data, search)} months />
    </div>
  );
}

type YearSample = { years: NonNullable<CashYears>; months: NonNullable<CashMonths> };

/** /projects/:projectId/cash/year/2025: the project's year, its net, נכנס and יצא, then its months. */
export function ProjectCashYearScreen({
  sample,
  year: fixedYear,
  projectId: sampleProjectId,
}: { sample?: YearSample; year?: number; projectId?: string } = {}) {
  const params = useParams();
  const search = usePreviewSearch();
  const projectId = sampleProjectId ?? params.projectId ?? "";
  const raw = fixedYear != null ? String(fixedYear) : params.year;
  if (!isCashYear(raw)) return <Navigate to={`/projects/${projectId}${search}`} replace />;
  // A year after this one has no page.
  if (Number(raw) > Number(israelToday().slice(0, 4))) return <Navigate to={projectCashHistoryPath(projectId, search)} replace />;
  return <ProjectCashYearBody projectId={projectId} year={Number(raw)} search={search} sample={sample} />;
}

function ProjectCashYearBody({ projectId, year, search, sample }: { projectId: string; year: number; search: string; sample?: YearSample }) {
  const preview = useHomePreview();
  const months = useProjectCashYearMonthsQuery(projectId, year, sample == null);
  // The history is usually cached (the page opened from it); it trims months before the first one.
  const years = useProjectCashYearsQuery(projectId, sample == null);
  const monthsPhase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, months);
  const yearsPhase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, years);
  const phase = monthsPhase.kind !== "ready" ? monthsPhase : yearsPhase;
  const back = projectCashHistoryPath(projectId, search);
  const data = sample?.months ?? months.data ?? null;
  const history = sample?.years ?? years.data ?? null;
  if (phase.kind !== "ready" || data == null || history == null) {
    return (
      <CashHistoryNotReady
        phase={phase.kind === "ready" ? { kind: "empty" } : phase}
        back={back}
        title={cashYearTitle(year)}
        section="חודשים"
        onRetry={() => {
          void months.refetch();
          void years.refetch();
        }}
      />
    );
  }
  // A year before the project's first cash month has no page.
  if (!history.years.some((entry) => entry.year === year)) return <Navigate to={back} replace />;
  const shown = cashYearMonths(data, history.first_month);
  const totals = cashYearTotals(shown, data.base_currency);
  return (
    <div className="flex min-h-full min-w-0 flex-1 flex-col">
      <CashHistoryBand
        back={back}
        label={cashYearTitle(year)}
        figures={totals.map((row) => ({ agorot: row.net_minor, currency: row.currency, loss: row.net_minor < 0n }))}
      />
      <CashRows rows={cashYearSummaryRows(year, totals)} />
      <SectionHead title="חודשים" />
      <CashRows rows={projectCashYearMonthRows(projectId, shown, data.base_currency, search)} months />
    </div>
  );
}
