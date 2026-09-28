import { useEffect, useRef, useState, type RefObject } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer } from "vaul";
import { CloseIcon } from "./icons";

/**
 * Vaul traps focus, closes on Escape, scrim, and swipe.
 * The sheet is a real route (`/add`, `/review/change`). Opening it pushes
 * history. Closing plays the exit animation, then pops that entry, so the
 * screen underneath is the one that opened the sheet.
 * A direct visit (nothing under it) replaces the route with `closeTo`.
 * `returnFocusRef` points at the + control. Focus returns there after close
 * when that node is still in the document. A direct /add, or a back navigation
 * that left the tab bar, finds it disconnected and skips the focus.
 */
export function Sheet({
  title,
  closeTo,
  hint,
  returnFocusRef,
}: {
  title: string;
  closeTo: string;
  hint?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);
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
    <Drawer.Root
      open={open}
      dismissible
      onOpenChange={(next) => {
        if (!next) setOpen(false);
      }}
      onAnimationEnd={(stillOpen) => {
        if (!stillOpen) leave();
      }}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-scrim" />
        <Drawer.Content
          className="sheet-panel"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            closeRef.current?.focus();
          }}
        >
          <div className="sheet-grab" />
          <div className="sheet-head">
            <Drawer.Title className="t-title-2">{title}</Drawer.Title>
            <Drawer.Close ref={closeRef} className="icon-btn" aria-label="סגירה">
              <CloseIcon />
            </Drawer.Close>
          </div>
          {hint ? <p className="sheet-hint t-label">{hint}</p> : null}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function historyIndex(): number | null {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null || !("idx" in state)) return null;
  const idx = state.idx;
  return typeof idx === "number" ? idx : null;
}
