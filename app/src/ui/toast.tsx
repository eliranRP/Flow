import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { CheckIcon, InfoIcon } from "./icons";

type ToastInput = {
  message: string;
  tone?: "ok" | "bad";
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

/** A confirmation leaves on its own. An error stays long enough to read the retry. */
const OK_MS = 2500;
const BAD_MS = 4000;
const SWIPE_PX = 48;

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
      arm(input.tone === "bad" ? BAD_MS : OK_MS);
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
    function place() {
      const sheet = document.querySelector("[data-vaul-drawer][data-state='open']");
      const anchor = sheet?.querySelector(".ui-sheet-hint, .ui-sheet-head")
        ?? document.querySelector("header.ui-page, header.ui-band");
      if (!(anchor instanceof HTMLElement)) {
        layer.style.removeProperty("top");
        return;
      }
      const gap = 8;
      layer.style.top = `${Math.max(0, anchor.getBoundingClientRect().bottom + gap)}px`;
    }
    place();
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("resize", place);
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <div className="ui-toast-host" ref={host}>
          <Toast
            tone={toast.tone}
            action={toast.action}
            onAction={toast.onAction ? runAction : undefined}
            onDismiss={dismiss}
            onPause={pause}
            onResume={resume}
          >
            {toast.message}
          </Toast>
        </div>
      ) : null}
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
  tone?: "ok" | "bad";
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

  return (
    <div
      className="ui-toast"
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
      <span className={tone === "bad" ? "ui-toast-mark ui-toast-icon ui-toast-bad" : "ui-toast-mark ui-toast-icon"} aria-hidden="true">
        {tone === "bad" ? <InfoIcon size={18} /> : <CheckIcon size={18} />}
      </span>
      <span className="ui-toast-text" dir="rtl">{children}</span>
      {action && onAction ? (
        <button type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
