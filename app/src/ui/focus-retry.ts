import { useLayoutEffect, useRef, type RefObject } from "react";

function focusIsParked(row: HTMLElement): boolean {
  const active = document.activeElement;
  if (active == null || active === document.body || active === document.documentElement) return true;
  return row.contains(active);
}

/**
 * A status that recovers while ניסיון חוזר is focused unmounts that link.
 * A reconnect shows the loading row before the button, so hold the focus
 * until that button is back. The hold ends when focus leaves for a control,
 * a blank spot, or a failed retry, and it never pulls focus off the user.
 */
export function useFocusRowAfterRetry(
  showingRetry: boolean,
  retryRef: RefObject<HTMLElement | null>,
  rowRef: RefObject<HTMLElement | null>,
  rowReady: boolean,
  failureNonce: number,
): void {
  const held = useRef(false);
  const seenFailure = useRef(failureNonce);

  useLayoutEffect(() => {
    if (seenFailure.current === failureNonce) return;
    seenFailure.current = failureNonce;
    held.current = false;
  }, [failureNonce]);

  useLayoutEffect(() => {
    function onFocusIn(event: FocusEvent) {
      if (!held.current) return;
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (target === document.body || target === document.documentElement) return;
      const retry = retryRef.current;
      const row = rowRef.current;
      if (retry?.contains(target)) return;
      if (row?.contains(target)) return;
      held.current = false;
    }
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("focusin", onFocusIn);
    };
  }, [retryRef, rowRef]);

  useLayoutEffect(() => {
    const node = retryRef.current;
    if (node == null) {
      const row = rowRef.current;
      if (held.current && rowReady && row != null) {
        const take = focusIsParked(row);
        held.current = false;
        if (take) row.focus();
      }
      return;
    }
    const link = node;
    function onFocus() {
      held.current = true;
    }
    function onBlur(event: FocusEvent) {
      const next = event.relatedTarget;
      if (next instanceof Node && link.contains(next)) return;
      // Removing the focused link parks focus on the document. A blur while
      // the link is still mounted is the user leaving, including a blank spot.
      if (!link.isConnected) return;
      held.current = false;
    }
    node.addEventListener("focus", onFocus);
    node.addEventListener("blur", onBlur);
    return () => {
      node.removeEventListener("focus", onFocus);
      node.removeEventListener("blur", onBlur);
    };
  }, [showingRetry, rowReady, retryRef, rowRef]);
}
