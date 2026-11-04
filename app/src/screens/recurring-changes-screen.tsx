import "../ui/lazy.css";
import type { ProjectDetail, RecurringChange } from "@flow/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { chargeChangeViews, useProjectRecurringChangesQuery, useRecurringChangesQuery } from "../forecast";
import { useHomePreview, usePreviewSearch } from "../preview";
import { PageLoadFailed, useOnline } from "../ui/band-states";
import { BannerRows } from "../ui/banner";
import { EmptyState } from "../ui/empty-state";
import { RepeatIcon } from "../ui/icons";
import { RecurringBack } from "../ui/recurring-list";
import { ChangedChargesSkeleton } from "../ui/screen-skeletons";
import { changeRow } from "./attention-rows";

const NO_CHANGES: readonly RecurringChange[] = [];

/**
 * FLOW-1021 (owner, 2026-11-02: "I see the list of all payments and don't understand what was changed"):
 * Home's "N חיובים קבועים השתנו" opens this list of just those charges, each with its arrow, its amount
 * and its usual one ("₪2,550 במקום ₪1,850"), opening its payment. The rows are Home's own single-change
 * row, from the same read (`recurring_changes`), so the count matches. `?project=` reads the project's
 * own changes (FLOW-441), as the project page counts them. FLOW-1030: it loads under its own head, and
 * opened from a project, Back names the project and goes back to its page.
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
  const client = useQueryClient();
  const data = sample ?? (live ? query.data : preview === "loading" ? undefined : NO_CHANGES);
  // Back to the project names it: from its own changes, or the project page's read already on the phone, never a read of its own.
  const backTo = project == null ? undefined : {
    id: project,
    name: data?.find((row) => row.project_id === project)?.project_name
      ?? client.getQueriesData<ProjectDetail | null>({ queryKey: ["project", preview, project] }).find(([, read]) => read != null)?.[1]?.name
      ?? "פרויקט",
  };

  const head = (
    <header className="ui-recurring-head">
      <RecurringBack project={backTo} />
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
  if (data == null) {
    return (
      <div className="ui-recurring">
        {head}
        <ChangedChargesSkeleton />
      </div>
    );
  }
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
