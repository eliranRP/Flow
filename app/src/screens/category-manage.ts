import { useRef } from "react";
import {
  deletedToast,
  deleteFailureText,
  movedToast,
  moveFailureText,
  RENAME_CATEGORY_SAVED,
  RENAME_CATEGORY_UNDONE,
  renameCategoryFailureText,
  restoreFailureText,
  undoMoveFailureText,
} from "../category-copy";
import { getSupabase } from "../lib/supabase";
import { useToast } from "../ui/toast";
import { assertNoError, useWrite } from "../use-write";

/** FLOW-405 (decision 0144): delete a category with lines and move all its lines, each with a ביטול toast. */

/** Everything a delete or a move changes: the lines go back to review or to another category. */
const CATEGORY_WRITE_KEYS = ["categories", "dashboard", "review", "txn", "project", "project-category", "project-waiting", "breakdown", "breakdown-lines"];

export type CategoryTarget = { id: string; name: string };

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
    onSuccess: ({ from, into }) => {
      const done = moved.current;
      const lines = done?.lines ?? 0;
      toast.show({
        message: movedToast(lines, from.name, into.name),
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

/** FLOW-404: set_category_rehab, with a ביטול toast that puts back the old setting (null is the default). */
export function useCategoryRehab() {
  const toast = useToast();
  const write = useWrite<{ target: CategoryTarget; rehab: boolean | null; before: boolean | null; undo: boolean; counts: boolean }>({
    failure: "לא הצלחנו לעדכן את הקטגוריה.",
    keys: ["categories", "project"],
    onSuccess: (done) => {
      toast.show({
        message: `${done.target.name} · ${done.counts ? "נספרת בשיפוץ" : "לא נספרת בשיפוץ"}`,
        ...(done.undo ? {} : {
          action: "ביטול",
          onAction: () => {
            write.mutate({ ...done, rehab: done.before, before: done.rehab, undo: true, counts: !done.counts });
          },
        }),
      });
    },
    run: async ({ target, rehab }) => {
      const supabase = getSupabase();
      if (!supabase) throw new Error("supabase");
      // The generated type says boolean; null puts the category back on the default (decision 0143).
      assertNoError(await supabase.rpc("set_category_rehab", { p_category_id: target.id, p_rehab: rehab as boolean }));
    },
  });
  return write;
}

type Rename = { id: string; name: string; previous: string };

/** rename_category until database.types.ts carries it (dev lane 1's endpoint). */
async function renameCategory(id: string, name: string): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) throw new Error("supabase");
  const rpc = supabase.rpc.bind(supabase) as unknown as (fn: string, args: Record<string, unknown>) => PromiseLike<{ error: { message: string; code?: string } | null }>;
  assertNoError(await rpc("rename_category", { p_category_id: id, p_name: name }));
}

/** rename_category, then a "השם נשמר" toast whose ביטול writes the old name back. */
export function useRenameCategory(options: { onRenamed?: () => void } = {}) {
  const toast = useToast();
  const undo = useWrite<Rename>({
    failure: renameCategoryFailureText,
    success: RENAME_CATEGORY_UNDONE,
    keys: CATEGORY_WRITE_KEYS,
    run: async ({ id, previous }) => { await renameCategory(id, previous); },
  });
  const saved = useRef<Rename | null>(null);
  const rename = useWrite<Rename>({
    failure: renameCategoryFailureText,
    keys: CATEGORY_WRITE_KEYS,
    // Also runs after a retry from the failure toast, so it reads the last payload.
    onSuccess: () => {
      const done = saved.current;
      if (done == null) return;
      toast.show({ message: RENAME_CATEGORY_SAVED, action: "ביטול", onAction: () => { undo.mutate(done); } });
      options.onRenamed?.();
    },
    run: async (payload) => {
      saved.current = payload;
      await renameCategory(payload.id, payload.name);
    },
  });
  return { rename, undo };
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
