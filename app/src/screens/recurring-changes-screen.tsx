import "../ui/lazy.css";
import type { ProjectDetail, RecurringChange } from "@flow/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { chargeChangeViews, useProjectRecurringChangesQuery, useRecurringChangesQuery } from "../forecast";
import { RECURRING_KEYS } from "../pace-write";
import { previewFails, useHomePreview, usePreviewSearch } from "../preview";
import { dismissRecurringAlert, liveRpcClient, restoreRecurringAlert } from "../recurring-actions";
import { chargeHref } from "../recurring-charge";
import { PageLoadFailed, useOnline } from "../ui/band-states";
import { EmptyState } from "../ui/empty-state";
import { IconButton } from "../ui/icon-button";
import { CloseIcon, RepeatIcon, TrendDownIcon, TrendUpIcon } from "../ui/icons";
import { ListRow } from "../ui/list-row";
import { BackButton } from "../ui/back";
import { FocusTitle } from "../ui/focus-title";
import { ChangedChargesSkeleton } from "../ui/screen-skeletons";
import { useToast } from "../ui/toast";
import { topToast } from "../ui/top-toast";
import { useHoldWrites } from "../use-is-viewer";
import "../ui/css/39-recurring.css";

const NO_CHANGES: readonly RecurringChange[] = [];

/** The key the change's alert is set aside by: the server's own, else the payment's id (decision 0175). */
function alertKeyOf(row: RecurringChange): string {
  return row.alert_key ?? row.transaction_id;
}

/** Where a changed charge opens: its charge page (V3-Changes), or its payment when the row names no party. */
function hrefOf(row: RecurringChange, fallback: string, search: string): string {
  if (row.party_id == null || row.direction == null) return fallback;
  return chargeHref(row.direction, row.party_id, search, row.project_id ?? null);
}

/**
 * FLOW-1021, FLOW-1048 (V3-Changes, the List pattern): Home's "N חיובים קבועים השתנו" opens this list of just those
 * charges, each with its arrow, its amount and its usual one ("₪2,550 במקום ₪1,850"), opening its charge page. The
 * X marks the change as seen with the existing ignore-alert write (`dismiss_recurring_alert('change', …)`) and a
 * ביטול toast; a later change brings it back here and on Home. `?project=` reads the project's own changes (FLOW-441).
 * FLOW-1030: opened from a project, Back names the project and goes back to its page.
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
  const toast = useToast();
  const holdWrites = useHoldWrites();
  // The changes marked as seen on this visit: they leave at once; a failed write brings them back.
  const [seen, setSeen] = useState<ReadonlySet<string>>(() => new Set());
  const data = sample ?? (live ? query.data : preview === "loading" ? undefined : NO_CHANGES);
  // Back to the project names it: from its own changes, or the project page's read already on the phone, never a read of its own.
  const backName = project == null ? "בית" : (
    data?.find((row) => row.project_id === project)?.project_name
      ?? client.getQueriesData<ProjectDetail | null>({ queryKey: ["project", preview, project] }).find(([, read]) => read != null)?.[1]?.name
      ?? "פרויקט"
  );
  const backTo = project == null ? `/${search}` : `/projects/${encodeURIComponent(project)}${search}`;

  const head = (
    <header className="ui-recurring-head">
      <BackButton fallback={backTo} text={backName} />
      <FocusTitle className="t-title">חיובים שהשתנו</FocusTitle>
      <p className="ui-recurring-sub t-meta">החודש, 20% ומעלה מהסכום הרגיל</p>
    </header>
  );
  // A preview of a failed read (?preview=error) draws the failure, as the live read would.
  if ((live && query.isError && query.data == null) || previewFails(preview)) {
    return (
      <div className="ui-recurring">
        <div className="ui-recurring-body">
          {head}
          <PageLoadFailed title="החיובים לא נטענו" offline={!online} onRetry={() => void query.refetch()} />
        </div>
      </div>
    );
  }
  if (data == null) {
    return (
      <div className="ui-recurring">
        <div className="ui-recurring-body">
          {head}
          <ChangedChargesSkeleton />
        </div>
      </div>
    );
  }

  const refresh = () => {
    for (const key of RECURRING_KEYS) void client.invalidateQueries({ queryKey: [key] });
  };
  const failure = () => toast.show(topToast({ message: "לא הצלחנו לעדכן את השורה." }));
  const mark = (id: string, on: boolean) => {
    setSeen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  async function restore(row: RecurringChange) {
    mark(row.transaction_id, false);
    try {
      if (live) await restoreRecurringAlert(liveRpcClient(), alertKeyOf(row), "change");
    } catch {
      mark(row.transaction_id, true);
      failure();
      return;
    }
    if (live) refresh();
  }

  async function markSeen(row: RecurringChange, title: string) {
    mark(row.transaction_id, true);
    try {
      if (live) await dismissRecurringAlert(liveRpcClient(), alertKeyOf(row), "change");
    } catch {
      mark(row.transaction_id, false);
      failure();
      return;
    }
    if (live) refresh();
    toast.show(topToast({ message: `סומן כנסקר: ${title}`, action: "ביטול", onAction: () => void restore(row) }));
  }

  const mine = project == null ? data : data.filter((row) => row.project_id === project);
  const views = chargeChangeViews(mine, search);
  const rows = mine.map((row, index) => ({ row, view: views[index] })).filter((item) => item.view != null && !seen.has(item.row.transaction_id));
  return (
    <div className="ui-recurring">
      <div className="ui-recurring-body">
        {head}
        {rows.length === 0 ? (
          <EmptyState icon={<RepeatIcon />} title="אין שינויים" body="כל החיובים הקבועים שהגיעו החודש קרובים לסכום הרגיל שלהם." />
        ) : (
          <section className="ui-changes" aria-labelledby="changes-count">
            <h2 id="changes-count" className="ui-changes-head t-section">{rows.length === 1 ? "חיוב אחד לבדיקה" : `${String(rows.length)} חיובים לבדיקה`}</h2>
            <ul className="ui-changes-list" aria-live="polite">
              {rows.map(({ row, view }) => {
                if (view == null) return null;
                const percent = row.change_percent;
                return (
                  <li key={row.transaction_id} className="ui-changes-item">
                    <ListRow
                      layout="flat"
                      variant="project"
                      icon={view.down ? <TrendDownIcon size={24} stroke={1.9} /> : <TrendUpIcon size={24} stroke={1.9} />}
                      title={view.title}
                      hint={<><bdi dir="ltr">{view.now}</bdi> במקום <bdi dir="ltr">{view.usual}</bdi></>}
                      agorot={row.amount_minor < 0n ? -row.amount_minor : row.amount_minor}
                      currency={row.currency}
                      endSub={`${percent < 0 ? "▼" : "▲"} ${String(Math.abs(percent))}%`}
                      href={hrefOf(row, view.href, search)}
                    />
                    {holdWrites ? null : (
                      <IconButton label={`סקרתי: ${view.title}`} onClick={() => void markSeen(row, view.title)}>
                        <CloseIcon size={18} />
                      </IconButton>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
        {rows.length === 0 ? null : <p className="ui-changes-note t-caption">X מסמן שראיתם את השינוי. אם החיוב ישתנה שוב, הוא יחזור לכאן ולבית.</p>}
      </div>
    </div>
  );
}
