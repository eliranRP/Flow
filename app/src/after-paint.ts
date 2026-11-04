import { useEffect, useState } from "react";

/**
 * FLOW-1019 (owner, 2026-11-03: the forecast loads after Home first appears): true from the browser's first idle
 * moment after `shown` turns true, so reads that can wait start once the screen has drawn, not alongside the
 * reads it draws from. Stays true after that. No idle callback (Safari): the next task after a frame.
 */
export function useAfterFirstPaint(shown: boolean): boolean {
  const [after, setAfter] = useState(false);
  useEffect(() => {
    if (!shown || after) return;
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => {
        setAfter(true);
      }, { timeout: 1500 });
      return () => {
        window.cancelIdleCallback(id);
      };
    }
    let timer: number | undefined;
    const frame = window.requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        setAfter(true);
      }, 0);
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (timer != null) window.clearTimeout(timer);
    };
  }, [shown, after]);
  return after;
}
