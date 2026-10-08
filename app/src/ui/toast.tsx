import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { CheckIcon, InfoIcon } from "./icons";
import { clearToastPad, cssPx, OK_MS, pinSheetScroll, placeToast, sheetContentKey, sheetSurface, shiftPad, SWIPE_PX, toastAnchor, type ToastInput, toastMs } from "./toast-layout";

// Moved to their own files (FLOW-807). Import from those files in new code.
export { safeTopPx, toastMinBlock, toastAnchor, toastFloor, clearToastPad, placeToast } from "./toast-layout";

type ToastItem = ToastInput & { id: number };

type ToastContextValue = {
  show: (input: ToastInput) => number;
  /** Clears the toast. An id clears that toast only, and leaves a newer one on screen. */
  dismiss: (id?: number) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("ToastProvider is missing");
  return value;
}

/** One toast under the page header. A new show replaces it. The host does not catch taps. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const [phase, setPhase] = useState<"off" | "measure" | "pad" | "fade" | "in">("off");
  const host = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const remaining = useRef(OK_MS);
  const started = useRef(0);
  const acting = useRef(false);
  const toastRef = useRef<ToastItem | null>(null);
  toastRef.current = toast;

  const clearTimer = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const arm = useCallback((ms: number) => {
    clearTimer();
    started.current = Date.now();
    remaining.current = ms;
    timer.current = window.setTimeout(() => {
      setToast(null);
    }, ms);
  }, []);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** A toast that is already on screen is placed in this frame. A new one waits until the sheet shape stops changing, so it is never shown at a position it will leave. */
  const revealNow = useRef(false);

  const show = useCallback(
    (input: ToastInput) => {
      acting.current = false;
      seq.current += 1;
      clearTimer();
      const confirmation = (input.tone == null || input.tone === "ok") && input.place !== "tab" && input.place !== "bar";
      const next = confirmation ? { ...input, place: "page" as const } : input;
      remaining.current = toastMs(next);
      const current = phaseRef.current;
      revealNow.current = current === "pad" || current === "fade" || current === "in";
      if (!revealNow.current) setPhase("measure");
      if (host.current) {
        if (next.place === "page" || next.place === "tab" || next.place === "bar") host.current.dataset.place = next.place;
        else delete host.current.dataset.place;
      }
      const id = seq.current;
      setToast({ ...next, id });
      return id;
    },
    [],
  );

  const dismiss = useCallback((id?: number) => {
    if (id != null && toastRef.current?.id !== id) return;
    acting.current = false;
    clearTimer();
    setPhase("off");
    setToast(null);
  }, []);

  function runAction() {
    if (!toast?.onAction || acting.current) return;
    acting.current = true;
    const action = toast.onAction;
    clearTimer();
    setPhase("off");
    setToast(null);
    action();
  }

  function pause() {
    if (timer.current == null) return;
    remaining.current = Math.max(0, remaining.current - (Date.now() - started.current));
    clearTimer();
  }

  function resume() {
    if (!toast) return;
    arm(remaining.current);
  }

  const visible = phase === "fade" || phase === "in";
  const padToken = useRef(0);
  useEffect(() => {
    if (!toast || !visible) {
      clearTimer();
      return;
    }
    arm(remaining.current);
    return () => {
      clearTimer();
    };
  }, [toast, visible, arm]);

  useLayoutEffect(() => {
    const node = host.current;
    if (!toast || !node) {
      if (node && !toast) delete node.dataset.place;
      if (!toast) {
        // A retry replaces this toast on the next turn. Leave the pad until
        // that turn has had a chance to claim it, so it never eases through 0.
        const token = ++padToken.current;
        const outer = window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (padToken.current !== token || toastRef.current) return;
            clearToastPad();
          });
        });
        return () => {
          window.cancelAnimationFrame(outer);
        };
      }
      return;
    }
    padToken.current += 1;
    const layer = node;
    if (toast.place === "page" || toast.place === "tab" || toast.place === "bar") layer.dataset.place = toast.place;
    else delete layer.dataset.place;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let generation = 0;
    let waiting = false;
    let hold = true;
    let fallback = 0;
    let contentKey = "";
    let removeEnd: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let onViewport: (() => void) | null = null;
    let settling = false;
    let settleFrame = 0;

    function snap() {
      const sheet = toastAnchor(layer).sheet;
      const surface = sheet instanceof Element ? sheetSurface(sheet) : null;
      if (surface) {
        const previous = surface.style.transition;
        surface.style.transition = "none";
        placeToast(layer);
        const _reflow = surface.offsetHeight;
        pinSheetScroll(surface);
        surface.style.transition = previous;
        return;
      }
      placeToast(layer);
    }

    function rememberSheet() {
      const sheet = toastAnchor(layer).sheet;
      contentKey = sheet instanceof Element ? sheetContentKey(sheet) : "";
    }

    function onSheetChange() {
      if (settling) return;
      const sheet = toastAnchor(layer).sheet;
      if (!(sheet instanceof Element)) return;
      const next = sheetContentKey(sheet);
      if (next === contentKey) return;
      const shapeChanged = next.slice(0, next.indexOf("|")) !== contentKey.slice(0, contentKey.indexOf("|"));
      contentKey = next;
      // The saving row settles while the pad owns the layout. That text change
      // must not cancel the padding transition. A shape change (tall to short)
      // places the toast and the pad in the same frame.
      if (!shapeChanged && hold) return;
      snap();
      if (shapeChanged && waiting) finishPad(generation);
    }

    function onViewportChange() {
      if (hold) return;
      snap();
      rememberSheet();
    }

    function watchSheet() {
      const sheet = toastAnchor(layer).sheet;
      if (typeof ResizeObserver !== "undefined" && sheet instanceof Element && !resizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          onSheetChange();
        });
        const head = sheet.querySelector(".ui-sheet-head");
        const body = sheet.querySelector(".ui-sheet-body");
        if (head instanceof Element) resizeObserver.observe(head);
        if (body instanceof Element) resizeObserver.observe(body);
      }
      if (typeof MutationObserver !== "undefined" && sheet instanceof Element && !mutationObserver) {
        mutationObserver = new MutationObserver(() => {
          onSheetChange();
        });
        mutationObserver.observe(sheet, {
          attributes: true,
          attributeFilter: ["class"],
          childList: true,
          subtree: true,
        });
      }
      if (!onViewport) {
        onViewport = () => {
          onViewportChange();
        };
        window.addEventListener("resize", onViewport);
        window.visualViewport?.addEventListener("resize", onViewport);
        window.visualViewport?.addEventListener("scroll", onViewport);
      }
    }

    function release() {
      hold = false;
    }

    function showNow(gen: number) {
      if (gen !== generation) return;
      waiting = false;
      window.clearTimeout(fallback);
      removeEnd?.();
      removeEnd = null;
      setPhase("in");
      release();
    }

    function finishPad(gen: number) {
      if (gen !== generation || !waiting) return;
      waiting = false;
      window.clearTimeout(fallback);
      removeEnd?.();
      removeEnd = null;
      setPhase("fade");
      release();
      const toastEl = layer.querySelector(".ui-toast");
      const onFade = (event: Event) => {
        if (gen !== generation) return;
        if (!(event instanceof TransitionEvent) || event.propertyName !== "opacity") return;
        if (event.target !== toastEl) return;
        toastEl?.removeEventListener("transitionend", onFade);
        showNow(gen);
      };
      requestAnimationFrame(() => {
        if (gen !== generation) return;
        toastEl?.addEventListener("transitionend", onFade);
      });
      fallback = window.setTimeout(() => {
        toastEl?.removeEventListener("transitionend", onFade);
        showNow(gen);
      }, 220);
    }

    function openDrawer(): Element | null {
      return document.querySelector("[data-vaul-drawer][data-state='open']");
    }

    /** A confirmation stays under the header. It stays hidden while the sheet's controls still cross that slot. */
    function toastBlockedByDrawer(): boolean {
      if (layer.dataset.place !== "page") return false;
      const toast = layer.querySelector(".ui-toast");
      const sheet = openDrawer();
      if (!(toast instanceof HTMLElement) || !(sheet instanceof Element)) return false;
      const toastRect = toast.getBoundingClientRect();
      if (toastRect.height === 0) return false;
      const gap = cssPx("--space-2");
      for (const control of sheet.querySelectorAll("button, a[href], input, textarea, select")) {
        if (!(control instanceof HTMLElement)) continue;
        const rect = control.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.top < toastRect.bottom + gap - 1 && rect.bottom > toastRect.top) return true;
      }
      return false;
    }

    function sheetShape(): string {
      const sheet = openDrawer();
      if (!(sheet instanceof Element)) return "none";
      return sheet.classList.contains("ui-sheet-tall") ? "tall" : "fit";
    }

    function commitPlacement(gen: number) {
      if (gen !== generation) return;
      settling = false;
      const sheet = toastAnchor(layer).sheet;
      const surface = sheet instanceof Element ? sheetSurface(sheet) : null;
      const before = surface ? shiftPad(surface) : 0;
      if (surface) surface.style.transition = reduce ? "none" : "";
      placeToast(layer);
      if (surface) {
        const _reflow = surface.offsetHeight;
        pinSheetScroll(surface);
        if (reduce) surface.style.transition = "";
      }
      rememberSheet();
      watchSheet();
      const target = surface ? Number.parseFloat(surface.dataset.toastPad ?? "") || 0 : 0;
      if (!reduce && surface != null && Math.abs(target - before) > 1) {
        waiting = true;
        setPhase("pad");
        const onEnd = (event: Event) => {
          if (gen !== generation || !waiting) return;
          if (!(event instanceof TransitionEvent) || event.propertyName !== "padding-top") return;
          if (event.target !== surface) return;
          finishPad(gen);
        };
        surface.addEventListener("transitionend", onEnd);
        removeEnd = () => {
          surface.removeEventListener("transitionend", onEnd);
        };
        fallback = window.setTimeout(() => {
          finishPad(gen);
        }, 220);
        return;
      }
      showNow(gen);
    }

    function begin() {
      generation += 1;
      const gen = generation;
      waiting = false;
      hold = true;
      window.clearTimeout(fallback);
      removeEnd?.();
      removeEnd = null;
      window.cancelAnimationFrame(settleFrame);
      // A replacement (ניסיון חוזר) is already on screen. Place it in this frame.
      // With no sheet, there is no shape change to wait for. A new toast over a
      // sheet waits until the shape is the same across three frames, so a pick
      // that returns to the summary does not flash the tall position.
      if (revealNow.current || !(openDrawer() instanceof Element)) {
        commitPlacement(gen);
        return;
      }
      if (layer.dataset.place === "page") {
        placeToast(layer);
        const started = performance.now();
        let clear = 0;
        const wait = () => {
          if (gen !== generation) return;
          placeToast(layer);
          if (toastBlockedByDrawer()) clear = 0;
          else clear += 1;
          if (clear >= 2 || performance.now() - started > 700) {
            commitPlacement(gen);
            return;
          }
          settleFrame = requestAnimationFrame(wait);
        };
        settleFrame = requestAnimationFrame(wait);
        return;
      }
      settling = true;
      let previous = "";
      let stable = 0;
      const step = () => {
        if (gen !== generation) return;
        const shape = sheetShape();
        if (shape === previous) stable += 1;
        else {
          previous = shape;
          stable = 0;
        }
        // Two frames in a row. A category pick pops back to the summary on the
        // next frame, and the toast must not paint on the tall sheet first.
        if (stable >= 2) {
          commitPlacement(gen);
          return;
        }
        settleFrame = requestAnimationFrame(step);
      };
      settleFrame = requestAnimationFrame(step);
    }

    begin();

    // A confirmation is placed while the sheet is still closing. Vaul keeps the
    // drawer mounted, and its rect still looks open, until the animation ends.
    // Place again when that drawer closes or leaves, so the toast stays under
    // the header instead of the gap the sheet used to occupy.
    let drawerWatch: MutationObserver | null = null;
    if (layer.dataset.place === "page" && typeof MutationObserver !== "undefined") {
      drawerWatch = new MutationObserver((records) => {
        const drawerMoved = records.some((record) => {
          if (record.type === "attributes" && record.attributeName === "data-state") {
            return record.target instanceof Element && record.target.hasAttribute("data-vaul-drawer");
          }
          return [...record.addedNodes, ...record.removedNodes].some((node) => (
            node instanceof Element
            && (node.hasAttribute("data-vaul-drawer") || node.querySelector("[data-vaul-drawer]") != null)
          ));
        });
        if (drawerMoved) placeToast(layer);
      });
      drawerWatch.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-state"],
      });
    }

    // A bar toast follows the bar: when the bar comes or goes (the last card skipped), place again.
    let floorWatch: MutationObserver | null = null;
    if (layer.dataset.place === "bar" && typeof MutationObserver !== "undefined") {
      floorWatch = new MutationObserver((records) => {
        const floorMoved = records.some((record) => [...record.addedNodes, ...record.removedNodes].some((node) => (
          node instanceof Element
          && (node.hasAttribute("data-toast-floor") || node.querySelector("[data-toast-floor]") != null)
        )));
        if (floorMoved) placeToast(layer);
      });
      floorWatch.observe(document.body, { childList: true, subtree: true });
    }

    return () => {
      floorWatch?.disconnect();
      generation += 1;
      waiting = false;
      hold = true;
      settling = false;
      window.cancelAnimationFrame(settleFrame);
      window.clearTimeout(fallback);
      removeEnd?.();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      drawerWatch?.disconnect();
      if (onViewport) {
        window.removeEventListener("resize", onViewport);
        window.visualViewport?.removeEventListener("resize", onViewport);
        window.visualViewport?.removeEventListener("scroll", onViewport);
      }
      const sheet = toastAnchor(layer).sheet;
      const surface = sheet instanceof Element ? sheetSurface(sheet) : null;
      if (surface) surface.style.transition = "";
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={{ show, dismiss }}>
      {children}
      <div
        className="ui-toast-host"
        data-phase={phase === "off" ? undefined : phase}
        ref={host}
      >
        <Toast
          tone={toast?.tone ?? "ok"}
          action={toast?.action}
          onAction={toast?.onAction ? runAction : undefined}
          onDismiss={toast ? dismiss : undefined}
          onPause={toast ? pause : undefined}
          onResume={toast ? resume : undefined}
        >
          {toast?.message ?? ""}
        </Toast>
      </div>
    </ToastContext.Provider>
  );
}

