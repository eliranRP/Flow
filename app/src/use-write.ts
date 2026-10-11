import { type MutationOptions, type QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { MY_COMPANIES_KEY, VIEWER_NOTE } from "./company-role-cache";
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

/**
 * The server refused because this user may not write the company shown (decision 0167). The books'
 * write RPCs say "no company" when the user only reads it: a viewer, or one the app still took for
 * an owner because it read the role before an invite made them a viewer.
 */
export function isReadOnlyRefusal(error: Error): boolean {
  return error.message.trim() === "no company";
}

/** Any refusal of this user's role. The screen's own copy still words a "forbidden". */
function isRoleRefusal(error: Error): boolean {
  return isReadOnlyRefusal(error) || (error as Error & { code?: unknown }).code === "42501" || error.message.trim() === "forbidden";
}

function failureMessage(failure: WriteFailure): string {
  return typeof failure === "string" ? failure : failure.message;
}

function failureRetries(failure: WriteFailure, error: Error): boolean {
  if (typeof failure !== "string" && failure.retry != null) return failure.retry;
  return isTransientWriteError(error);
}

/** A query the write changed, with the value it held before, so a failure can put it back. */
type Snapshot = { key: QueryKey; before: unknown };

/** A write that checks the PostgREST error, stays busy, and toasts a retry for a transient failure. */
export function useWrite<T = void>(options: {
  run: (payload: T) => Promise<void>;
  keys: string[];
  /** A function reads the toast after the write, so it can say what the write returned. */
  success?: string | (() => string);
  failure: string | ((error: Error) => WriteFailure);
  onSuccess?: (payload: T) => void;
  /** Runs on every failure, a toast retry's included, before the toast. */
  onError?: (error: Error, payload: T) => void;
  /** Where לפיצול goes when the database refuses one project on a shared cost. */
  onSplit?: () => void;
  /** Runs before a retry, while the toast action is still focused. */
  retryFocus?: () => void;
  /** An error that needs no toast, because the screen already shows the state. */
  silent?: (error: Error) => boolean;
  /** Where this write's toasts sit. לאישור keeps them above its action bar (decision 0137). */
  place?: "page" | "tab" | "bar";
  /** The queries the write changes and each one's value after it. The tap shows it at once; a failure restores it. */
  optimistic?: (payload: T) => Array<{ key: QueryKey; update: (old: unknown) => unknown }>;
}) {
  const toast = useToast();
  const client = useQueryClient();
  const invalidate = useInvalidateBooks();
  const retry = useRef<(payload: T) => void>(() => undefined);
  const retryToast = useRef<number | null>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  const mutationOptions: MutationOptions<void, Error, T, Snapshot[]> = {
    mutationFn: (payload: T) => options.run(payload),
    onMutate: async (payload) => {
      const id = retryToast.current;
      if (id != null) {
        retryToast.current = null;
        toast.dismiss(id);
      }
      if (!options.optimistic) return [];
      const updates = options.optimistic(payload);
      await Promise.all(updates.map(({ key }) => client.cancelQueries({ queryKey: key })));
      return updates.map(({ key, update }) => {
        const before = client.getQueryData(key);
        client.setQueryData(key, update);
        return { key, before };
      });
    },
    onSuccess: async (_data, payload, snapshots) => {
      if (options.optimistic) {
        // The tapped result is already drawn; the refresh only corrects it, so it runs behind the toast.
        void invalidate(options.keys);
        for (const { key } of snapshots) void client.invalidateQueries({ queryKey: key });
      } else {
        await invalidate(options.keys);
      }
      const success = typeof options.success === "function" ? options.success() : options.success;
      if (success) toast.show({ message: success, ...(options.place ? { place: options.place } : {}) });
      options.onSuccess?.(payload);
    },
    onError: (error, payload, snapshots) => {
      const failure = error instanceof Error ? error : new Error("failed");
      for (const { key, before } of snapshots ?? []) {
        client.setQueryData(key, before);
        void client.invalidateQueries({ queryKey: key });
      }
      options.onError?.(failure, payload);
      // Read the role again, so the screen drops the controls this user cannot use.
      if (isRoleRefusal(failure)) void client.invalidateQueries({ queryKey: [MY_COMPANIES_KEY] });
      if (options.silent?.(failure) === true) return;
      if (isReadOnlyRefusal(failure)) {
        toast.show({ ...(options.place ? { place: options.place } : {}), tone: "info", message: VIEWER_NOTE });
        return;
      }
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
  };
  const mutation = useMutation(mutationOptions);
  retry.current = (payload) => {
    // After unmount, isPending is the last render's value and can be stale, so only a mounted screen checks it.
    if (mounted.current && mutation.isPending) return;
    options.retryFocus?.();
    mutation.mutate(payload);
  };
  return mutation;
}
