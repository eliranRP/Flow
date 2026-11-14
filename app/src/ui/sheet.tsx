import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { defineMachine } from "@flow/shared";
import type { Drawer as VaulDrawer } from "vaul";
import { useMachine } from "../use-machine";
import { cx } from "./cx";
import { IconButton } from "./icon-button";
import { CloseIcon } from "./icons";

type SheetDrawer = { Drawer: typeof VaulDrawer };

// FLOW-815: vaul is not in Home's entry. The first sheet that mounts loads it; until then an open
// sheet renders nothing and opens as soon as it arrives. Tests and Storybook load it up front.
let sheetDrawer: SheetDrawer | null = null;
let sheetDrawerLoad: Promise<SheetDrawer> | null = null;

/** Storybook hands over a static import, so a story never waits on (or re-fetches) the chunk. */
export function primeSheetDrawer(mod: SheetDrawer): void {
  sheetDrawer = mod;
  sheetDrawerLoad = Promise.resolve(mod);
}

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
  subtitle,
  children,
  hint,
  action,
  leading,
  onClose,
  drawer = false,
  closeRef,
  titleRef,
  footClassName,
  busy = false,
  closeButton = true,
  aside,
}: {
  title: string;
  /** Under the title, in the title's column (FLOW-372: the board's "רק בטלפון הזה"). */
  subtitle?: string;
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
  /** A save is in flight: no ✕ (the board's saving frame). */
  busy?: boolean;
  /** Off where the sheet has its own way out (the setup skip sheet draws none). */
  closeButton?: boolean;
  /** At the end of the head, on the title's line (the rehab sheet's total). */
  aside?: ReactNode;
}) {
  const Title = drawer ? sheetDrawer?.Drawer.Title : undefined;
  const heading0 = Title ? (
    <Title ref={titleRef} tabIndex={-1} className="ui-focus-title t-sheet ui-sheet-title" data-clip-ok="">
      {title}
    </Title>
  ) : (
    <h2 className="t-sheet ui-sheet-title" data-clip-ok="">
      {title}
    </h2>
  );
  // A sheet without a subtitle keeps its one-title head; with one, the title and subtitle share a column.
  const heading = subtitle ? (
    <div className="ui-sheet-titles">
      {heading0}
      <span className="ui-sheet-subtitle t-caption t-muted">{subtitle}</span>
    </div>
  ) : heading0;
  return (
    <div className="ui-sheet-surface">
      <div className="ui-sheet-grab" />
      <div className="ui-sheet-head">
        {leading}
        {heading}
        {aside}
        {onClose && closeButton && !busy ? (
          <IconButton ref={closeRef} label="סגירה" onClick={onClose}>
            <CloseIcon size={22} />
          </IconButton>
        ) : null}
      </div>
      {hint ? <p className="ui-sheet-hint t-line2">{hint}</p> : null}
      <div className="ui-sheet-body">{children}</div>
      {action ? <div className={cx("ui-sheet-foot", footClassName)}>{action}</div> : null}
    </div>
  );
}

function sheetOutMs(): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--motion-sheet-out").trim();
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

/**
 * How long after an allowed close a new ✕, Escape, scrim tap or `onRequestClose` counts as the same
 * close. It must exceed an async parent's close, such as a history pop (`useSheetHistory` drops
 * `open` only on popstate), or a second tap there would run the close twice. A request later than
 * this means the parent ignored the close, and it is asked afresh (`retry`). Compared when a
 * request arrives; no timer fires on its own.
 */
export const SHEET_CLOSE_SETTLE_MS = 1000;

/**
 * A sheet's close, one table (decision 0266, FLOW-1167). A close runs `onBeforeClose`, then
 * `onCloseKind`, then `onOpenChange(false)`, in that order.
 * - `request` (✕, Escape, a scrim tap, `onRequestClose`): asks `onBeforeClose`. While a save is
 *   in flight (`busy`) it waits instead (`queued`) and is asked once the save settles.
 * - `allow` / `refuse`: the decision, or the parent's `onOpenChange` returning false.
 * - `shown` / `hidden`: the parent opened the sheet (only `closed` → `open`) or closed it, sent in
 *   a layout effect, so a close asked in the commit that opens the sheet is heard. Unmounting sends
 *   `hidden`, so a decision that settles after it sends nothing. The parent's close always wins.
 * - After an allowed close the sheet stays `closing` while the parent still draws it open; a render
 *   does not move it. A request within `SHEET_CLOSE_SETTLE_MS` of the allowed close is that same
 *   close and is ignored, so an async parent closes once however many taps land. A later one is
 *   `retry`: the parent ignored the close, so `onBeforeClose` is asked again.
 * - A decision that never settles holds `deciding`: later requests are not asked again (a second
 *   ask could save twice), until the parent closes the sheet or opens it afresh.
 */
export const sheetClose = defineMachine({
  name: "sheetClose",
  initial: "closed",
  states: {
    closed: { shown: "open" },
    open: { request: "deciding", wait: "queued", hidden: "closed" },
    queued: { wait: "queued", request: "deciding", hidden: "closed" },
    deciding: { allow: "closing", refuse: "open", hidden: "closed" },
    closing: { retry: "deciding", refuse: "open", hidden: "closed" },
  },
});

