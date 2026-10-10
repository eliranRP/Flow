import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import type { Drawer as VaulDrawer } from "vaul";
import { cx } from "./cx";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";

type SheetDrawer = { Drawer: typeof VaulDrawer };

// FLOW-815: vaul is not in Home's entry. The first sheet that mounts loads it; until then an open
// sheet renders nothing and opens as soon as it arrives. Tests and Storybook load it up front.
let sheetDrawer: SheetDrawer | null = null;
let sheetDrawerLoad: Promise<SheetDrawer> | null = null;

export function loadSheetDrawer(): Promise<SheetDrawer> {
  sheetDrawerLoad ??= import("./sheet-drawer").then((mod) => {
    sheetDrawer = mod;
    return mod;
  });
  return sheetDrawerLoad;
}

function useSheetDrawer(): SheetDrawer | null {
  const [mod, setMod] = useState(sheetDrawer);
  useEffect(() => {
    if (mod) return;
    let live = true;
    void loadSheetDrawer().then((loaded) => {
      if (live) setMod(loaded);
    });
    return () => {
      live = false;
    };
  }, [mod]);
  return mod;
}

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
  const Title = drawer ? sheetDrawer?.Drawer.Title : undefined;
  const heading = Title ? (
    <Title ref={titleRef} tabIndex={-1} className="ui-focus-title t-title-2" data-clip-ok="">
      {title}
    </Title>
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
const closingPanels = new Set<HTMLElement>();

function syncSheetInert(): void {
  const drawers = [...document.querySelectorAll<HTMLElement>("[data-vaul-drawer]")];
  const interactive = drawers.filter((node) => node.getAttribute("data-state") === "open" && !closingPanels.has(node));
  const top = interactive.length > 0 ? interactive[interactive.length - 1] : undefined;
  for (const node of drawers) {
    if (node === top) node.removeAttribute("inert");
    else if (closingPanels.has(node) || node.getAttribute("data-state") === "open") node.setAttribute("inert", "");
  }
}

/** Draws the focus ring on a control that script focused after a keyboard close, until it blurs. */
export function showRingUntilBlur(el: HTMLElement): void {
  el.setAttribute("data-focus-ring", "");
  el.addEventListener("blur", () => { el.removeAttribute("data-focus-ring"); }, { once: true });
}

export function Sheet({
  open: wanted,
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
  onCloseKind,
  closeOnBackdrop = true,
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
  /** Called just before an accepted close: true when Escape closed it. RouteSheet returns focus itself. */
  onCloseKind?: (byKey: boolean) => void;
  /** A backdrop tap closes the sheet. Step 2 of the one-time code turns this off. */
  closeOnBackdrop?: boolean;
}) {
  const vaul = useSheetDrawer();
  // Until vaul arrives the sheet counts as closed, so its open runs in full once it can draw.
  const open = wanted && vaul != null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const localTitle = useRef<HTMLHeadingElement>(null);
  const titleRef = titleRefProp ?? localTitle;
  const closing = useRef(false);
  const deciding = useRef(false);
  const wasOpen = useRef(false);
  /** The sheet closed from the keyboard (Escape), so the returned focus shows its ring. */
  const keyClose = useRef(false);
  /** Escape was pressed in this task. Vaul's close from that Escape follows in the same task. */
  const escapeNow = useRef(false);
  const opened = useRef(false);
  const closeNotified = useRef(true);
  const onClosedRef = useRef(onClosed);
  onClosedRef.current = onClosed;
  const notifyClosed = () => {
    if (closeNotified.current) return;
    closeNotified.current = true;
    onClosedRef.current?.();
  };
  const notifyRef = useRef(notifyClosed);
  notifyRef.current = notifyClosed;
  useEffect(() => {
    if (open) {
      // A close that reopens before the timer fires still owes its reset.
      if (!closeNotified.current) notifyRef.current();
      opened.current = true;
      return;
    }
    if (!opened.current) return;
    opened.current = false;
    closeNotified.current = false;
    const panel = panelRef.current;
    const onEnd = (event: AnimationEvent) => {
      if (event.target !== panel) return;
      notifyRef.current();
    };
    panel?.addEventListener("animationend", onEnd);
    const timer = window.setTimeout(() => {
      notifyRef.current();
    }, sheetOutMs());
    return () => {
      panel?.removeEventListener("animationend", onEnd);
      window.clearTimeout(timer);
      // Strict mode runs the effect twice. A cancelled close is not finished.
      if (!closeNotified.current) opened.current = true;
    };
  }, [open]);
  const [depth, setDepth] = useState(0);
  useEffect(() => {
    if (open) closing.current = false;
  }, [open]);
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (panel) {
      if (open) closingPanels.delete(panel);
      else {
        closingPanels.add(panel);
        panel.setAttribute("inert", "");
      }
    }
    if (!open) {
      setDepth(0);
      syncSheetInert();
      return () => {
        if (panel) closingPanels.delete(panel);
        queueMicrotask(syncSheetInert);
      };
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
      if (panel) closingPanels.delete(panel);
      const index = openSheetIds.indexOf(id);
      if (index >= 0) openSheetIds.splice(index, 1);
      queueMicrotask(syncSheetInert);
    };
  }, [open]);
  useLayoutEffect(() => {
    if (!returnFocusRef) return;
    if (open) {
      wasOpen.current = true;
      keyClose.current = false;
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
      if (blocked || el?.isConnected !== true) return;
      el.focus();
      // FLOW-310: a focus moved by script after Escape may not match :focus-visible, so the
      // opener would hold focus with no ring. Mark it until it loses focus.
      if (keyClose.current) showRingUntilBlur(el);
    };
    const timer = window.setTimeout(tryFocus, 0);
    return () => {
      window.clearTimeout(timer);
      if (frame !== 0) window.cancelAnimationFrame(frame);
    };
  }, [open, returnFocusRef]);
  async function requestClose(byKey = false) {
    if (closing.current || deciding.current) return;
    deciding.current = true;
    try {
      const verdict = await onBeforeClose?.();
      if (verdict === false) return;
      closing.current = true;
      // Only a close that goes ahead decides the ring; a refused Escape must not mark a later ✕.
      keyClose.current = byKey;
      onCloseKind?.(byKey);
      const accepted = (onOpenChange as (open: boolean) => boolean | undefined)(false);
      // A refused close leaves the sheet open. The flags must not stick.
      if (accepted === false) {
        closing.current = false;
        keyClose.current = false;
      }
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
  if (!vaul) return null;
  const { Drawer } = vaul;
  return (
    <Drawer.Root
      open={open}
      dismissible={closeOnBackdrop}
      modal={modal}
      onOpenChange={(next) => {
        if (!next) void requestClose(escapeNow.current);
        else onOpenChange(true);
      }}
      onAnimationEnd={(stillOpen) => {
        if (!stillOpen) notifyRef.current();
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
            if (!closeOnBackdrop) event.preventDefault();
          }}
          onInteractOutside={(event) => {
            keepOpenForToast(event);
            if (!closeOnBackdrop) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            keepOpenForToast(event);
          }}
          onEscapeKeyDown={(event) => {
            if (onEscape) {
              event.preventDefault();
              onEscape();
              return;
            }
            // Vaul drops every close, including Escape, when dismissible is off.
            if (!closeOnBackdrop) {
              event.preventDefault();
              void requestClose(true);
              return;
            }
            // Vaul closes through onOpenChange(false) in this same task.
            escapeNow.current = true;
            queueMicrotask(() => {
              escapeNow.current = false;
            });
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
