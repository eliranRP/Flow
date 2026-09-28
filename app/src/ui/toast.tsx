import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
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

const HOLD_MS = 4000;

/** One toast above the tab bar. The host owns the timer and pauses it on hover or focus. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const remaining = useRef(HOLD_MS);
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
      arm(HOLD_MS);
    },
    [arm],
  );

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

  useEffect(() => {
    if (!toast) return;
    const body = document.querySelector("[data-vaul-drawer][data-state='open'] .ui-sheet-body");
    const remember = body?.querySelector(".ui-switch-row");
    if (!(body instanceof HTMLElement) || !(remember instanceof HTMLElement)) return;
    const hidden = remember.getBoundingClientRect().bottom - body.getBoundingClientRect().bottom;
    if (hidden > 0) body.scrollBy({ top: hidden + 8 });
  }, [toast]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      {toast ? (
        <div className="ui-toast-host" onMouseEnter={pause} onMouseLeave={resume} onFocus={pause} onBlur={resume}>
          <Toast tone={toast.tone} action={toast.action} onAction={toast.onAction ? runAction : undefined}>
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
  tone?: "ok" | "bad";
};

export function Toast({ children, action, onAction, tone = "ok" }: ToastProps) {
  return (
    <div className="ui-toast" role="status" dir="rtl">
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