export function Sheet({
  open: wanted,
  onOpenChange,
  title,
  subtitle,
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
  busy = false,
  closeButton = true,
  aside,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Under the title, in the title's column. Only a choice sheet has one (FLOW-372). */
  subtitle?: string;
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
  /** A save is in flight: the sheet stays open and closes once it settles. */
  busy?: boolean;
  /** Off where the sheet has its own way out (the setup skip sheet draws none). */
  closeButton?: boolean;
  /** At the end of the head, on the title's line (the rehab sheet's total). */
  aside?: ReactNode;
}) {
  const vaul = useSheetDrawer();
  // Until vaul arrives the sheet counts as closed, so its open runs in full once it can draw.
  const open = wanted && vaul != null;
  const closeRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const scrimRef = useRef<HTMLDivElement>(null);
  const localTitle = useRef<HTMLHeadingElement>(null);
  const titleRef = titleRefProp ?? localTitle;
  const { send: sendClose } = useMachine(sheetClose, open ? "open" : "closed");
  /** When the last close was allowed: a request within `SHEET_CLOSE_SETTLE_MS` is the same close. */
  const allowedAt = useRef(0);
  /** A dismiss came in while a save was in flight; the sheet closes once it settles (0075). */
  const closeAfterBusy = useRef<{ byKey: boolean } | null>(null);
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
  // The table follows `open` before any passive effect, so a close asked in the opening commit is
  // heard. Only a real reopen (`closed` → `open`) clears the key flag; a render never moves `closing`.
  useLayoutEffect(() => {
    if (!open) sendClose("hidden");
    else if (sendClose("shown")) keyClose.current = false;
  }, [open, sendClose]);
  // A decision that settles after the sheet is gone sends nothing (a RouteSheet's goBack would pop twice).
  useLayoutEffect(() => () => { sendClose("hidden"); }, [sendClose]);
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
    if (busy) {
      // A repeat dismiss keeps the key flag: Escape anywhere in the wait means a key close.
      if (sendClose("wait")) closeAfterBusy.current = { byKey: byKey || closeAfterBusy.current?.byKey === true };
      return;
    }
    // While `closing`, a request soon after the allowed close is that close; a later one is `retry`.
    const late = Date.now() - allowedAt.current >= SHEET_CLOSE_SETTLE_MS;
    if (!sendClose("request") && !(late && sendClose("retry"))) return;
    let verdict: undefined | boolean;
    try {
      verdict = await onBeforeClose?.();
    } catch (error) {
      sendClose("refuse");
      throw error;
    }
    if (verdict === false) {
      sendClose("refuse");
      return;
    }
    // The parent closed the sheet (or closed and reopened it, or unmounted it) while this was
    // decided: nothing to send.
    if (!sendClose("allow")) return;
    allowedAt.current = Date.now();
    // Only a close that goes ahead decides the ring; a refused Escape must not mark a later ✕.
    keyClose.current = byKey;
    onCloseKind?.(byKey);
    const accepted = (onOpenChange as (open: boolean) => boolean | undefined)(false);
    // A refused close leaves the sheet open. The flags must not stick.
    if (accepted === false) {
      sendClose("refuse");
      keyClose.current = false;
    }
  }
  const requestCloseRef = useRef(requestClose);
  requestCloseRef.current = requestClose;
  useEffect(() => {
    // The pending close dies with the sheet: a sheet that closed by another route must not close again.
    if (!open) {
      closeAfterBusy.current = null;
      return;
    }
    const pending = closeAfterBusy.current;
    if (busy || pending == null) return;
    closeAfterBusy.current = null;
    void requestCloseRef.current(pending.byKey);
  }, [busy, open]);
  useEffect(() => {
    if (!onRequestClose) return;
    onRequestClose.current = () => {
      void requestCloseRef.current();
    };
    return () => {
      onRequestClose.current = null;
    };
  });
  /** A tap on a toast keeps the sheet open. Returns true when it did. */
  function keepOpenForToast(event: { preventDefault: () => void; target: EventTarget | null; detail?: { originalEvent?: { target: EventTarget | null } } }): boolean {
    const nodes = [event.target, event.detail?.originalEvent?.target];
    const onToast = nodes.some((node) => {
      const element = node instanceof Element ? node : node instanceof Text ? node.parentElement : null;
      return element?.closest(".ui-toast, .ui-toast-host") != null;
    });
    if (onToast) event.preventDefault();
    return onToast;
  }
  if (!vaul) return null;
  const { Drawer } = vaul;
  return (
    <Drawer.Root
      open={open}
      dismissible={!busy}
      modal={modal}
      // FLOW-1024: Vaul lifts the sheet by the keyboard's height but ignores iOS panning the page
      // to the field, so the sheet rose twice, off the top. The CSS lifts it by --kb instead.
      repositionInputs={false}
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
          aria-busy={busy || undefined}
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            titleRef.current?.focus({ preventScroll: true });
          }}
          onPointerDownOutside={(event) => {
            if (keepOpenForToast(event)) return;
            // A scrim tap during a save waits for the save, like Escape does.
            if (busy) {
              event.preventDefault();
              void requestClose();
              return;
            }
          }}
          onInteractOutside={(event) => {
            keepOpenForToast(event);
            if (busy) event.preventDefault();
          }}
          onFocusOutside={(event) => {
            keepOpenForToast(event);
          }}
          onEscapeKeyDown={(event) => {
            // A save in flight keeps the sheet open; Escape closes it once the save settles.
            if (busy) {
              event.preventDefault();
              void requestClose(true);
              return;
            }
            if (onEscape) {
              event.preventDefault();
              onEscape();
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
            subtitle={subtitle}
            hint={hint}
            action={action}
            leading={leading}
            drawer
            closeRef={closeRef}
            titleRef={titleRef}
            footClassName={footClassName}
            busy={busy}
            closeButton={closeButton}
            aside={aside}
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
