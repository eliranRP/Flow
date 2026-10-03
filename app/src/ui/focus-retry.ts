import { useLayoutEffect, useRef, type RefObject } from "react";

/**
 * A status that recovers while ניסיון חוזר is focused unmounts that link and
 * drops focus on the document. Put it on the row instead.
 */
export function useFocusRowAfterRetry(
  showingRetry: boolean,
  retryRef: RefObject<HTMLElement | null>,
  rowRef: RefObject<HTMLElement | null>,
): void {
  const held = useRef(false);
  useLayoutEffect(() => {
    const node = retryRef.current;
    if (node == null) {
      if (held.current) {
        held.current = false;
        rowRef.current?.focus();
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
  }, [showingRetry, retryRef, rowRef]);
}
