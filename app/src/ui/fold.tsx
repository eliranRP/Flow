import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { cx } from "./cx";

/** The v3 row-card fold (HANDOFF §2): the slide and the max-height fold over --motion-sheet-out (220ms), with a frame to spare. */
export const FOLD_MS = 240;

function reducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * FLOW-1141: the rows folding away, shared by the attention row-cards and the utility refunds list. `fold(id)`
 * marks a row leaving and resolves true once its fold ends (at once under reduced motion); `then` runs at that
 * moment, in the same task. `cancel(id)` stops it (ביטול mid-fold), and its fold resolves false. Unmounting stops
 * every fold.
 */
export function useFold(): {
  leaving: ReadonlySet<string>;
  fold: (id: string, then?: () => void) => Promise<boolean>;
  cancel: (id: string) => void;
} {
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(() => new Set());
  const timers = useRef(new Map<string, { timer: ReturnType<typeof setTimeout>; done: (folded: boolean) => void }>());
  const drop = useCallback((id: string) => {
    setLeaving((current) => {
      if (!current.has(id)) return current;
      const rest = new Set(current);
      rest.delete(id);
      return rest;
    });
  }, []);
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const { timer, done } of pending.values()) {
        clearTimeout(timer);
        done(false);
      }
      pending.clear();
    };
  }, []);
  const cancel = useCallback((id: string) => {
    const running = timers.current.get(id);
    if (running != null) {
      clearTimeout(running.timer);
      timers.current.delete(id);
      running.done(false);
    }
    drop(id);
  }, [drop]);
  const fold = useCallback((id: string, then?: () => void) => {
    if (reducedMotion()) {
      then?.();
      return Promise.resolve(true);
    }
    const prior = timers.current.get(id);
    if (prior != null) {
      clearTimeout(prior.timer);
      prior.done(false);
    }
    setLeaving((current) => new Set(current).add(id));
    return new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => {
        timers.current.delete(id);
        then?.();
        drop(id);
        resolve(true);
      }, FOLD_MS);
      timers.current.set(id, { timer, done: resolve });
    });
  }, [drop]);
  return { leaving, fold, cancel };
}

/**
 * A list item that folds away while `leaving`: it slides toward its end (the ✓ or the X) and folds from its own
 * height to none (63-attention-cards.css, `.ui-fold`). Its height is measured when the fold starts, so a row that
 * wraps at 320 folds from where it is. Inert while it leaves.
 */
export function FoldItem({ leaving, as = "li", className, children }: { leaving: boolean; as?: "li" | "div"; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLLIElement & HTMLDivElement>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (node == null) return;
    if (!leaving) {
      node.removeAttribute("data-leaving");
      node.style.maxBlockSize = "";
      return;
    }
    // From its own height, then to none, with a layout read between, so max-height has a start to move from.
    node.style.maxBlockSize = `${String(node.scrollHeight)}px`;
    node.getBoundingClientRect();
    node.setAttribute("data-leaving", "");
    node.style.maxBlockSize = "0px";
  }, [leaving]);
  const Tag = as;
  return <Tag ref={ref} className={cx("ui-fold", className)} inert={leaving || undefined}>{children}</Tag>;
}
