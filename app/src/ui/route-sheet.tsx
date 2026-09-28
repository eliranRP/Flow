import { useEffect, useState, type ReactNode, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { Sheet } from "./sheet";

/**
 * The sheet is a real route (`/add`, `/review/change`). Opening it pushes
 * history. Closing plays the exit animation, then pops that entry, so the
 * screen underneath is the one that opened the sheet.
 */
export function RouteSheet({
  title,
  closeTo,
  hint,
  action,
  returnFocusRef,
  children,
}: {
  title: string;
  closeTo: string;
  hint?: string;
  action?: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children?: ReactNode;
}) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(true);

  useEffect(() => {
    const ref = returnFocusRef;
    return () => {
      if (!ref) return;
      window.setTimeout(() => {
        if (document.querySelector('[role="dialog"]')) return;
        const el = ref.current;
        if (el?.isConnected) el.focus();
      }, 0);
    };
  }, [returnFocusRef]);

  function leave() {
    const idx = historyIndex();
    if (idx != null && idx > 0) {
      void navigate(-1);
      return;
    }
    void navigate(closeTo, { replace: true });
  }

  return (
    <Sheet
      open={open}
      title={title}
      hint={hint}
      action={action}
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      onClosed={leave}
    >
      {children}
    </Sheet>
  );
}

function historyIndex(): number | null {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null || !("idx" in state)) return null;
  const idx = state.idx;
  return typeof idx === "number" ? idx : null;
}
