// FLOW-963 (owner, 2026-10-26): the charge page's פרויקט and קטגוריה rows open a picker. A pick moves every
// payment of the charge, the earlier ones too (reassign_recurring_charge), and the toast's ביטול puts them back.
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RECURRING_KEYS } from "../pace-write";
import { usePreviewSearch } from "../preview";
import { liveRpcClient, reassignRecurringCharge, undoRecurringChargePick, type ChargePickResult } from "../recurring-actions";
import { chargeHref } from "../recurring-charge";
import { recurringToast } from "../recurring-toast";
import type { ScheduleRow } from "../recurring-schedule";
import { useCategoriesQuery, useDashboardQuery } from "../use-books";
import { ChoiceSheet } from "../ui/choice-sheet";
import { useToast } from "../ui/toast";
import { useWrite } from "../use-write";

/** Which picker is open. */
export type ChargePickKind = "project" | "category";

/** A picker's choice: an id and its name. */
export type ChargePickChoice = { id: string; name: string };

type PickWrite = { kind: ChargePickKind; id: string; name: string; close: () => void };

/** The reads every pick refreshes: the recurring pages, and the books the payments moved in. */
const PICK_KEYS = [...RECURRING_KEYS, "dashboard", "review", "categories", "project", "project-category", "txn", "breakdown", "breakdown-lines", "profit-months"];

/** "Water עבר לCedar St", and how many payments it left as they were. */
export function chargePickToast(party: string, target: string, result: Pick<ChargePickResult, "changed" | "skipped">): string {
  if (result.changed === 0) return "לא היה מה לשנות";
  const left = result.skipped === 0 ? "" : result.skipped === 1 ? " · תשלום אחד לא שונה" : ` · ${String(result.skipped)} תשלומים לא שונו`;
  return `${party} עבר ל${target}${left}`;
}

/** The undo's failure: a payment changed since the pick, or the write failed. */
export function chargeUndoFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : typeof error === "object" && error != null && "message" in error ? String(error.message) : "";
  return text.includes("conflict") ? "תשלום השתנה מאז, אז הביטול לא בוצע." : "לא הצלחנו לבטל.";
}

/**
 * The pickers and their write. `sample` lists the choices in a story and keeps the write local; the app
 * reads the company's active projects and the charge's kind of categories. The server decides which
 * payments the charge has (decision 0185); the page sends the row's project.
 */
export function useChargePick({
  row,
  live,
  sample,
}: {
  row: ScheduleRow;
  live: boolean;
  sample?: { projects: ChargePickChoice[]; categories: ChargePickChoice[] };
}) {
  const toast = useToast();
  const client = useQueryClient();
  const navigate = useNavigate();
  const search = usePreviewSearch();
  const [open, setOpen] = useState<ChargePickKind | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
  // Where a split charge moved: the page follows once its sheet has closed, so the sheet's own history
  // step is not left on top of the new address (as the pace sheet's not-recurring pick does).
  const moveTo = useRef<string | null>(null);
  useEffect(() => {
    if (open == null && moveTo.current != null) {
      const href = moveTo.current;
      moveTo.current = null;
      void navigate(href, { replace: true });
    }
  }, [open, navigate]);
  // A sample keeps the pick on screen; the app reads it back from the schedule.
  const [local, setLocal] = useState<{ project?: ChargePickChoice; category?: ChargePickChoice }>({});
  const dashboard = useDashboardQuery(live);
  const categories = useCategoriesQuery(live);
  const projects: ChargePickChoice[] = sample?.projects
    ?? (dashboard.data?.projects ?? []).filter((project) => project.status !== "finished" || project.id === row.project_id).map((project) => ({ id: project.id, name: project.name }));
  const kinds: ChargePickChoice[] = sample?.categories
    ?? (categories.data ?? []).filter((category) => category.kind === row.direction && (!category.hidden || category.id === row.category_id)).map((category) => ({ id: category.id, name: category.name }));
  const target = { direction: row.direction, partyId: row.party_id, currency: row.currency, projectId: row.project_id };

  /**
   * The toast's ביטול. It runs on its own, not through the page's write, so it still works after a project
   * pick on a split charge moved the page to the charge's new address. A second tap while it runs is ignored.
   */
  function undoAction(pick: PickWrite, result: ChargePickResult) {
    let running = false;
    return () => {
      if (running) return;
      running = true;
      void (async () => {
        try {
          if (live) await undoRecurringChargePick(liveRpcClient(), result.undoIds);
          else setLocal((old) => ({ ...old, [pick.kind]: undefined }));
        } catch (error) {
          running = false;
          toast.show(recurringToast({ tone: "bad", message: chargeUndoFailure(error) }));
          return;
        }
        for (const key of PICK_KEYS) void client.invalidateQueries({ queryKey: [key] });
        if (live && result.split && pick.kind === "project") {
          void navigate(chargeHref(row.direction, row.party_id, search, row.project_id), { replace: true });
        }
      })();
    };
  }

  const write = useWrite<PickWrite>({
    place: "top",
    keys: PICK_KEYS,
    failure: (error) => (error.message.includes("forbidden") ? "אין הרשאה לעדכן את השורה." : "לא הצלחנו לעדכן את התשלומים."),
    onError: () => {
      setSaving(null);
    },
    run: async (pick) => {
      const result = live
        ? await reassignRecurringCharge(liveRpcClient(), { ...target, ...(pick.kind === "project" ? { project: pick.id } : { category: pick.id }) })
        : { changed: 1, skipped: 0, split: false, undoIds: [] };
      if (!live) setLocal((old) => ({ ...old, [pick.kind]: { id: pick.id, name: pick.name } }));
      // A split charge's address names its project (decision 0185): the moved charge is the new project's.
      if (live && result.split && pick.kind === "project" && result.changed > 0) {
        moveTo.current = chargeHref(row.direction, row.party_id, search, pick.id);
      }
      setSaving(null);
      pick.close();
      toast.show(recurringToast({
        message: chargePickToast(row.party_name, pick.name, result),
        ...(result.changed === 0 ? {} : { action: "ביטול", onAction: undoAction(pick, result) }),
      }));
    },
  });

  const currentProject = local.project?.id ?? row.project_id ?? "";
  const currentCategory = local.category?.id ?? row.category_id ?? "";
  const kind = open ?? "project";
  const subtitle = `חל על כל התשלומים של ${row.party_name}, גם הקודמים`;
  const sheet = (
    <ChoiceSheet
      copy={{
        historyKey: `charge-${kind}`,
        title: kind === "project" ? "פרויקט" : "קטגוריה",
        subtitle,
        choices: (kind === "project" ? projects : kinds).map((choice) => ({ value: choice.id, label: choice.name })),
      }}
      open={open != null}
      onOpenChange={(next) => {
        if (!next) setOpen(null);
      }}
      value={kind === "project" ? currentProject : currentCategory}
      saving={saving}
      onPick={(id, close) => {
        if (write.isPending) return;
        const list = kind === "project" ? projects : kinds;
        const name = list.find((choice) => choice.id === id)?.name ?? "";
        setSaving(id);
        write.mutate({ kind, id, name, close });
      }}
    />
  );
  return {
    sheet,
    open: (next: ChargePickKind) => {
      if (!write.isPending) setOpen(next);
    },
    busy: write.isPending,
    /** The names the card shows: a sample's pick, else the schedule's. */
    projectName: local.project?.name,
    categoryName: local.category?.name,
  };
}
