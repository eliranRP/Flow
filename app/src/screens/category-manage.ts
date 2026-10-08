import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import {
  deletedToast,
  deleteFailureText,
  movedToast,
  moveFailureText,
  restoreFailureText,
  undoMoveFailureText,
} from "../category-copy";
import { getSupabase } from "../lib/supabase";
import { useToast } from "../ui/toast";
import { assertNoError, useWrite } from "../use-write";

/** FLOW-405 (decision 0144): delete a category with lines and move all its lines, each with a ביטול toast. */

/** Everything a delete or a move changes: the lines go back to review or to another category. */
const CATEGORY_WRITE_KEYS = ["categories", "dashboard", "review", "txn", "project", "project-category", "project-waiting"];

export type CategoryTarget = { id: string; name: string };

type CountClient = NonNullable<ReturnType<typeof getSupabase>>;

/**
 * How many lines on the books use the category, whole or as a split part: the count
 * delete_category sends back to review. Removed and void lines don't count.
 */
export async function countCategoryLines(supabase: CountClient, categoryId: string): Promise<number> {
  const [whole, parts] = await Promise.all([
    supabase
      .from("transactions")
      .select("id")
      .eq("category_id", categoryId)
      .is("removed_at", null)
      .neq("line_status", "void"),
    supabase.from("line_splits").select("transaction_id").eq("category_id", categoryId),
  ]);
  assertNoError(whole);
  assertNoError(parts);
  const ids = new Set((whole.data ?? []).map((row) => row.id));
  const splitIds = [...new Set((parts.data ?? []).map((row) => row.transaction_id))].filter((id) => !ids.has(id));
  if (splitIds.length > 0) {
    const split = await supabase
      .from("transactions")
      .select("id")
      .in("id", splitIds)
      .is("removed_at", null)
      .neq("line_status", "void");
    assertNoError(split);
    for (const row of split.data ?? []) ids.add(row.id);
  }
  return ids.size;
}

/** The delete confirm's count. A sample (stories, previews) passes its own and reads nothing. */
export function useCategoryLineCount(categoryId: string | null, sample?: number) {
  return useQuery({
    queryKey: ["categories", "lines", categoryId],
    enabled: categoryId != null && sample == null,
    queryFn: async (): Promise<number> => {
      const supabase = getSupabase();
      if (!supabase || categoryId == null) throw new Error("supabase");
      return countCategoryLines(supabase, categoryId);
    },
  });
}

/** delete_category, then a toast with the count and ביטול through restore_category. */
export function useDeleteCategory(options: { onDeleted?: (target: CategoryTarget) => void } = {}) {
  const toast = useToast();
  const deleted = useRef<{ id: string; name: string; lines: number } | null>(null);
  const restore = useWrite<CategoryTarget>({
    failure: restoreFailureText,
    success: "הקטגוריה חזרה",
    keys: CATEGORY_WRITE_KEYS,
    run: async (target) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("restore_category", { p_category_id: target.id }));
    },
  });
  const remove = useWrite<CategoryTarget>({
    failure: deleteFailureText,
    keys: CATEGORY_WRITE_KEYS,
    onSuccess: (target) => {
      const done = deleted.current ?? { ...target, lines: 0 };
      toast.show({
        message: deletedToast(done.name, done.lines),
        action: "ביטול",
        onAction: () => { restore.mutate(target); },
      });
      options.onDeleted?.(target);
    },
    run: async (target) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      deleted.current = null;
      const result = await supabase.rpc("delete_category", { p_category_id: target.id });
      assertNoError(result);
      deleted.current = { id: target.id, ...readDeleted(result.data, target.name) };
    },
  });
  return { remove, restore };
}

/** move_category_lines, then a toast with the count and ביטול through undo_category_move. */
export function useMoveCategoryLines(options: { onMoved?: () => void } = {}) {
  const toast = useToast();
  const moved = useRef<{ moveId: string; lines: number } | null>(null);
  const undo = useWrite<string>({
    failure: undoMoveFailureText,
    success: "התנועות חזרו",
    keys: CATEGORY_WRITE_KEYS,
    run: async (moveId) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      assertNoError(await supabase.rpc("undo_category_move", { p_move_id: moveId }));
    },
  });
  const move = useWrite<{ from: CategoryTarget; into: CategoryTarget }>({
    failure: moveFailureText,
    keys: CATEGORY_WRITE_KEYS,
    onSuccess: ({ into }) => {
      const done = moved.current;
      const lines = done?.lines ?? 0;
      toast.show({
        message: movedToast(lines, into.name),
        ...(done != null && lines > 0 ? { action: "ביטול", onAction: () => { undo.mutate(done.moveId); } } : {}),
      });
      options.onMoved?.();
    },
    run: async ({ from, into }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      moved.current = null;
      const result = await supabase.rpc("move_category_lines", { p_from: from.id, p_into: into.id });
      assertNoError(result);
      moved.current = readMoved(result.data);
    },
  });
  return { move, undo };
}

function record(value: unknown): Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

/** delete_category returns { deletion_id, name, lines }. */
export function readDeleted(value: unknown, fallbackName: string): { name: string; lines: number } {
  const body = record(value);
  return {
    name: typeof body.name === "string" && body.name !== "" ? body.name : fallbackName,
    lines: typeof body.lines === "number" ? body.lines : 0,
  };
}

/** move_category_lines returns { move_id, lines }. */
export function readMoved(value: unknown): { moveId: string; lines: number } | null {
  const body = record(value);
  if (typeof body.move_id !== "string") return null;
  return { moveId: body.move_id, lines: typeof body.lines === "number" ? body.lines : 0 };
}
