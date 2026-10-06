import { useEffect, useRef } from "react";
import { useInvalidateBooks } from "./use-books";
import { useToast } from "./ui/toast";

/**
 * `syncing` is the server claim of a running refresh, so a refresh started before a
 * reload or in another tab still shows. When it clears and this tab has no refresh of
 * its own in flight, reload the same books the refresh mutation does and say it
 * finished. A refresh started here toasts from its own mutation instead.
 */
export function useSyncSettled(options: {
  syncing: boolean;
  pending: boolean;
  lastSyncAt: string | null | undefined;
  lastError: string | null | undefined;
  keys: readonly string[];
  success: string;
}): void {
  const { syncing, pending, lastSyncAt, lastError, keys, success } = options;
  const toast = useToast();
  const invalidate = useInvalidateBooks();
  const previous = useRef({ syncing: false, lastSyncAt });
  useEffect(() => {
    const was = previous.current;
    previous.current = { syncing, lastSyncAt };
    if (!was.syncing || syncing || pending) return;
    void invalidate(keys);
    // A run that failed leaves last_error and no new sync time. The sheet shows that error.
    if (lastError == null || lastSyncAt !== was.lastSyncAt) toast.show({ message: success });
  }, [syncing, pending, lastSyncAt, lastError, keys, success, invalidate, toast]);
}
