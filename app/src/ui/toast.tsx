import type { ReactNode } from "react";

type ToastProps = {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  tone?: "ok" | "bad";
};

/** One confirmation above the tab bar. The caller owns the 4 second timer. */
export function Toast({ children, action, onAction, tone = "ok" }: ToastProps) {
  return (
    <div className="ui-toast" role="status">
      <span className={tone === "bad" ? "ui-toast-bad" : undefined} aria-hidden="true">
        {tone === "bad" ? "i" : "✓"}
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
