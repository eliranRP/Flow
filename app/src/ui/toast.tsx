import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { CheckIcon, InfoIcon } from "./icons";

type ToastInput = {
  message: string;
  tone?: "ok" | "bad" | "info";
  action?: string;
  onAction?: () => void;
};

type ToastItem = ToastInput & { id: number };

type ToastContextValue = {
  show: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("ToastProvider is missing");
  return value;
}

/** A confirmation leaves on its own. ביטול stays long enough to tap without a hover pause. An error stays long enough to read the retry. */
const OK_MS = 2500;
const ACTION_MS = 5000;
const BAD_MS = 4000;
const SWIPE_PX = 48;

function toastMs(input: ToastInput): number {
  if (input.tone === "bad" || input.tone === "info") return BAD_MS;
  if (input.action && input.onAction) return ACTION_MS;
  return OK_MS;
}

const TOAST_GAP = 8;

/** Sit just under the page or sheet header, inside the viewport, and clear of a control. */
export function placeToast(layer: HTMLElement): void {
  const toast = layer.querySelector(".ui-toast");
  const height = toast instanceof HTMLElement ? toast.getBoundingClientRect().height : 0;
  const sheet = document.querySelector("[data-vaul-drawer][data-state='open']");
  const anchor = sheet?.querySelector(".ui-sheet-hint, .ui-sheet-head")
    ?? document.querySelector("header.ui-page, header.ui-band");
  const safe = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--safe-top")) || 0;
  const measured = anchor instanceof HTMLElement
    ? anchor.getBoundingClientRect().bottom + TOAST_GAP
    : safe + 16;
  const limit = window.innerHeight - height - TOAST_GAP;
  let top = Math.min(Math.max(safe, measured), Math.max(safe, limit));
  const settled = measured <= limit;
  if (settled && toast instanceof HTMLElement && height > 0) {
    const controls = document.querySelectorAll("button, a[href], input, textarea");
    for (const control of controls) {
      if (!(control instanceof HTMLElement) || layer.contains(control)) continue;
      if (sheet instanceof Element && !sheet.contains(control)) continue;
      const rect = control.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const covers = rect.top < top + height && rect.bottom > top;
      if (!covers) continue;
      const below = rect.bottom + TOAST_GAP;
      if (below + height <= window.innerHeight - TOAST_GAP) top = below;
      break;
    }
  }
  layer.style.top = `${String(top)}px`;
}

/** One toast under the page header. A new show replaces it. The host does not catch taps. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const remaining = useRef(OK_MS);
  const started = useRef(0);
  const acting = useRef(false);

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

  const show = useCallback(
    (input: ToastInput) => {
      acting.current = false;
      seq.current += 1;
      setToast({ ...input, id: seq.current });
      arm(toastMs(input));
    },
    [arm],
  );

  const dismiss = useCallback(() => {
    acting.current = false;
    clearTimer();
    setToast(null);
  }, []);

  function runAction() {
    if (!toast?.onAction || acting.current) return;
    acting.current = true;
    const action = toast.onAction;
    clearTimer();
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

  useLayoutEffect(() => {
    const node = host.current;
    if (!toast || !node) return;
    const layer = node;
    const place = () => { placeToast(layer); };
    place();
    const sheet = document.querySelector("[data-vaul-drawer][data-state='open']");
    const anchor = sheet?.querySelector(".ui-sheet-hint, .ui-sheet-head")
      ?? document.querySelector("header.ui-page, header.ui-band");
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(place);
      if (sheet instanceof Element) observer.observe(sheet);
      if (anchor instanceof Element) observer.observe(anchor);
    }
    sheet?.addEventListener("transitionend", place);
    const timers = [50, 150, 320, 500].map((ms) => window.setTimeout(place, ms));
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      sheet?.removeEventListener("transitionend", place);
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("resize", place);
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="ui-toast-host" ref={host}>
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

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    start.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    if (!start.current) return;
    const dx = event.clientX - start.current.x;
    const dy = event.clientY - start.current.y;
    start.current = null;
    if (Math.hypot(dx, dy) < SWIPE_PX) return;
    swiped.current = true;
    onDismiss?.();
  }

  const quiet = children == null || children === "";
  return (
    <div
      className={quiet ? "ui-toast-live" : "ui-toast"}
      role="status"
      dir="rtl"
      onMouseEnter={onPause}
      onMouseLeave={onResume}
      onFocus={onPause}
      onBlur={onResume}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onClick={(event) => {
        if (swiped.current) {
          swiped.current = false;
          return;
        }
        if (event.target instanceof Element && event.target.closest("button")) return;
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
            <button type="button" aria-label={action} onClick={onAction}>
              {action}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
