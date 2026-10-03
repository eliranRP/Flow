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
    // A failed retry leaves the link mounted and focused, so no new focus
    // event arrives. Hold again while focus is still on that link.
    const retry = retryRef.current;
    const active = document.activeElement;
    if (retry != null && active instanceof Node && retry.contains(active)) held.current = true;
  }, [failureNonce, retryRef]);

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
      // Chrome fires this blur while React 19 is removing the focused link,
      // and the link is still connected. Decide after that removal. A blur
      // that leaves the link mounted — a blank spot, or Tab — still disarms.
      queueMicrotask(() => {
        if (link.isConnected) held.current = false;
      });
    }
    node.addEventListener("focus", onFocus);
    node.addEventListener("blur", onBlur);
    return () => {
      node.removeEventListener("focus", onFocus);
      node.removeEventListener("blur", onBlur);
    };
  }, [showingRetry, rowReady, retryRef, rowRef]);
}
