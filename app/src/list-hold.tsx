import { useEffect, useMemo, useRef, useSyncExternalStore } from "react";

/** Lists keep their order while a row or its sheet is held, and until scrolling settles. */
export const SCROLL_SETTLE_MS = 120;

const SURFACE = ".ui-row, .ui-review-queue, .ui-project-list, [data-vaul-drawer]";

type HoldState = {
  press: boolean;
  focus: boolean;
  sheet: boolean;
  scrolling: boolean;
};

let state: HoldState = { press: false, focus: false, sheet: false, scrolling: false };
let pointers = 0;
let mouseDown = false;
let scrollTimer = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

function heldNow(): boolean {
  return state.press || state.focus || state.sheet || state.scrolling;
}

function setState(next: HoldState): void {
  if (
    next.press === state.press
    && next.focus === state.focus
    && next.sheet === state.sheet
    && next.scrolling === state.scrolling
  ) return;
  state = next;
  emit();
}

function inSurface(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(SURFACE) != null;
}

function syncPress(): void {
  setState({ ...state, press: pointers > 0 || mouseDown });
}

function onPointerDown(event: PointerEvent): void {
  if (!inSurface(event.target)) return;
  pointers += 1;
  syncPress();
}

function onPointerUp(): void {
  pointers = Math.max(0, pointers - 1);
  syncPress();
}

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0 || !inSurface(event.target)) return;
  mouseDown = true;
  syncPress();
}

function onMouseUp(): void {
  if (!mouseDown) return;
  mouseDown = false;
  syncPress();
}

function syncFocus(): void {
  setState({ ...state, focus: inSurface(document.activeElement) });
}

function sheetOpen(): boolean {
  return document.querySelector("[data-vaul-drawer][data-state='open']") != null;
}

function syncSheet(): void {
  setState({ ...state, sheet: sheetOpen() });
}

function onScroll(): void {
  window.clearTimeout(scrollTimer);
  if (!state.scrolling) setState({ ...state, scrolling: true });
  scrollTimer = window.setTimeout(() => {
    setState({ ...state, scrolling: false });
  }, SCROLL_SETTLE_MS);
}

export function holdActive(): boolean {
  return heldNow();
}

export function resetListHold(): void {
  window.clearTimeout(scrollTimer);
  pointers = 0;
  mouseDown = false;
  scrollTimer = 0;
  state = { press: false, focus: false, sheet: false, scrolling: false };
  emit();
}

/** One window listener. App mounts it. Tests call the same installer. */
export function installListHold(): () => void {
  resetListHold();
  window.addEventListener("pointerdown", onPointerDown);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("mousedown", onMouseDown);
  window.addEventListener("mouseup", onMouseUp);
  document.addEventListener("focusin", syncFocus);
  document.addEventListener("focusout", syncFocus);
  document.addEventListener("scroll", onScroll, true);
  const observer = new MutationObserver(syncSheet);
  observer.observe(document.body, { attributes: true, childList: true, subtree: true, attributeFilter: ["data-state"] });
  syncSheet();
  syncFocus();
  return () => {
    window.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("pointerup", onPointerUp);
    window.removeEventListener("pointercancel", onPointerUp);
    window.removeEventListener("mousedown", onMouseDown);
    window.removeEventListener("mouseup", onMouseUp);
    document.removeEventListener("focusin", syncFocus);
    document.removeEventListener("focusout", syncFocus);
    document.removeEventListener("scroll", onScroll, true);
    observer.disconnect();
    resetListHold();
  };
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useHoldActive(): boolean {
  return useSyncExternalStore(subscribe, holdActive, () => false);
}

/** Keep the previous order while a hold is active. New rows wait at the end. */
export function useHeldOrder<T>(rows: readonly T[], id: (row: T) => string): T[] {
  const held = useHoldActive();
  const order = useRef<string[]>([]);
  const identify = useRef(id);
  identify.current = id;
  return useMemo(() => {
    const key = identify.current;
    if (!held) {
      order.current = rows.map(key);
      return rows as T[];
    }
    const byId = new Map(rows.map((row) => [key(row), row]));
    const next: T[] = [];
    const seen = new Set<string>();
    for (const saved of order.current) {
      const row = byId.get(saved);
      if (row == null) continue;
      next.push(row);
      seen.add(saved);
    }
    for (const row of rows) {
      const rowId = key(row);
      if (seen.has(rowId)) continue;
      next.push(row);
      seen.add(rowId);
    }
    return next;
  }, [rows, held]);
}

/** Mounts the listeners. The order hook reads the same store. */
export function ListHoldRoot() {
  useEffect(() => installListHold(), []);
  return null;
}
