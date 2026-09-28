import { useRef, type ReactNode, type RefObject } from "react";
import { Drawer } from "vaul";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";

export function SheetSurface({
  title,
  children,
  hint,
  action,
  onClose,
  drawer = false,
  closeRef,
  titleRef,
}: {
  title: string;
  children?: ReactNode;
  hint?: string;
  /** Stays pinned under the scrolling body. */
  action?: ReactNode;
  onClose?: () => void;
  drawer?: boolean;
  closeRef?: RefObject<HTMLButtonElement | null>;
  titleRef?: RefObject<HTMLHeadingElement | null>;
}) {
  const heading = drawer ? (
    <Drawer.Title ref={titleRef} tabIndex={-1} className="t-title-2">
      {title}
    </Drawer.Title>
  ) : (
    <h2 className="t-title-2">
      {title}
    </h2>
  );
  return (
    <div className="ui-sheet-surface">
      <div className="ui-sheet-grab" />
      <div className="ui-sheet-head">
        {heading}
        {onClose ? (
          <IconButton ref={closeRef} label="סגירה" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        ) : null}
      </div>
      {hint ? <p className="ui-sheet-hint t-label">{hint}</p> : null}
      <div className="ui-sheet-body">{children}</div>
      {action ? <div className="ui-sheet-foot">{action}</div> : null}
    </div>
  );
}

export function Sheet({
  open,
  onOpenChange,
  title,
  children,
  hint,
  action,
  modal = true,
  onClosed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  hint?: string;
  action?: ReactNode;
  /** A modal sheet draws the scrim. Period and range both use that. */
  modal?: boolean;
  /** Fires after the close animation. Route sheets navigate then. */
  onClosed?: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
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
        {modal ? <Drawer.Overlay className="ui-sheet-scrim" /> : null}
        <Drawer.Content
          className="ui-sheet-panel"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus();
          }}
        >
          <SheetSurface
            title={title}
            hint={hint}
            action={action}
            drawer
            closeRef={closeRef}
            titleRef={titleRef}
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
