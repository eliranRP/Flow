import { formatAmountText } from "@flow/shared";
import { useState } from "react";
import { useLocation, useParams, useSearchParams } from "react-router-dom";
import { loanRowProps, useLoanMarks, type LoanMark } from "./loan-marks";
import { lineCountHint } from "../breakdown";
import { periodFromSearch, periodLabel } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { usualFor, useProjectCategoryMonthsQuery, type UpKind } from "../project-category-months";
import { useProjectCategoryQuery } from "../use-books";
import { useHeldOrder } from "../list-hold";
import { txnListState } from "../txn-nav";
import { Button } from "../ui/button";
import { formatDayMonth } from "../ui/date-math";
import { UpMark } from "../ui/category-group-row";
import { EmptyState } from "../ui/empty-state";
import { DocumentIcon } from "../ui/icons";
import { KeptOutTag, rowSource } from "../ui/line-marks";
import { KEPT_OUT } from "./screen-shared";
import { ListRow } from "../ui/list-row";
import { MonthList } from "../ui/month-list";
import { ScreenHeader } from "../ui/screen-header";
import { ScreenState } from "../ui/screen-state";

type CategorySample = {
  categoryName: string;
  projectName: string;
  /** The rows' currency. Default ILS. */
  currency?: string;
  rows: Array<{ id: string; description: string; doc_date: string; amount_net: bigint; source?: string; kept_out?: boolean }>;
  /** Shows עוד תנועות until the rest of the sample rows are revealed. */
  pageSize?: number;
  /** FLOW-107. Loan split marks by row id, for stories. */
  loanMarks?: Record<string, LoanMark>;
  /** FLOW-401. The usual month of the category, for stories. */
  usual?: { expected: bigint; up: UpKind };
};

/** The drill-down for one category row; a row in another currency names it (`?currency=`). */
export function categoryHref(projectId: string, categoryId: string, currency: string, search: string): string {
  const path = `/projects/${projectId}/categories/${categoryId}`;
  if (currency === "ILS") return `${path}${search}`;
  return `${path}${search}${search === "" ? "?" : "&"}currency=${encodeURIComponent(currency)}`;
}

export function ProjectCategoryScreen({
  sample,
  backTo: backOverride,
  rowHref,
}: {
  sample?: CategorySample;
  backTo?: string;
  rowHref?: (row: { id: string }) => string;
} = {}) {
  const { projectId = "", categoryId = "" } = useParams();
  const [params] = useSearchParams();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const location = useLocation();
  // The project's period travels in the URL, so the lines match the category row that opened them.
  const period = periodFromSearch(new URLSearchParams(location.search));
  const category = useProjectCategoryQuery(sample ? "" : projectId, sample ? "" : categoryId, params.get("currency") ?? "", period);
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, category);
  const months = useProjectCategoryMonthsQuery(sample ? "" : projectId, period);
  const [sampleOpen, setSampleOpen] = useState(false);
  const loadedRows = sample?.rows ?? (category.data?.pages.flatMap((page) => page?.rows ?? []) ?? []);
  const heldRows = useHeldOrder(loadedRows, (row) => row.id);
  const liveMarks = useLoanMarks(heldRows.map((row) => row.id), sample == null);
  const back = `/projects/${projectId}${search}`;
  if (phase.kind === "loading" || phase.kind === "error") {
    return <ScreenState title="קטגוריה" backTo={back} phase={phase} onRetry={() => { void category.refetch(); }} />;
  }
  const first = category.data?.pages[0];
  if (!sample && (first == null)) {
    return <ScreenHeader title="קטגוריה" subtitle="הפרויקט לא נמצא." backTo={`/projects${search}`} />;
  }
  const name = sample?.categoryName ?? first?.category_name ?? "קטגוריה";
  const rowCurrency = sample?.currency ?? first?.currency ?? "ILS";
  const allRows = heldRows;
  const rows = sample?.pageSize != null && !sampleOpen ? allRows.slice(0, sample.pageSize) : allRows;
  const rowIds = rows.map((row) => row.id);
  const more = sample?.pageSize != null ? !sampleOpen && allRows.length > sample.pageSize : !sample && category.hasNextPage;
  // FLOW-334: the total and count of the lines listed, "אוקטובר · ₪4 · תנועה אחת". The count
  // waits for the last page; no lines, no figures (the header figure rule, #259).
  const total = sample ? allRows.reduce((sum, row) => sum + row.amount_net, 0n) : first?.total_agorot ?? 0n;
  const projectName = sample?.projectName ?? first?.project_name ?? "";
  const subtitle = [
    period ? periodLabel(period, undefined, "project") : "",
    // A cost list carries no minus; only refunds that beat the costs read with one (DESIGN-RULES §3.7).
    allRows.length > 0 ? formatAmountText(-total, rowCurrency) : "",
    allRows.length > 0 && !more ? lineCountHint(allRows.length, false) : "",
  ]
    .filter((part) => part !== "")
    .join(" · ");
  return (
    <div>
      {/* FLOW-339: the project names Back ("‹ שיפוץ הרצל 12"), so the subtitle leaves it out. */}
      <ScreenHeader title={name} kicker={projectName} subtitle={subtitle} backTo={backOverride ?? back} />
      <UsualLine usual={sample ? sample.usual ?? null : usualFor(months.data, categoryId, rowCurrency)} currency={rowCurrency} />
      {rows.length === 0 ? (
        <EmptyState icon={<DocumentIcon />} title="אין תנועות בקטגוריה הזו" body="הוצאות משויכות של הפרויקט יופיעו כאן." />
      ) : (
        <MonthList
          rows={rows}
          keyOf={(txn) => txn.id}
          dateOf={(txn) => txn.doc_date}
          amountOf={(txn) => ({ minor: txn.amount_net, currency: rowCurrency, direction: "expense" })}
          complete={!more}
          cost
          renderRow={(txn) => (
            <ListRow
              variant="transaction"
              title={txn.description}
              {...loanRowProps(sample ? sample.loanMarks?.[txn.id] : liveMarks.get(txn.id), formatDayMonth(txn.doc_date))}
              agorot={txn.amount_net}
              currency={rowCurrency}
              sign={txn.amount_net > 0n ? "in" : "cost"}
              inWord="זיכוי"
              source={rowSource(txn.source)}
              tag={txn.kept_out === true ? <KeptOutTag label={KEPT_OUT} /> : undefined}
              href={rowHref ? rowHref(txn) : `/transactions/${txn.id}${search}`}
              state={rowHref ? undefined : txnListState(rowIds, txn.id, `${location.pathname}${location.search}`)}
            />
          )}
        />
      )}
      {more ? (
        <div className="ui-page-pad">
          <Button
            variant="pill"
            busy={!sample && category.isFetchingNextPage}
            onClick={() => {
              if (sample) {
                setSampleOpen(true);
                return;
              }
              void category.fetchNextPage();
            }}
          >
            עוד תנועות
          </Button>
        </div>
      ) : null}
    </div>
  );
}

/** FLOW-401 v5: one quiet line under the title in the month view, "בד״כ ₪4,100 בחודש", with the up mark when above it. */
function UsualLine({ usual, currency }: { usual: { expected: bigint; up: UpKind } | null; currency: string }) {
  if (usual == null) return null;
  return (
    <p className="ui-page-pad ui-usual-line t-meta">
      {usual.up != null ? <UpMark kind={usual.up} /> : null}
      <span>
        {"בד״כ "}
        <bdi dir="ltr" className="ui-num">{formatAmountText(usual.expected, currency)}</bdi>
        {" בחודש"}
      </span>
    </p>
  );
}
