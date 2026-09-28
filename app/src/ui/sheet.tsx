import { useRef, type ReactNode, type RefObject } from "react";
import { Drawer } from "vaul";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";

export function SheetSurface({
  title,
  children,
  hint,
  onClose,
  drawer = false,
  closeRef,
}: {
  title: string;
  children?: ReactNode;
  hint?: string;
  onClose?: () => void;
  drawer?: boolean;
  closeRef?: RefObject<HTMLButtonElement | null>;
}) {
  const heading = drawer ? (
    <Drawer.Title className="t-title-2">{title}</Drawer.Title>
  ) : (
    <h2 className="t-title-2">{title}</h2>
  );
  return (
    <div className="ui-sheet-surface">
      <div className="sheet-grab" />
      <div className="sheet-head">
        {heading}
        {onClose ? (
          <IconButton ref={closeRef} label="סגירה" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        ) : null}
      </div>
      {hint ? <p className="sheet-hint t-label">{hint}</p> : null}
      <div className="stack">{children}</div>
    </div>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  hint,
  modal = true,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  hint?: string;
  /** Period stays non-modal so the band figures remain visible while it is open. */
  modal?: boolean;
  /** Fires after the close animation. Route sheets navigate then. */
  onClosed?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  return (
    <Drawer.Root
      open={open}
      dismissible
      modal={modal}
      onOpenChange={onOpenChange}
      onAnimationEnd={(stillOpen) => {
        if (!stillOpen) onClosed?.();
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
          <SheetSurface
            title={title}
            hint={hint}
            drawer
            closeRef={closeRef}
            onClose={() => {
              onOpenChange(false);
            }}
          >
            {children}
          </SheetSurface>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
