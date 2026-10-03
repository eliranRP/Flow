import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A status that recovers while ניסיון חוזר is focused unmounts that link.
 * A reconnect shows the loading row before the button, so hold the focus
 * until that button is back. Focus that moved elsewhere stays there.
 */
export function useFocusRowAfterRetry(
  showingRetry: boolean,
  retryRef: RefObject<HTMLElement | null>,
  rowRef: RefObject<HTMLElement | null>,
  rowReady: boolean,
): void {
  const held = useRef(false);
  useLayoutEffect(() => {
    const node = retryRef.current;
    if (node == null) {
      if (held.current && rowReady && rowRef.current != null) {
        held.current = false;
        rowRef.current.focus();
      }
      return;
    }
    function onFocus() {
      held.current = true;
    }
    function onBlur(event: FocusEvent) {
      const next = event.relatedTarget;
      if (next instanceof Node && next !== document.body && next !== document.documentElement) held.current = false;
    }
    node.addEventListener("focus", onFocus);
    node.addEventListener("blur", onBlur);
    return () => {
      node.removeEventListener("focus", onFocus);
      node.removeEventListener("blur", onBlur);
    };
  }, [showingRetry, rowReady, retryRef, rowRef]);
}
