import { useMemo } from "react";
import { useToast } from "./toast";
import type { ToastInput } from "./toast-layout";

/** Decision 0222 (after 0212): a toast under the header keeps its ביטול 5s and a plain note 4s. */
export const TOP_UNDO_MS = 5000;
const TOP_NOTE_MS = 4000;

/** A toast under the header (decision 0222): the undo 5s and a note 4s. */
export function topToast(input: ToastInput): ToastInput {
  return { durationMs: input.action == null ? TOP_NOTE_MS : TOP_UNDO_MS, ...input, place: "top" };
}

/** The toasts of a screen whose every toast sits under its header (the settings pages, FLOW-972). */
export function useTopToast(): ReturnType<typeof useToast> {
  const toast = useToast();
  return useMemo(() => ({ ...toast, show: (input: ToastInput) => toast.show(topToast(input)) }), [toast]);
}
