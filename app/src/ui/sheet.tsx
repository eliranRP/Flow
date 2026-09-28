import type { ReactNode } from "react";
import { Drawer } from "vaul";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";

export function SheetSurface({
  title,
  children,
  onClose,
  drawer = false,
}: {
  title: string;
  children?: ReactNode;
  onClose?: () => void;
  drawer?: boolean;
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
          <IconButton label="סגירה" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        ) : null}
      </div>
      <div className="stack">{children}</div>
    </div>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  modal = true,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  /** Period stays non-modal so the band figures remain visible while it is open. */
  modal?: boolean;
}) {
  return (
    <Drawer.Root
      open={open}
      dismissible
      modal={modal}
      onOpenChange={onOpenChange}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="sheet-scrim" />
        <Drawer.Content className="sheet-panel" aria-describedby={undefined}>
          <SheetSurface title={title} drawer onClose={() => { onOpenChange(false); }}>
            {children}
          </SheetSurface>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
