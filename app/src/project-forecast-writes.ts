import type { Json } from "@flow/shared";
import { useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import { getSupabase } from "./lib/supabase";
import type { ProjectForecastEdit } from "./project-next-month";
import { FORECAST_EDITS_KEY } from "./project-next-month-query";
import { assertNoError, useWrite } from "./use-write";
import { useToast } from "./ui/toast";
import { topToast } from "./ui/top-toast";

/**
 * The project forecast's writes (set_project_forecast_edit, remove_project_forecast_row,
 * restore_project_forecast_row, reset_project_forecast). Each returns its undo, which the toast's ביטול
 * sends back through undo_project_forecast, as the month forecast does.
 */

/** What a write hands back for its undo: the edits it made go, the ones it replaced or deleted come back. */
export type ForecastUndo = { drop: string[]; put: Json[] };

type Call =
  | { fn: "set_project_forecast_edit"; edit: Record<string, unknown>; message: string }
  | { fn: "remove_project_forecast_row" | "restore_project_forecast_row"; rowKey: string; message: string }
  | { fn: "reset_project_forecast"; message: string };

function undoOf(data: unknown): ForecastUndo | null {
  const undo = (data as { undo?: unknown } | null)?.undo as { drop?: unknown; put?: unknown } | undefined;
  if (undo == null || !Array.isArray(undo.drop) || !Array.isArray(undo.put)) return null;
  if (undo.drop.length === 0 && undo.put.length === 0) return null;
  return { drop: undo.drop.filter((id): id is string => typeof id === "string"), put: undo.put as Json[] };
}

/** The edit a removal will write, drawn at once (decision 0219: the row leaves at once, ביטול 5s). */
function removalEdit(rowKey: string, month: string): ProjectForecastEdit {
  return { id: `optimistic-remove:${rowKey}`, kind: "remove", row_key: rowKey, category_id: null, direction: null, amount_minor: null, pace: "once", start_month: month };
}

export function useProjectForecastWrites(projectId: string, month: string) {
  const toast = useToast();
  const client = useQueryClient();
  const lastUndo = useRef<ForecastUndo | null>(null);
  // FLOW-969: a write and its ביטול run one after the other, so a quick ביטול never races the write.
  const scope = `project-forecast-${projectId}`;
  const undo = useWrite<ForecastUndo>({
    place: "top",
    scope,
    run: async (body) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_project_forecast", { p_project_id: projectId, p_undo: body }));
    },
    keys: [FORECAST_EDITS_KEY],
    failure: "לא הצלחנו לבטל את השינוי בצפי",
  });
  const write = useWrite<Call>({
    place: "top",
    scope,
    run: async (call) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      lastUndo.current = null;
      // Each RPC by its name as a string, so the deploy smoke's guard can see it.
      const result = call.fn === "set_project_forecast_edit"
        ? await supabase.rpc("set_project_forecast_edit", { p_project_id: projectId, p_month: month, p_edit: call.edit as never })
        : call.fn === "reset_project_forecast"
          ? await supabase.rpc("reset_project_forecast", { p_project_id: projectId, p_month: month })
          : call.fn === "remove_project_forecast_row"
            ? await supabase.rpc("remove_project_forecast_row", { p_project_id: projectId, p_month: month, p_row_key: call.rowKey })
            : await supabase.rpc("restore_project_forecast_row", { p_project_id: projectId, p_month: month, p_row_key: call.rowKey });
      assertNoError(result);
      lastUndo.current = undoOf(result.data);
    },
    keys: [FORECAST_EDITS_KEY],
    // A removal leaves the list at once; a failure puts the row back (useWrite's rollback) and says so.
    optimistic: (call) => {
      if (call.fn !== "remove_project_forecast_row") return [];
      return client.getQueriesData<ProjectForecastEdit[]>({ queryKey: [FORECAST_EDITS_KEY] })
        .filter(([key]) => key[2] === projectId && key[3] === month)
        .map(([key]) => ({ key, update: (old: unknown) => [...((old as ProjectForecastEdit[] | undefined) ?? []), removalEdit(call.rowKey, month)] }));
    },
    failure: "לא הצלחנו לעדכן את הצפי",
    onSuccess: (call) => {
      const back = lastUndo.current;
      // Decision 0219: under the header, the ביטול 5s and a note 4s.
      toast.show(topToast({
        message: call.message,
        ...(back == null ? {} : { action: "ביטול", onAction: () => { undo.mutate(back); } }),
      }));
    },
  });
  return { mutate: write.mutate, pending: write.isPending };
}
