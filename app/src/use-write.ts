import { useMutation } from "@tanstack/react-query";
import { useRef } from "react";
import { useInvalidateBooks } from "./use-books";
import { useToast } from "./ui/toast";

export function assertNoError(result: { error: { message: string } | null }): void {
  if (result.error) throw new Error(result.error.message);
}

export type WriteFailure = string | { message: string; retry?: boolean };

/** A database refusal is final. Retry is for a dropped connection or a server error. */
export function isTransientWriteError(error: Error): boolean {
  return /failed to fetch|networkerror|network request failed|load failed|timeout|econnreset|econnrefused|bad gateway|gateway|502|503|504/i.test(error.message);
}

function failureMessage(failure: WriteFailure): string {
  return typeof failure === "string" ? failure : failure.message;
}

function failureRetries(failure: WriteFailure, error: Error): boolean {
  if (typeof failure !== "string" && failure.retry != null) return failure.retry;
  return isTransientWriteError(error);
}

/** A write that checks the PostgREST error, stays busy, and toasts a retry for a transient failure. */
export function useWrite(options: {
  run: () => Promise<void>;
  keys: string[];
  success?: string;
  failure: string | ((error: Error) => WriteFailure);
  onSuccess?: () => void;
}) {
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const retry = useRef<() => void>(() => undefined);
  const mutation = useMutation({
    mutationFn: options.run,
    onSuccess: async () => {
      await invalidate(options.keys);
      if (options.success) toast.show({ message: options.success });
      options.onSuccess?.();
    },
    onError: (error) => {
      const failure = error instanceof Error ? error : new Error("failed");
      const reported = typeof options.failure === "function" ? options.failure(failure) : options.failure;
      const retryable = failureRetries(reported, failure);
      toast.show({
        tone: "bad",
        message: failureMessage(reported),
        ...(retryable ? { action: "ניסיון חוזר", onAction: () => { retry.current(); } } : {}),
      });
    },
  });
  retry.current = () => {
    mutation.mutate();
  };
  return mutation;
}
