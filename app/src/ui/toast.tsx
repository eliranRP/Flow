import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
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
    const top = sheet instanceof HTMLElement ? restingControlTop(control, sheet) : rect.top;
    boxes.push({ top, bottom: top + rect.height });
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

function sheetSurface(sheet: Element): HTMLElement | null {
  const surface = sheet.querySelector(".ui-sheet-surface");
  return surface instanceof HTMLElement ? surface : null;
}

/** The drawer's own translate, so a measurement ignores the open animation. */
function translateY(node: Element): number {
  if (!(node instanceof HTMLElement)) return 0;
  const value = getComputedStyle(node).transform;
  if (!value || value === "none") return 0;
  return new DOMMatrixReadOnly(value).m42;
}

/**
 * Where the sheet's top edge sits once the open animation and the toast pad
 * are finished. A fit sheet is bottom-anchored, so the pad lifts that edge.
 * A tall sheet has a fixed height, so the pad does not move it.
 */
function restingSheetTop(sheet: HTMLElement): number {
  const surface = sheetSurface(sheet);
  const lifts = surface != null && !sheet.classList.contains("ui-sheet-tall") ? shiftPad(surface) : 0;
  return sheet.getBoundingClientRect().top - translateY(sheet) + lifts;
}

/**
 * Where a control sits once the panel scroll is pinned and the pad is off.
 * Mid-animation the panel can be scrolled, which reports ✕ far above the sheet.
 * On a tall sheet the pad pushes the control down; on a fit sheet it does not.
 */
function restingControlTop(control: HTMLElement, sheet: HTMLElement): number {
  const surface = sheetSurface(sheet);
  const pushed = surface != null && sheet.classList.contains("ui-sheet-tall") ? shiftPad(surface) : 0;
  return control.getBoundingClientRect().top - translateY(sheet) + sheet.scrollTop - pushed;
}

/** Padding above the header must stay on screen. The panel is not the scroller. */
function pinSheetScroll(surface: HTMLElement): void {
  const panel = surface.closest("[data-vaul-drawer]");
  if (panel instanceof HTMLElement && panel.scrollTop !== 0) panel.scrollTop = 0;
}

/** The sheet's own content. Padding from the toast pad does not change this. */
function sheetContentKey(sheet: Element): string {
  const body = sheet.querySelector(".ui-sheet-body");
  const text = body instanceof HTMLElement ? body.innerText : "";
  const controls = body instanceof HTMLElement ? body.querySelectorAll("button, a, input, [role='radio']").length : 0;
  const shape = sheet.classList.contains("ui-sheet-tall") ? "tall" : "fit";
  return `${shape}|${String(controls)}|${text}`;
}

/** Drop the extra pad. Setting it to zero lets the motion token ease it back. */
export function clearToastPad(sheet: Element | null = document.querySelector("[data-vaul-drawer][data-state='open']")): void {
  if (!(sheet instanceof Element)) return;
  const surface = sheetSurface(sheet);
  if (!surface) return;
  if ((surface.dataset.toastPad ?? "") === "" && surface.style.getPropertyValue("--toast-pad") === "") return;
  surface.style.setProperty("--toast-pad", "0px");
  delete surface.dataset.toastPad;
  pinSheetScroll(surface);
}

/**
 * How far the controls have been pushed down. The live padding wins, because a
 * transition can still be showing the old pad after the variable was cleared.
 * The declared variable is the fallback when the stylesheet has not applied.
 */
function shiftPad(surface: HTMLElement): number {
  const declared = Number.parseFloat(surface.style.getPropertyValue("--toast-pad")) || 0;
  const computedTop = Number.parseFloat(getComputedStyle(surface).paddingTop) || 0;
  const live = Math.max(0, computedTop - cssPx("--space-2"));
  return live > 0.5 ? live : Math.max(live, declared);
}

/**
 * Pad only when the toast would cover a control. The grabber and the empty
 * header may stay underneath. The need is computed from the unpadded layout,
 * so a sheet that is already padded does not report a need of zero.
 */
