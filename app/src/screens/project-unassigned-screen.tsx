import "../ui/lazy.css";
import { formatAmountText, type ProjectCashRow, type SearchRow } from "@flow/shared";
import { useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { getSupabase } from "../lib/supabase";
import { allTime, periodFromSearch } from "../period";
import { useHomePreview, usePreviewSearch } from "../preview";
import { useProjectsCashMonth } from "../project-cash";
import { groupUnassignedRows, kindLabel, rowKind, suggestedProject } from "../project-list";
import { screenPhase } from "../query-phase";
import { EMPTY_FILTERS, searchCountWords, searchRowTitle, uniqueSearchRows, useSearchQuery } from "../search";
import { useHoldWrites } from "../use-is-viewer";
import { assertNoError, useWrite } from "../use-write";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { ChoiceSheet } from "../ui/choice-sheet";
import { cashMonthName } from "../cash";
import { EmptyState, FailureLine } from "../ui/empty-state";
import { GroupHead } from "../ui/group-head";
import { CheckIcon } from "../ui/icons";
import { List, ListRow } from "../ui/list-row";
import { ScreenHeader } from "../ui/screen-header";
import { DelayedSkeleton } from "../ui/skeleton";
import { useToast } from "../ui/toast";
import type { ToastInput } from "../ui/toast-layout";
import { ProjectFormSheet } from "./project-form-sheet";
import { UnassignedSkeleton } from "./project-skeletons";
import { useBlockedPreview } from "./screen-shared";

/** A sample list (stories): the lines and the projects the picker offers. */
export type UnassignedSample = { rows: SearchRow[]; projects: ProjectCashRow[] };

/** `undo` takes the id reassign_transaction returns for this one assign (filled by its write). */
type Assign = { row: SearchRow; projectId: string; projectName: string; undo: { id: string | null } };

/** The undo id reassign_transaction returns, by line, so ביטול puts the line back. */
type Undo = { line: string; id: string };

/** FLOW-1089: the assign toast; ביטול only with an undo that can run (reassign_transaction returned an id). */
export function assignedToast(projectName: string, undo: (() => void) | null): ToastInput {
  return undo == null ? { message: `שויך ל${projectName}` } : { message: `שויך ל${projectName}`, action: "ביטול", onAction: undo };
}

/**
 * FLOW-1044 (board V3-Unassigned): the lines with no project, a List screen over search_transactions with
 * project=none, for the period the link carries (the list's month) or every line. Each row's שיוך opens the
 * project picker with the project its category points to first; the row folds as it is assigned, and the
 * toast offers ביטול (undo_reassign). A line with no category opens its page, where both are set.
 */
export function ProjectUnassignedScreen({ sample }: { sample?: UnassignedSample } = {}) {
  const location = useLocation();
  const search = usePreviewSearch();
  const preview = useHomePreview();
  const holdWrites = useHoldWrites();
  const blocked = useBlockedPreview();
  const toast = useToast();
  const params = new URLSearchParams(location.search);
  const period = periodFromSearch(params) ?? allTime();
  const query = useSearchQuery({ ...EMPTY_FILTERS, project: "none", period }, sample == null);
  const month = useProjectsCashMonth();
  const [gone, setGone] = useState<ReadonlySet<string>>(() => new Set());
  const [picking, setPicking] = useState<SearchRow | null>(null);
  /** FLOW-1093: the line the new-project sheet is open for. */
  const [creating, setCreating] = useState<SearchRow | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const pages = query.data?.pages ?? [];
  const all = sample?.rows ?? uniqueSearchRows(pages);
  const rows = all.filter((row) => !gone.has(row.id));
  const projects = (sample?.projects ?? month.data?.projects ?? []).filter((project) => project.status === "active");
  const phase = sample ? ({ kind: "ready" } as const) : screenPhase(preview, query);
  const total = sample == null ? (pages[0]?.total ?? rows.length) - gone.size : rows.length;
  const groups = groupUnassignedRows(rows);
  const first = groups[0];
  const sum = groups.filter((group) => group.currency === first?.currency).reduce((acc, group) => acc + group.net, 0n);
  const periodWord = period.kind === "month" && period.from != null ? cashMonthName(period.from.slice(0, 7)) : null;
  const show = (id: string, on: boolean) => {
    setGone((current) => {
      const next = new Set(current);
      if (on) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const undoAssign = useWrite<Undo>({
    failure: "לא הצלחנו לבטל את השיוך.",
    keys: ["search", "dashboard", "project", "projects-cash"],
    onSuccess: (payload) => { show(payload.line, true); },
    run: async (payload) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_reassign", { p_id: payload.id }));
    },
  });
  /** The toast after an assign: the project's name and ביטול, which puts the line back. */
  function assigned(payload: Assign, undoIt: (() => void) | null) {
    toast.show(assignedToast(payload.projectName, undoIt));
  }
  const assign = useWrite<Assign>({
    failure: "לא הצלחנו לשייך את השורה.",
    keys: ["search", "dashboard", "project", "projects-cash"],
    onError: (_error, payload) => { show(payload.row.id, true); },
    onSuccess: (payload) => {
      // FLOW-1089: with no undo id from the write, ביטול would do nothing, so the toast offers none.
      const id = payload.undo.id;
      assigned(payload, id == null ? null : () => { undoAssign.mutate({ line: payload.row.id, id }); });
    },
    run: async (payload) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const result = await supabase.rpc("reassign_transaction", { p_id: payload.row.id, p_project_id: payload.projectId, p_category_id: payload.row.category_id ?? "" });
      assertNoError(result);
      payload.undo.id = typeof result.data === "string" ? result.data : null;
    },
  });
  /** The row folds, then the assign write (a sample list writes nothing; its toast's ביטול brings the row back). */
  function assignTo(row: SearchRow, projectId: string, projectName: string) {
    show(row.id, false);
    const payload = { row, projectId, projectName, undo: { id: null } };
    if (sample != null) assigned(payload, () => { show(row.id, true); });
    else assign.mutate(payload);
  }
  const header = (
    <ScreenHeader
      layout="stacked"
      title="שורות בלי פרויקט"
      kicker="פרויקטים"
      backTo={`/projects${search}`}
      subtitle={phase.kind === "ready" ? (total <= 0 ? "הכול משויך" : `${searchCountWords(total)}${periodWord == null ? "" : ` · ${periodWord}`}`) : undefined}
      compactFigure={first == null ? undefined : <bdi dir="ltr">{formatAmountText(sum, first.currency)}</bdi>}
    />
  );
  if (phase.kind === "loading") {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col" aria-busy="true">
        {header}
        <DelayedSkeleton offline><UnassignedSkeleton /></DelayedSkeleton>
      </div>
    );
  }
  if (phase.kind === "error") {
    return (
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {header}
        <FailureLine offline={phase.offline} onRetry={() => { void query.refetch(); }} />
      </div>
    );
  }
  const picked = picking;
  const suggestion = picked == null ? null : suggestedProject(picked.category_name, projects);
  const choices = [
    ...(suggestion == null ? [] : [suggestion]),
    ...projects.filter((project) => project.id !== suggestion?.id),
  ].map((project) => ({
    value: project.id,
    label: project.name,
    description: project.id === suggestion?.id ? `${kindLabel(rowKind(project))} · מוצע` : kindLabel(rowKind(project)),
  }));
  return (
    <div className="ui-unassigned flex min-h-0 min-w-0 flex-1 flex-col">
      {header}
      {first == null ? null : (
        <p className="ui-page-pad ui-unassigned-figure t-detail">
          <bdi dir="ltr">{formatAmountText(sum, first.currency)}</bdi>
        </p>
      )}
      <p className="ui-page-pad ui-unassigned-note t-line2">שורה בלי פרויקט נספרת בתזרים החברה, אבל לא ברווח של אף פרויקט.</p>
      {groups.length === 0 ? (
        <div className="ui-state-empty flex min-h-0 flex-1 flex-col">
          <EmptyState icon={<CheckIcon />} title="כל השורות משויכות" body="שורה חדשה בלי פרויקט תופיע כאן." />
        </div>
      ) : groups.map((group) => (
        <section key={group.month} className="ui-month" aria-labelledby={`unassigned-${group.month}`}>
          <GroupHead
            id={`unassigned-${group.month}`}
            title={cashMonthName(group.month)}
            summary={<><bdi dir="ltr">{String(group.rows.length)}</bdi> · <bdi dir="ltr">{formatAmountText(group.net, group.currency)}</bdi></>}
          />
          <List>
            {group.rows.map((row) => (
              <div key={row.id} className="ui-unassigned-row">
                <ListRow
                  variant="project"
                  title={searchRowTitle(row)}
                  // FLOW-1053 (board V3-Unassigned): the party's initials lead the line.
                  icon={<Avatar name={searchRowTitle(row)} fallback="person" />}
                  hint={`${row.doc_date.slice(8, 10)}/${row.doc_date.slice(5, 7)}${row.category_name == null ? "" : ` · ${row.category_name}`}`}
                  agorot={row.amount_net < 0n ? -row.amount_net : row.amount_net}
                  currency={row.currency}
                  amountDirection={row.direction === "income" ? "income" : undefined}
                  href={`/transactions/${row.id}${search}`}
                />
                {holdWrites ? null : row.category_id == null ? (
                  <Button variant="secondary" to={`/transactions/${row.id}${search}`}>שיוך</Button>
                ) : (
                  <Button
                    variant="secondary"
                    onClick={(event) => {
                      opener.current = event.currentTarget;
                      setPicking(row);
                    }}
                  >
                    שיוך
                  </Button>
                )}
              </div>
            ))}
          </List>
        </section>
      ))}
      {sample == null && query.hasNextPage ? (
        <div className="ui-page-pad">
          <Button variant="link" busy={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>עוד שורות</Button>
        </div>
      ) : null}
      <ChoiceSheet
        copy={{
          historyKey: "unassigned-assign",
          title: "לאיזה פרויקט?",
          empty: "אין עדיין פרויקט לשייך אליו",
          subtitle: picked == null ? undefined : `${searchRowTitle(picked)} · ${formatAmountText(picked.amount_net < 0n ? -picked.amount_net : picked.amount_net, picked.currency)}`,
          choices,
        }}
        open={picked != null}
        onOpenChange={(open) => { if (!open) setPicking(null); }}
        value=""
        saving={null}
        returnFocusRef={opener}
        onPick={(projectId, close) => {
          const row = picking;
          close();
          if (row == null || (sample == null && blocked())) return;
          assignTo(row, projectId, projects.find((item) => item.id === projectId)?.name ?? "");
        }}
        // FLOW-1093 (board V3-Unassigned; the owner, 2026-11-07: create, then assign): the new-project sheet,
        // and the line goes to the project once it is saved.
        action={{
          label: "+ פרויקט חדש",
          onSelect: (close) => {
            setCreating(picking);
            close();
          },
        }}
      />
      <ProjectFormSheet
        open={creating != null}
        onOpenChange={(open) => { if (!open) setCreating(null); }}
        returnFocusRef={opener}
        onCreated={(projectId, projectName) => {
          if (creating != null) assignTo(creating, projectId, projectName);
        }}
      />
    </div>
  );
}
