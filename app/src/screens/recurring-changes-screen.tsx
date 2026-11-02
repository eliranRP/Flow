import "../ui/lazy.css";
import type { RecurringChange } from "@flow/shared";
import { useSearchParams } from "react-router-dom";
import { chargeChangeViews, useProjectRecurringChangesQuery, useRecurringChangesQuery } from "../forecast";
import { useHomePreview, usePreviewSearch } from "../preview";
import { PageLoadFailed, useOnline } from "../ui/band-states";
import { BannerRows } from "../ui/banner";
import { EmptyState } from "../ui/empty-state";
import { RepeatIcon } from "../ui/icons";
import { RecurringBack } from "../ui/recurring-list";
import { RecurringSkeleton } from "../ui/screen-skeletons";
import { changeRow } from "./attention-rows";

const NO_CHANGES: readonly RecurringChange[] = [];

/**
 * FLOW-1021 (owner, 2026-11-02: "I see the list of all payments and don't understand what was changed"):
 * Home's "N חיובים קבועים השתנו" opens this list of just those charges, each with its arrow, its amount
 * and its usual one ("₪2,550 במקום ₪1,850"), opening its payment. The rows are Home's own single-change
 * row, from the same read (`recurring_changes`), so the count matches. `?project=` reads the project's
 * own changes (FLOW-441), as the project page counts them.
 */
export function RecurringChangesScreen({ sample }: { sample?: readonly RecurringChange[] } = {}) {
  const [params] = useSearchParams();
  // An empty ?project= is no project: the company's list, not a read that never runs.
  const project = params.get("project") || null;
  const preview = useHomePreview();
  const live = sample == null && preview === "off";
  const company = useRecurringChangesQuery(live && project == null);
  const own = useProjectRecurringChangesQuery(project ?? "", live && project != null);
  const query = project == null ? company : own;
  const search = usePreviewSearch();
  const online = useOnline();

  const head = (
    <header className="ui-recurring-head">
      <RecurringBack />
      <h1 className="t-title">חיובים שהשתנו</h1>
      <p className="t-line2">החודש, 20% ומעלה מהסכום הרגיל</p>
    </header>
  );
  if (live && query.isError && query.data == null) {
    return (
      <div className="ui-recurring">
        {head}
        <PageLoadFailed title="החיובים לא נטענו" offline={!online} onRetry={() => void query.refetch()} />
      </div>
    );
  }
  const data = sample ?? (live ? query.data : preview === "loading" ? undefined : NO_CHANGES);
  if (data == null) return <RecurringSkeleton />;
  const rows = chargeChangeViews(project == null ? data : data.filter((row) => row.project_id === project), search).map((change) => changeRow(change, { saysRecurring: false }));
  return (
    <div className="ui-recurring">
      {head}
      {rows.length === 0 ? (
        <EmptyState icon={<RepeatIcon />} title="אין שינויים" body="כל החיובים הקבועים שהגיעו החודש קרובים לסכום הרגיל שלהם." />
      ) : (
        <BannerRows rows={rows} />
      )}
    </div>
  );
}