function padSheetUnderToast(sheet: HTMLElement, top: number, height: number, gap: number): void {
  const surface = sheetSurface(sheet);
  if (!surface) return;
  const applied = shiftPad(surface);
  const declared = Number.parseFloat(surface.style.getPropertyValue("--toast-pad")) || 0;
  const toastBottom = top + height + gap;
  let need = 0;
  for (const control of sheet.querySelectorAll("button, a[href], input, textarea, select")) {
    if (!(control instanceof HTMLElement)) continue;
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const naturalTop = restingControlTop(control, sheet);
    const naturalBottom = naturalTop + rect.height;
    if (naturalTop >= toastBottom || naturalBottom <= top) continue;
    need = Math.max(need, toastBottom - naturalTop);
  }
  if (need <= 0.5) {
    if (applied > 0.5 || declared > 0.5) clearToastPad(sheet);
    pinSheetScroll(surface);
    return;
  }
  if (Math.abs(need - applied) < 1 && Math.abs(need - declared) < 1) {
    surface.dataset.toastPad = String(need);
    pinSheetScroll(surface);
    return;
  }
  surface.dataset.toastPad = String(need);
  surface.style.setProperty("--toast-pad", `${String(need)}px`);
  pinSheetScroll(surface);
}

/** Sit just under the page header, or just above an open sheet, clear of every control. A toast that cannot fit in the gap keeps its full height `--space-2` below the safe area. It may cover the grabber and the empty top of the sheet. It never covers a header control or any other control: only then does the sheet content pad down, once. The text is never clipped. Decision 0075. */
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
  const sheetTop = sheet instanceof HTMLElement ? restingSheetTop(sheet) : null;
  const pageHeader = document.querySelector("header.ui-page, header.ui-band");
  if (sheet instanceof HTMLElement && sheetTop != null && height > 0) {
    const minTop = Math.max(safe, 0) + gap;
    const above = sheetTop - gap - height;
    if (
      above >= minTop
      && above + height <= floor
      && !toastHits(above, height, boxes)
      && !coversPageHeader(above, height, pageHeader, sheet)
    ) {
      clearToastPad(sheet);
      layer.style.top = `${String(above)}px`;
      return;
    }
    // The gap above the sheet is shorter than the toast, or it would sit closer
    // than --space-2 to the screen edge. Keep the full height --space-2 below
    // the safe area. It may cover the grabber and the empty header. A control
    // pads down once.
    const top = minTop;
    layer.style.top = `${String(top)}px`;
    padSheetUnderToast(sheet, top, height, gap);
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
  const [phase, setPhase] = useState<"off" | "measure" | "pad" | "fade" | "in">("off");
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

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  /** A toast that is already on screen is placed in this frame. A new one waits until the sheet shape stops changing, so it is never shown at a position it will leave. */
  const revealNow = useRef(false);

  const show = useCallback(
    (input: ToastInput) => {
      acting.current = false;
      seq.current += 1;
      clearTimer();
      remaining.current = toastMs(input);
      const current = phaseRef.current;
      revealNow.current = current === "pad" || current === "fade" || current === "in";
      if (!revealNow.current) setPhase("measure");
      setToast({ ...input, id: seq.current });
    },
    [],
  );

  const dismiss = useCallback(() => {
    acting.current = false;
    clearTimer();
    setPhase("off");
    setToast(null);
  }, []);

  function runAction() {
    if (!toast?.onAction || acting.current) return;
    acting.current = true;
    const action = toast.onAction;
    clearTimer();
    setPhase("off");
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

  const visible = phase === "fade" || phase === "in";
  const toastRef = useRef(toast);
  toastRef.current = toast;
  const padToken = useRef(0);
  useEffect(() => {
    if (!toast || !visible) {
      clearTimer();
      return;
    }
    arm(remaining.current);
    return () => {
      clearTimer();
    };
  }, [toast, visible, arm]);

  useLayoutEffect(() => {
    const node = host.current;
    if (!toast || !node) {
      if (!toast) {
        // A retry replaces this toast on the next turn. Leave the pad until
        // that turn has had a chance to claim it, so it never eases through 0.
        const token = ++padToken.current;
        const outer = window.requestAnimationFrame(() => {
          window.requestAnimationFrame(() => {
            if (padToken.current !== token || toastRef.current) return;
            clearToastPad();
          });
        });
        return () => {
          window.cancelAnimationFrame(outer);
        };
      }
      return;
    }
    padToken.current += 1;
    const layer = node;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let generation = 0;
    let waiting = false;
    let hold = true;
    let fallback = 0;
    let contentKey = "";
    let removeEnd: (() => void) | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let mutationObserver: MutationObserver | null = null;
    let onViewport: (() => void) | null = null;
    let settling = false;
    let settleFrame = 0;

    function snap() {
      const sheet = toastAnchor().sheet;
      const surface = sheet instanceof Element ? sheetSurface(sheet) : null;
      if (surface) {
        const previous = surface.style.transition;
        surface.style.transition = "none";
        placeToast(layer);
        void surface.offsetHeight;
        pinSheetScroll(surface);
        surface.style.transition = previous;
        return;
      }
      placeToast(layer);
    }

    function rememberSheet() {
      const sheet = toastAnchor().sheet;
      contentKey = sheet instanceof Element ? sheetContentKey(sheet) : "";
    }

    function onSheetChange() {
      if (settling) return;
      const sheet = toastAnchor().sheet;
      if (!(sheet instanceof Element)) return;
      const next = sheetContentKey(sheet);
      if (next === contentKey) return;
      const shapeChanged = next.slice(0, next.indexOf("|")) !== contentKey.slice(0, contentKey.indexOf("|"));
      contentKey = next;
      // The saving row settles while the pad owns the layout. That text change
      // must not cancel the padding transition. A shape change (tall to short)
      // places the toast and the pad in the same frame.
      if (!shapeChanged && hold) return;
      snap();
      if (shapeChanged && waiting) finishPad(generation);
    }

    function onViewportChange() {
      if (hold) return;
      snap();
      rememberSheet();
    }

    function watchSheet() {
      const sheet = toastAnchor().sheet;
      if (typeof ResizeObserver !== "undefined" && sheet instanceof Element && !resizeObserver) {
        resizeObserver = new ResizeObserver(() => {
          onSheetChange();
        });
        const head = sheet.querySelector(".ui-sheet-head");
        const body = sheet.querySelector(".ui-sheet-body");
        if (head instanceof Element) resizeObserver.observe(head);
        if (body instanceof Element) resizeObserver.observe(body);
      }
      if (typeof MutationObserver !== "undefined" && sheet instanceof Element && !mutationObserver) {
        mutationObserver = new MutationObserver(() => {
          onSheetChange();
        });
        mutationObserver.observe(sheet, {
          attributes: true,
          attributeFilter: ["class"],
          childList: true,
          subtree: true,
        });
      }
      if (!onViewport) {
        onViewport = () => {
          onViewportChange();
        };
        window.addEventListener("resize", onViewport);
        window.visualViewport?.addEventListener("resize", onViewport);
        window.visualViewport?.addEventListener("scroll", onViewport);
      }
    }

    function release() {
      hold = false;
    }

    function showNow(gen: number) {
      if (gen !== generation) return;
      waiting = false;
      window.clearTimeout(fallback);
      removeEnd?.();
      removeEnd = null;
      setPhase("in");
      release();
    }

    function finishPad(gen: number) {
      if (gen !== generation || !waiting) return;
      waiting = false;
      window.clearTimeout(fallback);
      removeEnd?.();
      removeEnd = null;
      setPhase("fade");
      release();
      const toastEl = layer.querySelector(".ui-toast");
      const onFade = (event: Event) => {
        if (gen !== generation) return;
        if (!(event instanceof TransitionEvent) || event.propertyName !== "opacity") return;
        if (event.target !== toastEl) return;
        toastEl?.removeEventListener("transitionend", onFade);
        showNow(gen);
      };
      requestAnimationFrame(() => {
        if (gen !== generation) return;
        toastEl?.addEventListener("transitionend", onFade);
      });
      fallback = window.setTimeout(() => {
        toastEl?.removeEventListener("transitionend", onFade);
        showNow(gen);
      }, 220);
    }

    function sheetShape(): string {
      const sheet = toastAnchor().sheet;
      if (!(sheet instanceof Element)) return "none";
      return sheet.classList.contains("ui-sheet-tall") ? "tall" : "fit";
    }

    function commitPlacement(gen: number) {
      if (gen !== generation) return;
      settling = false;
      const sheet = toastAnchor().sheet;
      const surface = sheet instanceof Element ? sheetSurface(sheet) : null;
      const before = surface ? shiftPad(surface) : 0;
      if (surface) surface.style.transition = reduce ? "none" : "";
      placeToast(layer);
      if (surface) {
        void surface.offsetHeight;
        pinSheetScroll(surface);
        if (reduce) surface.style.transition = "";
      }
      rememberSheet();
      watchSheet();
      const target = surface ? Number.parseFloat(surface.dataset.toastPad ?? "") || 0 : 0;
      const moved = !reduce && surface != null && Math.abs(target - before) > 1;
      if (moved && surface) {
        waiting = true;
        setPhase("pad");
        const onEnd = (event: Event) => {
          if (gen !== generation || !waiting) return;
          if (!(event instanceof TransitionEvent) || event.propertyName !== "padding-top") return;
          if (event.target !== surface) return;
          finishPad(gen);
        };
        surface.addEventListener("transitionend", onEnd);
        removeEnd = () => {
          surface.removeEventListener("transitionend", onEnd);
        };
        fallback = window.setTimeout(() => {
          finishPad(gen);
        }, 220);
        return;
      }
      showNow(gen);
    }

    function begin() {
      generation += 1;
      const gen = generation;
      waiting = false;
      hold = true;
      window.clearTimeout(fallback);
      removeEnd?.();
      removeEnd = null;
      window.cancelAnimationFrame(settleFrame);
      // A replacement (ניסיון חוזר) is already on screen. Place it in this frame.
      // With no sheet, there is no shape change to wait for. A new toast over a
      // sheet waits until the shape is the same across three frames, so a pick
      // that returns to the summary does not flash the tall position.
      if (revealNow.current || !(toastAnchor().sheet instanceof Element)) {
        commitPlacement(gen);
        return;
      }
      settling = true;
      let previous = "";
      let stable = 0;
      const step = () => {
        if (gen !== generation) return;
        const shape = sheetShape();
        if (shape === previous) stable += 1;
        else {
          previous = shape;
          stable = 0;
        }
        // Two frames in a row. A category pick pops back to the summary on the
        // next frame, and the toast must not paint on the tall sheet first.
        if (stable >= 2) {
          commitPlacement(gen);
          return;
        }
        settleFrame = requestAnimationFrame(step);
      };
      settleFrame = requestAnimationFrame(step);
    }

    begin();

    return () => {
      generation += 1;
      waiting = false;
      hold = true;
      settling = false;
      window.cancelAnimationFrame(settleFrame);
      window.clearTimeout(fallback);
      removeEnd?.();
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      if (onViewport) {
        window.removeEventListener("resize", onViewport);
        window.visualViewport?.removeEventListener("resize", onViewport);
        window.visualViewport?.removeEventListener("scroll", onViewport);
      }
      const sheet = toastAnchor().sheet;
      const surface = sheet instanceof Element ? sheetSurface(sheet) : null;
      if (surface) surface.style.transition = "";
    };
  }, [toast]);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <div
        className="ui-toast-host"
        data-phase={phase === "off" ? undefined : phase}
        ref={host}
      >
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
