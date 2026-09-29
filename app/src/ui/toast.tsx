import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { CheckIcon, InfoIcon } from "./icons";

type ToastInput = {
  message: string;
  tone?: "ok" | "bad" | "info";
  action?: string;
  onAction?: () => void;
};

type ToastItem = ToastInput & { id: number };

type ToastContextValue = {
  show: (input: ToastInput) => void;
};

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast(): ToastContextValue {
  const value = useContext(ToastContext);
  if (!value) throw new Error("ToastProvider is missing");
  return value;
}

/** A plain confirmation stays 4s. A toast with an action (ניסיון חוזר, ביטול) stays 5s. An error, or an info notice without an action, stays 4s. Hover, focus, and a press pause it. Decision 0074. */
const OK_MS = 4000;
const ACTION_MS = 5000;
const BAD_MS = 4000;
const SWIPE_PX = 48;

function toastMs(input: ToastInput): number {
  if (input.action && input.onAction) return ACTION_MS;
  if (input.tone === "bad" || input.tone === "info") return BAD_MS;
  return OK_MS;
}

function cssPx(name: string): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

function tokenPx(name: string, fallback: number): number {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (raw.endsWith("rem")) {
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const parsed = Number.parseFloat(raw);
    return Number.isFinite(parsed) ? parsed * root : fallback;
  }
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Two lines of the toast, plus its padding, so a shrink cannot hide the words or ביטול. */
export function toastMinBlock(): number {
  const pad = tokenPx("--space-3", 12);
  const size = tokenPx("--type-label-size", 15);
  const line = tokenPx("--type-label-line", 1.5);
  return pad * 2 + size * line * 2;
}

/** The open sheet, or the page header, and the spacing tokens that sit the toast under it. */
export function toastAnchor(): { sheet: Element | null; anchor: Element | null; gap: number; inset: number } {
  const sheet = document.querySelector("[data-vaul-drawer][data-state='open']");
  const anchor = sheet?.querySelector(".ui-sheet-hint, .ui-sheet-head")
    ?? document.querySelector("header.ui-page, header.ui-band");
  return { sheet, anchor, gap: cssPx("--space-2"), inset: cssPx("--space-4") };
}

type ToastBox = { top: number; bottom: number };

function toastControls(layer: HTMLElement, sheet: Element | null): ToastBox[] {
  const boxes: ToastBox[] = [];
  for (const control of document.querySelectorAll("button, a[href], input, textarea, select")) {
    if (!(control instanceof HTMLElement) || layer.contains(control)) continue;
    if (sheet instanceof Element && !sheet.contains(control)) continue;
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    boxes.push({ top: rect.top, bottom: rect.bottom });
  }
  boxes.sort((left, right) => left.top - right.top);
  return boxes;
}

function toastHits(top: number, height: number, boxes: ToastBox[]): boolean {
  const bottom = top + height;
  return boxes.some((box) => box.top < bottom && box.bottom > top);
}

/** A toast that crosses the sheet's top edge covers the rounded corner and the grab area. */
function straddlesSheet(top: number, height: number, sheetTop: number | null): boolean {
  if (sheetTop == null) return false;
  const bottom = top + height;
  return top < sheetTop - 0.5 && bottom > sheetTop + 0.5;
}

function coversPageHeader(top: number, height: number, header: Element | null, sheet: Element | null): boolean {
  if (!(header instanceof HTMLElement) || (sheet instanceof Element && sheet.contains(header))) return false;
  const rect = header.getBoundingClientRect();
  if (rect.height === 0) return false;
  return rect.top < top + height && rect.bottom > top;
}

/** Sit just under the page header, or just above an open sheet, clear of every control. A shrink stays tall enough for two lines and ביטול, except it never covers a sheet header. */
export function placeToast(layer: HTMLElement): void {
  const toast = layer.querySelector(".ui-toast");
  if (toast instanceof HTMLElement) {
    toast.style.maxHeight = "";
    toast.style.overflow = "";
  }
  const height = toast instanceof HTMLElement ? toast.getBoundingClientRect().height : 0;
  const { sheet, anchor, gap, inset } = toastAnchor();
  const safe = cssPx("--safe-top");
  const measured = anchor instanceof HTMLElement
    ? anchor.getBoundingClientRect().bottom + gap
    : safe + inset;
  const floor = window.innerHeight - gap;
  const boxes = toastControls(layer, sheet);
  const sheetTop = sheet instanceof HTMLElement ? sheet.getBoundingClientRect().top : null;
  const pageHeader = document.querySelector("header.ui-page, header.ui-band");
  if (sheet instanceof HTMLElement && sheetTop != null && height > 0) {
    const above = sheetTop - gap - height;
    if (
      above >= safe
      && above + height <= floor
      && !toastHits(above, height, boxes)
      && !coversPageHeader(above, height, pageHeader, sheet)
    ) {
      layer.style.top = `${String(above)}px`;
      return;
    }
    const head = sheet.querySelector(".ui-sheet-head");
    const limit = head instanceof HTMLElement ? head.getBoundingClientRect().top : sheetTop;
    const headBottom = head instanceof HTMLElement ? head.getBoundingClientRect().bottom : sheetTop;
    const room = limit - gap - safe;
    const minBlock = toastMinBlock();
    if (toast instanceof HTMLElement && room >= minBlock && height > room) {
      toast.style.maxHeight = `${String(room)}px`;
      toast.style.overflow = "hidden";
      layer.style.top = `${String(safe)}px`;
      return;
    }
    if (room < minBlock) {
      // A scrolled sheet reports its header above the viewport. Follow the visible
      // sheet instead, so ניסיון חוזר stays on screen.
      const headerVisible = headBottom > sheetTop && limit < floor;
      if (!headerVisible) {
        const gapRoom = sheetTop - gap - safe;
        if (gapRoom >= height) {
          layer.style.top = `${String(Math.max(safe, sheetTop - gap - height))}px`;
          return;
        }
      }
      const below = (headerVisible ? headBottom : sheetTop) + gap;
      const available = floor - below;
      if (available >= minBlock) {
        if (toast instanceof HTMLElement && height > available) {
          toast.style.maxHeight = `${String(available)}px`;
          toast.style.overflow = "hidden";
        }
        layer.style.top = `${String(Math.max(safe, below))}px`;
        return;
      }
      layer.style.top = `${String(safe)}px`;
      return;
    }
    layer.style.top = `${String(safe)}px`;
    return;
  }
  const candidates = [measured];
  for (const box of boxes) candidates.push(box.top - gap - height);
  for (const box of boxes) candidates.push(box.bottom + gap);
  candidates.push(safe);
  if (height > 0) {
    for (const top of candidates) {
      if (top < safe || top + height > floor) continue;
      if (toastHits(top, height, boxes)) continue;
      if (straddlesSheet(top, height, sheetTop)) continue;
      if (coversPageHeader(top, height, pageHeader, sheet)) continue;
      layer.style.top = `${String(top)}px`;
      return;
    }
  }
  const edges = [safe, floor];
  for (const box of boxes) edges.push(box.top, box.bottom);
  edges.sort((left, right) => left - right);
  let bestTop = safe;
  let bestRoom = 0;
  for (let index = 0; index < edges.length - 1; index += 1) {
    const start = Math.max(edges[index] ?? safe, safe);
    const end = Math.min(edges[index + 1] ?? floor, floor);
    if (boxes.some((box) => start < box.bottom && end > box.top)) continue;
    const room = end - start;
    if (room > bestRoom) {
      bestRoom = room;
      bestTop = start;
    }
  }
  const minBlock = toastMinBlock();
  if (toast instanceof HTMLElement && height > bestRoom) {
    const cap = Math.max(bestRoom, minBlock);
    if (cap < height) {
      toast.style.maxHeight = `${String(cap)}px`;
      toast.style.overflow = "hidden";
    }
  }
  layer.style.top = `${String(Math.max(safe, bestTop))}px`;
}

/** One toast under the page header. A new show replaces it. The host does not catch taps. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastItem | null>(null);
  const host = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const timer = useRef<number | null>(null);
  const remaining = useRef(OK_MS);
  const started = useRef(0);
  const acting = useRef(false);

  const clearTimer = () => {
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const arm = useCallback((ms: number) => {
    clearTimer();
    started.current = Date.now();
    remaining.current = ms;
    timer.current = window.setTimeout(() => {
      setToast(null);
    }, ms);
  }, []);

  const show = useCallback(
    (input: ToastInput) => {
      acting.current = false;
      seq.current += 1;
      setToast({ ...input, id: seq.current });
      arm(toastMs(input));
    },
    [arm],
  );

  const dismiss = useCallback(() => {
    acting.current = false;
    clearTimer();
    setToast(null);
  }, []);

  function runAction() {
    if (!toast?.onAction || acting.current) return;
    acting.current = true;
    const action = toast.onAction;
    clearTimer();
    setToast(null);
    action();
  }

  function pause() {
    if (timer.current == null) return;
    remaining.current = Math.max(0, remaining.current - (Date.now() - started.current));
    clearTimer();
  }

  function resume() {
    if (!toast) return;
    arm(remaining.current);
  }

  useLayoutEffect(() => {
    const node = host.current;
    if (!toast || !node) return;
    const layer = node;
    const place = () => { placeToast(layer); };
    place();
    const { sheet, anchor } = toastAnchor();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(place);
      if (sheet instanceof Element) observer.observe(sheet);
      if (anchor instanceof Element) observer.observe(anchor);
    }
    sheet?.addEventListener("transitionend", place);
    const timers = [50, 150, 320, 500].map((ms) => window.setTimeout(place, ms));
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      sheet?.removeEventListener("transitionend", place);
      for (const timer of timers) window.clearTimeout(timer);
      window.removeEventListener("resize", place);
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div className="ui-toast-host" ref={host}>
        <Toast
          tone={toast?.tone ?? "ok"}
          action={toast?.action}
          onAction={toast?.onAction ? runAction : undefined}
          onDismiss={toast ? dismiss : undefined}
          onPause={toast ? pause : undefined}
          onResume={toast ? resume : undefined}
        >
          {toast?.message ?? ""}
        </Toast>
      </div>
    </ToastContext.Provider>
  );
}

type ToastProps = {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
  onDismiss?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  tone?: "ok" | "bad" | "info";
};

export function Toast({ children, action, onAction, onDismiss, onPause, onResume, tone = "ok" }: ToastProps) {
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const hold = useRef({ hover: false, focus: false, press: false });

  function setHold(key: "hover" | "focus" | "press", on: boolean) {
    const before = hold.current.hover || hold.current.focus || hold.current.press;
    hold.current[key] = on;
    const after = hold.current.hover || hold.current.focus || hold.current.press;
    if (!before && after) onPause?.();
    if (before && !after) onResume?.();
  }

  function onPointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    // The sheet listens on document. A tap here must not become an outside click.
    event.stopPropagation();
    if (event.pointerType === "mouse" && event.button !== 0) return;
    setHold("press", true);
    start.current = { x: event.clientX, y: event.clientY };
    swiped.current = false;
  }

  function onPointerUp(event: ReactPointerEvent<HTMLDivElement>) {
    const origin = start.current;
    start.current = null;
    if (origin) {
      const dx = event.clientX - origin.x;
      const dy = event.clientY - origin.y;
      if (Math.hypot(dx, dy) >= SWIPE_PX) {
        swiped.current = true;
        hold.current.press = false;
        onDismiss?.();
        return;
      }
    }
    setHold("press", false);
  }

  function onPointerCancel() {
    start.current = null;
    setHold("press", false);
  }

  const quiet = children == null || children === "";
  return (
    <div
      className={quiet ? "ui-toast-live" : "ui-toast"}
      role="status"
      dir="rtl"
      onMouseEnter={() => { setHold("hover", true); }}
      onMouseLeave={() => { setHold("hover", false); }}
      onFocus={() => { setHold("focus", true); }}
      onBlur={() => { setHold("focus", false); }}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onClick={(event) => {
        event.stopPropagation();
        if (swiped.current) {
          swiped.current = false;
          return;
        }
        const node = event.target instanceof Element
          ? event.target
          : event.target instanceof Text
            ? event.target.parentElement
            : null;
        if (node?.closest("button, .ui-toast-action")) return;
        onDismiss?.();
      }}
    >
      {quiet ? null : (
        <>
          <span className={tone === "bad" ? "ui-toast-mark ui-toast-icon ui-toast-bad" : "ui-toast-mark ui-toast-icon"} aria-hidden="true">
            {tone === "ok" ? <CheckIcon size={18} /> : <InfoIcon size={18} />}
          </span>
          <span className="ui-toast-text" dir="rtl">{children}</span>
          {action && onAction ? (
            <button type="button" className="ui-toast-action" aria-label={action} onClick={onAction}>
              {action}
            </button>
          ) : null}
        </>
      )}
    </div>
  );
}
