import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
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
    <Drawer.Title ref={titleRef} tabIndex={-1} className="ui-focus-title t-title-2" data-clip-ok="">
      {title}
    </Drawer.Title>
  ) : (
    <h2 className="t-title-2" data-clip-ok="">
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

function sheetOutMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--dur-sheet-out").trim();
  if (raw.endsWith("ms")) return Number.parseFloat(raw);
  if (raw.endsWith("s")) return Number.parseFloat(raw) * 1000;
  return 220;
}

const openSheetIds: number[] = [];
let nextSheetId = 1;

function syncSheetInert(): void {
  const drawers = [...document.querySelectorAll<HTMLElement>("[data-vaul-drawer][data-state=\"open\"]")];
  drawers.forEach((node, index) => {
    if (index < drawers.length - 1) node.setAttribute("inert", "");
    else node.removeAttribute("inert");
  });
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
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const localTitle = useRef<HTMLHeadingElement>(null);
  const titleRef = titleRefProp ?? localTitle;
  const closing = useRef(false);
  const deciding = useRef(false);
  const wasOpen = useRef(false);
  const opened = useRef(false);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  useEffect(() => {
    if (open) {
      opened.current = true;
      return;
    }
    if (!opened.current) return;
    opened.current = false;
    let fired = false;
    const finish = () => {
      if (fired) return;
      fired = true;
      onClosedRef.current?.();
    };
    const panel = panelRef.current;
    const onEnd = (event: AnimationEvent) => {
      if (event.target !== panel) return;
      finish();
    };
    panel?.addEventListener("animationend", onEnd);
    const timer = window.setTimeout(finish, sheetOutMs());
    return () => {
      panel?.removeEventListener("animationend", onEnd);
      window.clearTimeout(timer);
      // Strict mode runs the effect twice. A cancelled close is not finished.
      if (!fired) opened.current = true;
    };
  }, [open]);
  const [depth, setDepth] = useState(0);
  useEffect(() => {
    if (open) closing.current = false;
  }, [open]);
  useLayoutEffect(() => {
    if (!open) {
      setDepth(0);
      return;
    }
    const id = nextSheetId;
    nextSheetId += 1;
    openSheetIds.push(id);
    const mine = openSheetIds.length;
    setDepth(mine);
    const panelZ = String(31 + (mine - 1) * 2);
    const scrimZ = String(30 + (mine - 1) * 2);
    if (panelRef.current) panelRef.current.style.zIndex = panelZ;
    if (scrimRef.current) scrimRef.current.style.zIndex = scrimZ;
    syncSheetInert();
    const frame = window.requestAnimationFrame(syncSheetInert);
    return () => {
      window.cancelAnimationFrame(frame);
      const index = openSheetIds.indexOf(id);
      if (index >= 0) openSheetIds.splice(index, 1);
      queueMicrotask(syncSheetInert);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!returnFocusRef) return;
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    const active = document.activeElement;
    const panel = panelRef.current;
    const fromBody = active == null || active === document.body || active === document.documentElement;
    const fromSheet = panel != null && active instanceof Node && panel.contains(active);
    // Leave focus where the user moved it. Restore only from the page or this sheet.
    if (!fromBody && !fromSheet) {
      wasOpen.current = false;
      return;
    }
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
      const accepted = (onOpenChange as (open: boolean) => boolean | undefined)(false);
      // A refused close leaves the sheet open. The flag must not stick.
      if (accepted === false) closing.current = false;
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
        {modal ? (
          <Drawer.Overlay
            ref={scrimRef}
            className="ui-sheet-scrim"
            style={depth > 0 ? { zIndex: 30 + (depth - 1) * 2 } : undefined}
          />
        ) : null}
        <Drawer.Content
          ref={panelRef}
          style={depth > 0 ? { zIndex: 31 + (depth - 1) * 2 } : undefined}
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
