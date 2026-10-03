import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import { Drawer } from "vaul";
import { cx } from "./cx";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";

export function SheetSurface({
  title,
  children,
  hint,
  action,
  leading,
  onClose,
  drawer = false,
  closeRef,
  titleRef,
  footClassName,
}: {
  title: string;
  children?: ReactNode;
  hint?: string;
  /** Stays pinned under the scrolling body. */
  action?: ReactNode;
  /** Inline-start control. The change picker uses it for back. */
  leading?: ReactNode;
  onClose?: () => void;
  drawer?: boolean;
  closeRef?: RefObject<HTMLButtonElement | null>;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  footClassName?: string;
}) {
  const heading = drawer ? (
    <Drawer.Title ref={titleRef} tabIndex={-1} className="ui-focus-title t-title-2">
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
        {leading}
        {heading}
        {onClose ? (
          <IconButton ref={closeRef} label="סגירה" onClick={onClose}>
            <CloseIcon />
          </IconButton>
        ) : null}
      </div>
      {hint ? <p className="ui-sheet-hint t-label">{hint}</p> : null}
      <div className="ui-sheet-body">{children}</div>
      {action ? <div className={cx("ui-sheet-foot", footClassName)}>{action}</div> : null}
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
  leading,
  modal = true,
  onClosed,
  panelClassName,
  footClassName,
  titleRef: titleRefProp,
  onEscape,
  onBeforeClose,
  onRequestClose,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children?: ReactNode;
  hint?: string;
  action?: ReactNode;
  leading?: ReactNode;
  /** A modal sheet draws the scrim. Period and range both use that. */
  modal?: boolean;
  /** Fires after the close animation. Route sheets navigate then. */
  onClosed?: () => void;
  panelClassName?: string;
  footClassName?: string;
  titleRef?: RefObject<HTMLHeadingElement | null>;
  /** When set, Escape stays in the sheet and runs this instead of closing. */
  onEscape?: () => void;
  /**
   * Runs when the sheet starts to close. Return false to stay open.
   * Picker history is dropped here, after a pending edit has been saved.
   */
  onBeforeClose?: () => undefined | boolean | Promise<undefined | boolean>;
  /** The sheet's own close. Callers use this instead of the first dialog's ✕. */
  onRequestClose?: RefObject<(() => void) | null>;
  /** ✕ and Escape put focus back on the control that opened the sheet. */
  returnFocusRef?: RefObject<HTMLElement | null>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const localTitle = useRef<HTMLHeadingElement>(null);
  const titleRef = titleRefProp ?? localTitle;
  const closing = useRef(false);
  const deciding = useRef(false);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) closing.current = false;
  }, [open]);
  useEffect(() => {
    if (!returnFocusRef) return;
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    const ref = returnFocusRef;
    const started = performance.now();
    let frame = 0;
    const tryFocus = () => {
      const el = ref.current;
      const dialogs = [...document.querySelectorAll("[role=\"dialog\"]")];
      const blocked = dialogs.some((dialog) => el == null || !dialog.contains(el));
      // Vaul removes the dialog on a 500ms timer, after the close animation.
      if (blocked && performance.now() - started < 800) {
        frame = window.requestAnimationFrame(tryFocus);
        return;
      }
      wasOpen.current = false;
      if (!blocked && el?.isConnected) el.focus();
    };
    const timer = window.setTimeout(tryFocus, 0);
    return () => {
      window.clearTimeout(timer);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [open, returnFocusRef]);
  async function requestClose() {
    if (closing.current || deciding.current) return;
    deciding.current = true;
    try {
      const verdict = await onBeforeClose?.();
      if (verdict === false) return;
      closing.current = true;
      onOpenChange(false);
    } finally {
      deciding.current = false;
    }
  }
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    if (!onRequestClose) return;
    onRequestClose.current = () => {
      void requestCloseRef.current();
    };
    return () => {
      onRequestClose.current = null;
    };
  });
  function keepOpenForToast(event: { preventDefault: () => void; target: EventTarget | null; detail?: { originalEvent?: { target: EventTarget | null } } }) {
    const nodes = [event.target, event.detail?.originalEvent?.target];
    const onToast = nodes.some((node) => {
      const element = node instanceof Element ? node : node instanceof Text ? node.parentElement : null;
      return element?.closest(".ui-toast, .ui-toast-host") != null;
    });
    if (onToast) event.preventDefault();
  }
  return (
    <Drawer.Root
      open={open}
      dismissible
      modal={modal}
      onOpenChange={(next) => {
        if (!next) void requestClose();
        else onOpenChange(true);
      }}
      onAnimationEnd={(stillOpen) => {
        if (!stillOpen) onClosed?.();
      }}
    >
      <Drawer.Portal>
        {modal ? <Drawer.Overlay className="ui-sheet-scrim" /> : null}
        <Drawer.Content
          className={cx("ui-sheet-panel", panelClassName)}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus({ preventScroll: true });
          }}
          onPointerDownOutside={(event) => {
            keepOpenForToast(event);
          }}
          onInteractOutside={(event) => {
            keepOpenForToast(event);
          }}
          onFocusOutside={(event) => {
            keepOpenForToast(event);
          }}
          onEscapeKeyDown={(event) => {
            if (!onEscape) return;
            event.preventDefault();
            onEscape();
          }}
        >
          <SheetSurface
            title={title}
            hint={hint}
            action={action}
            leading={leading}
            drawer
            closeRef={closeRef}
            titleRef={titleRef}
            footClassName={footClassName}
            onClose={() => {
              void requestClose();
            }}
          >
            {children}
          </SheetSurface>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
