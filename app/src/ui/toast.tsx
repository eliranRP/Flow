import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from "react";

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
    <div className="ui-toast" role="status">
      <span className={tone === "bad" ? "ui-toast-bad" : undefined} aria-hidden="true">
        {tone === "bad" ? "!" : "✓"}
      </span>
      <span>{children}</span>
      {action && onAction ? (
        <button type="button" onClick={onAction}>
          {action}
        </button>
      ) : null}
    </div>
  );
}