type ToastProps = {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  tone?: "ok" | "bad" | "info";
};

export function Toast({ children, action, onAction, onDismiss, onPause, onResume, tone = "ok" }: ToastProps) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const hold = useRef({ hover: false, focus: false, press: false });

  function setHold(key: "hover" | "focus" | "press", on: boolean) {
    const before = hold.current.hover || hold.current.focus || hold.current.press;
    hold.current[key] = on;
    const after = hold.current.hover || hold.current.focus || hold.current.press;
    if (!before && after) onPause?.();
    if (before && !after) onResume?.();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // The sheet listens on document. A tap here must not become an outside click.
    event.stopPropagation();
    if (event.pointerType === "mouse" && event.button !== 0) return;
    setHold("press", true);
    start.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = start.current;
    start.current = null;
    if (origin) {
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.hypot(dx, dy) >= SWIPE_PX) {
        swiped.current = true;
        hold.current.press = false;
        onDismiss?.();
        return;
      }
    }
    setHold("press", false);
  }

  function onPointerCancel() {
    start.current = null;
    setHold("press", false);
  }

  const quiet = children == null || children === "";
  return (
    <div
      className={quiet ? "ui-toast-live" : "ui-toast"}
      role="status"
      dir="rtl"
      onMouseEnter={() => { setHold("hover", true); }}
      onMouseLeave={() => { setHold("hover", false); }}
      onFocus={() => { setHold("focus", true); }}
      onBlur={() => { setHold("focus", false); }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={(event) => {
        event.stopPropagation();
        if (swiped.current) {
          swiped.current = false;
          return;
        }
        const node = event.target instanceof Element
          ? event.target
          : event.target instanceof Text
            ? event.target.parentElement
            : null;
        if (node?.closest("button, .ui-toast-action")) return;
        onDismiss?.();
      }}
    >
      {quiet ? null : (
        <>
          <span className={tone === "bad" ? "ui-toast-mark ui-toast-icon ui-toast-bad" : "ui-toast-mark ui-toast-icon"} aria-hidden="true">
            {tone === "ok" ? <CheckIcon size={18} /> : <InfoIcon size={18} />}
          </span>
          <span className="ui-toast-text" dir="rtl">{children}</span>
          {action && onAction ? (
            <button type="button" className="ui-toast-action" aria-label={action} onClick={onAction}>
              {action}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
