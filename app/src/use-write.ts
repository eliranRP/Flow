import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { useInvalidateBooks } from "./use-books";
import { useToast } from "./ui/toast";

export function assertNoError(result: { error: { message: string; code?: string } | null }): void {
  if (!result.error) return;
  const error = new Error(result.error.message);
  if (result.error.code) Object.assign(error, { code: result.error.code });
  throw error;
}

export type WriteFailure = string | {
  message: string;
  retry?: boolean;
  tone?: "bad" | "info";
  /** A shared-cost refusal offers לפיצול instead of a retry. */
  action?: string;
};

/** A database refusal is final. Retry is for a dropped connection or a server error. */
export function isTransientWriteError(error: Error): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|timeout|econnreset|econnrefused|bad gateway|gateway|internal server error|\b500\b|\b502\b|\b503\b|\b504\b/i.test(error.message);
}

function failureMessage(failure: WriteFailure): string {
  return typeof failure === "string" ? failure : failure.message;
}

function failureRetries(failure: WriteFailure, error: Error): boolean {
  if (typeof failure !== "string" && failure.retry != null) return failure.retry;
  return isTransientWriteError(error);
}

/** A write that checks the PostgREST error, stays busy, and toasts a retry for a transient failure. */
export function useWrite<T = void>(options: {
  run: (payload: T) => Promise<void>;
  keys: string[];
  success?: string;
  failure: string | ((error: Error) => WriteFailure);
  onSuccess?: (payload: T) => void;
  /** Where לפיצול goes when the database refuses one project on a shared cost. */
  onSplit?: () => void;
  /** Runs before a retry, while the toast action is still focused. */
  retryFocus?: () => void;
  /** An error that needs no toast, because the screen already shows the state. */
  silent?: (error: Error) => boolean;
  /** Where this write's toasts sit. לאישור keeps them above its action bar (decision 0137). */
  place?: "page" | "tab" | "bar";
}) {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const retry = useRef<(payload: T) => void>(() => undefined);
  const retryToast = useRef<number | null>(null);
  const mutation = useMutation({
    mutationFn: (payload: T) => options.run(payload),
    onMutate: () => {
      const id = retryToast.current;
      if (id == null) return;
      retryToast.current = null;
      toast.dismiss(id);
    },
    onSuccess: async (_data, payload) => {
      await invalidate(options.keys);
      if (options.success) toast.show({ message: options.success, ...(options.place ? { place: options.place } : {}) });
      options.onSuccess?.(payload);
    },
    onError: (error, payload) => {
      const failure = error instanceof Error ? error : new Error("failed");
      if (options.silent?.(failure) === true) return;
      const reported = typeof options.failure === "function" ? options.failure(failure) : options.failure;
      const retryable = failureRetries(reported, failure);
      const tone = typeof reported === "string" ? "bad" : (reported.tone ?? "bad");
      const split = typeof reported !== "string" && reported.action != null && options.onSplit != null;
      const id = toast.show({
        ...(options.place ? { place: options.place } : {}),
        tone,
        message: failureMessage(reported),
        ...(split
          ? { action: reported.action, onAction: () => { options.onSplit?.(); } }
          : retryable
            ? { action: "ניסיון חוזר", onAction: () => { retry.current(payload); } }
            : {}),
      });
      if (retryable && !split) retryToast.current = id;
    },
  });
  retry.current = (payload) => {
    if (mutation.isPending) return;
    options.retryFocus?.();
    mutation.mutate(payload);
  };
  return mutation;
}
