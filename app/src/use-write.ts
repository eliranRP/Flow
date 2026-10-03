import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { useInvalidateBooks } from "./use-books";
import { useToast } from "./ui/toast";

export function assertNoError(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

export type WriteFailure = string | {
  message: string;
  retry?: boolean;
  tone?: "bad" | "info";
  /** A shared-cost refusal offers לחלוקה instead of a retry. */
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
  onSuccess?: () => void;
  /** Where לחלוקה goes when the database refuses one project on a shared cost. */
  onSplit?: () => void;
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
    onSuccess: async () => {
      await invalidate(options.keys);
      if (options.success) toast.show({ message: options.success });
      options.onSuccess?.();
    },
    onError: (error, payload) => {
      const failure = error instanceof Error ? error : new Error("failed");
      const reported = typeof options.failure === "function" ? options.failure(failure) : options.failure;
      const retryable = failureRetries(reported, failure);
      const tone = typeof reported === "string" ? "bad" : (reported.tone ?? "bad");
      const split = typeof reported !== "string" && reported.action != null && options.onSplit != null;
      const id = toast.show({
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
    mutation.mutate(payload);
  };
  return mutation;
}
