import { useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Drawer } from "vaul";
import { CloseIcon } from "./icons";

/**
 * Vaul traps focus, closes on Escape, scrim, and swipe.
 * The sheet is a real route (`/add`, `/review/change`), so opening it already
 * pushes a history entry and the browser back button closes it. Dismissal
 * replaces that entry instead of stacking another one.
 */
export function Sheet({ title, closeTo }: { title: string; closeTo: string }) {
  const navigate = useNavigate();
  const closeRef = useRef<HTMLButtonElement>(null);
  function close() {
    void navigate(closeTo, { replace: true });
  }
  useEffect(() => {
    closeRef.current?.focus();
  }, []);
  return (
    <Drawer.Root
      open
      autoFocus
      dismissible
      onOpenChange={(open) => {
        if (!open) close();
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
            <button
              ref={closeRef}
              type="button"
              className="icon-btn"
              aria-label="סגירה"
              onClick={close}
            >
              <CloseIcon />
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
