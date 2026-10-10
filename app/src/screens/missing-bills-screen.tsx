import type { MissingBill, RecurringChange } from "@flow/shared";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMissingBillsQuery, useRecurringChangesQuery } from "../forecast";
import { arrivedViews, missingBillViews, useRecurringThisMonthQuery } from "../recurring";
import { useHomePreview, usePreviewSearch } from "../preview";
import { screenPhase } from "../query-phase";
import { getSupabase } from "../lib/supabase";
import { assertNoError, useWrite } from "../use-write";
import { MissingBillList } from "../ui/missing-bill-list";
import { ScreenHeader } from "../ui/screen-header";
import { useToast } from "../ui/toast";
import { useBlockedPreview } from "./screen-shared";

type Hide = { kind: "missing" | "change"; key: string; name: string; undo: boolean };

/** What a hide changes: the two lists here and Home's rows (the same reads). */
const HIDE_KEYS = ["missing-bills", "recurring-changes", "recurring-this-month"];

export type RecurringSample = { late: MissingBill[]; arrived?: RecurringChange[]; changes?: RecurringChange[] };

/**
 * FLOW-415 (owner 08:43Z, frame b-2): "קבועים", the recurring suppliers and customers. "לא הגיעו" are
 * the payments late for their month (`missing_bills`, FLOW-403); "הגיעו החודש" are the ones seen this
 * month (`recurring_this_month`), with a change of 20% or more marked. Opened from Home's rows, at
 * their section (`#late`, `#arrived`). Each user can hide a late row or a change for themselves.
 */
export function MissingBillsScreen({ sample }: { sample?: RecurringSample } = {}) {
  const preview = useHomePreview();
  const search = usePreviewSearch();
  const { hash } = useLocation();
  const toast = useToast();
  const blocked = useBlockedPreview();
  const live = sample == null;
  const missing = useMissingBillsQuery(live);
  const thisMonth = useRecurringThisMonthQuery(live);
  const changes = useRecurringChangesQuery(live);
  // A sample screen hides locally, so a story and the e2e show the row leave and come back.
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const base = sample ? ({ kind: "ready" } as const) : screenPhase(preview, missing);
  // With nothing late, wait for הגיעו החודש before saying "הכל הגיע", so the empty state never flashes.
  const phase = base.kind === "ready" && !sample && (missing.data ?? []).length === 0 && thisMonth.isPending ? ({ kind: "loading" } as const) : base;
  const late = sample ? sample.late.filter((row) => row.alert_key == null || !hidden.has(row.alert_key)) : (missing.data ?? []);
  const open = sample ? (sample.changes ?? []).filter((row) => row.alert_key == null || !hidden.has(row.alert_key)) : (changes.data ?? []);
  const rows = missingBillViews(late, search);
  // The arrivals are a second read: while it loads or if it fails, the late rows still show.
  const arrived = arrivedViews(sample?.arrived ?? thisMonth.data ?? [], open, search);

  const write = useWrite<Hide>({
    failure: () => "לא הצלחנו להסתיר את ההתראה.",
    keys: HIDE_KEYS,
    onSuccess: (done) => {
      toast.show({
        message: done.undo ? "ההתראה חזרה" : "ההתראה הוסתרה",
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => {
            write.mutate({ ...done, undo: true });
          },
        }),
      });
    },
    run: async (hide) => {
      if (!live) {
        setHidden((before) => {
          const next = new Set(before);
          if (hide.undo) next.delete(hide.key);
          else next.add(hide.key);
          return next;
        });
        return;
      }
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      const args = { p_kind: hide.kind, p_key: hide.key };
      assertNoError(hide.undo ? await supabase.rpc("undismiss_recurring_alert", args) : await supabase.rpc("dismiss_recurring_alert", args));
    },
  });

  // Home's rows open the screen at their section once the rows are in.
  const ready = phase.kind === "ready" && (hash !== "#arrived" || arrived.length > 0);
  useEffect(() => {
    if (!ready || hash === "") return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start" });
  }, [ready, hash]);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <ScreenHeader title="קבועים" backTo={`/${search}`} />
      <MissingBillList
        rows={rows}
        arrived={arrived}
        phase={phase}
        onRetry={() => { void missing.refetch(); }}
        onHide={(kind, key, name) => {
          if (write.isPending || (live && blocked())) return;
          write.mutate({ kind, key, name, undo: false });
        }}
      />
    </div>
  );
}
