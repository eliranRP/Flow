import { useCallback, useEffect, useRef, type ReactNode } from "react";
import { useLocation, useNavigate, useNavigationType, NavigationType, type NavigateFunction } from "react-router-dom";
import { IconButton } from "./icon-button";
import { BackIcon } from "./icons";

/** React Router stores its stack index on the browser history entry. */
export function historyIndex(): number | null {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null || !("idx" in state)) return null;
  const idx = state.idx;
  return typeof idx === "number" ? idx : null;
}

export function canGoBack(): boolean {
  const idx = historyIndex();
  return idx != null && idx > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** Browser history nests location state under `usr`. Location state is already that object. */
function historyRecord(state: unknown): Record<string, unknown> | null {
  if (!isRecord(state)) return null;
  if (isRecord(state.usr) && !("flowLayer" in state) && !("flowLayers" in state)) return state.usr;
  return state;
}

/** Open sheets, bottom to top. A lone `flowLayer` is a one-sheet entry from before the stack. */
export function sheetStack(state: unknown): string[] {
  const record = historyRecord(state);
  if (record == null) return [];
  const layers = record.flowLayers;
  if (Array.isArray(layers)) {
    const names = layers.filter((item): item is string => typeof item === "string" && item !== "");
    if (names.length > 0) return names;
  }
  const layer = record.flowLayer;
  return typeof layer === "string" && layer !== "" ? [layer] : [];
}

function layerName(state: unknown): string | null {
  const stack = sheetStack(state);
  return stack[stack.length - 1] ?? null;
}

function layerState(state: unknown, name: string): Record<string, unknown> {
  const record = historyRecord(state) ?? {};
  const base = { ...record };
  delete base.idx;
  delete base.key;
  delete base.usr;
  const stack = sheetStack(state);
  const next = stack.includes(name) ? stack : [...stack, name];
  return { ...base, flowLayer: name, flowLayers: next };
}

/** Location state after the top sheet has closed without a browser pop. */
function droppedStackState(state: unknown, layers: string[]): Record<string, unknown> | null {
  const record = historyRecord(state) ?? {};
  const base = { ...record };
  delete base.idx;
  delete base.key;
  delete base.usr;
  delete base.flowLayer;
  delete base.flowLayers;
  const top = layers[layers.length - 1];
  const next = top == null ? base : { ...base, flowLayer: top, flowLayers: layers };
  return Object.keys(next).length === 0 ? null : next;
}

/**
 * Pop the screen that opened this one. A deep link has no app history, so it
 * replaces itself with the logical parent. Browser back uses the same entry.
 */
export function useGoBack(): (fallback: string) => void {
  const navigate = useNavigate();
  const action = useNavigationType();
  return useCallback((fallback: string) => {
    const idx = historyIndex();
    if (idx != null) {
      if (idx > 0) void navigate(-1);
      else void navigate(fallback, { replace: true });
      return;
    }
    // MemoryRouter (unit tests) keeps its own stack and does not stamp idx.
    // A push still has a previous screen. A fresh entry falls back.
    if (action === NavigationType.Push) void navigate(-1);
    else void navigate(fallback, { replace: true });
  }, [navigate, action]);
}

export function BackButton({
  fallback,
  label = "חזרה",
  onBand = false,
  disabled = false,
  children,
}: {
  fallback: string;
  label?: string;
  onBand?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const goBack = useGoBack();
  return (
    <IconButton
      label={label}
      onBand={onBand}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        goBack(fallback);
      }}
    >
      {children ?? <BackIcon />}
    </IconButton>
  );
}

/** A transaction returns to its project. Without one, the project list is the parent. */
export function transactionParent(projectId: string | null | undefined, search: string): string {
  if (projectId) return `/projects/${projectId}${search}`;
  return `/projects${search}`;
}

const scrollPositions = new Map<string, number>();

/** Restores the scroll of a history entry. The period and the tab live elsewhere. */
export function ScrollMemory() {
  const location = useLocation();
  useEffect(() => {
    const key = location.key;
    const saved = scrollPositions.get(key);
    if (saved != null) window.scrollTo(0, saved);
    return () => {
      scrollPositions.set(key, window.scrollY);
    };
  }, [location.key]);
  return null;
}

let pushingLayer = false;

/** Raw open setters, so a close can dismiss this sheet and every layer above it. */
const sheetClosers = new Map<string, (open: boolean) => void>();

/**
 * A sheet that is not its own route still needs a history entry, so the iOS
 * swipe closes the sheet instead of leaving the page.
 */
export function useSheetHistory(
  name: string,
  open: boolean,
  onOpenChange: (open: boolean) => void,
  allowClose?: () => boolean | Promise<boolean>,
  /** When set, the next open replaces the current entry instead of pushing one. */
  adopt?: { current: boolean },
): (next: boolean) => boolean {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;
  const openRef = useRef(open);
  const onOpenChangeRef = useRef(onOpenChange);
  openRef.current = open;
  onOpenChangeRef.current = onOpenChange;
  const layer = layerName(location.state);
  const pushed = useRef(false);
  const allowRef = useRef(allowClose);
  allowRef.current = allowClose;

  useEffect(() => {
    sheetClosers.set(name, onOpenChange);
    return () => {
      if (sheetClosers.get(name) === onOpenChange) sheetClosers.delete(name);
    };
  }, [name, onOpenChange]);

  useEffect(() => {
    if (!open) {
      pushed.current = false;
      return;
    }
    if (pushed.current || layer === name || pushingLayer) {
      if (layer === name) pushed.current = true;
      // The closed sibling sheet runs first and must not drop a shared flag.
      // A push already in flight still needs the flag on its next run.
      if (!pushingLayer && adopt) adopt.current = false;
      return;
    }
    pushingLayer = true;
    pushed.current = true;
    let replaceEntry = false;
    if (adopt?.current === true) {
      replaceEntry = true;
      adopt.current = false;
    }
    void navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: replaceEntry,
      state: layerState(location.state, name),
    });
    queueMicrotask(() => {
      pushingLayer = false;
    });
  }, [open, name, layer, navigate, location.pathname, location.search, location.hash, location.state, adopt]);

  useEffect(() => {
    function onPop(event: PopStateEvent) {
      if (!openRef.current) return;
      // A pop of the sheet above this one leaves this name in the stack.
      if (sheetStack(event.state).includes(name)) return;
      void (async () => {
        const allowed = allowRef.current ? await allowRef.current() : true;
        if (!allowed) {
          pushed.current = true;
          void navigate(`${location.pathname}${location.search}${location.hash}`, {
            state: layerState(window.history.state, name),
          });
          return;
        }
        pushed.current = false;
        onOpenChangeRef.current(false);
      })();
    }
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
    };
  }, [name, navigate, location.pathname, location.search, location.hash]);

  return useCallback((next: boolean): boolean => {
    if (next) {
      onOpenChange(true);
      return true;
    }
    const current = locationRef.current;
    const stack = sheetStack(current.state);
    const index = stack.indexOf(name);
    if (index === -1) {
      onOpenChange(false);
      return true;
    }
    // A restored Forward entry can still list a sheet that already closed.
    // Close this sheet and every layer above it, instead of ignoring the request.
    const closing = stack.slice(index);
    let closed = false;
    for (const layer of closing) {
      const close = sheetClosers.get(layer);
      if (close == null) continue;
      close(false);
      closed = true;
    }
    if (!closed) return false;
    const steps = closing.length;
    const idx = historyIndex();
    if (idx != null && idx >= steps) {
      void navigate(-steps);
      return true;
    }
    // MemoryRouter has no browser index, so closing cannot pop. Drop the layers
    // in place, or a sheet stays stuck below a dead entry.
    void navigate(`${current.pathname}${current.search}${current.hash}`, {
      replace: true,
      state: droppedStackState(current.state, stack.slice(0, index)),
    });
    return true;
  }, [name, navigate, onOpenChange]);
}

let dropDone = false;
let dropActedKey = "";

/** Tests start from a fresh reload. */
export function resetDropRestoredSheet(): void {
  dropDone = false;
  dropActedKey = "";
}

/**
 * A reload restores a sheet history entry while the sheet starts closed.
 * Pop that entry so the first Back is not a dead step. A `?sheet=` visit
 * stays, because the screen opens the sheet from the query.
 */
export function DropRestoredSheet() {
  const location = useLocation();
  const navigate = useNavigate();
  useEffect(() => {
    if (dropDone) return;
    const stack = sheetStack(location.state);
    if (stack.length === 0) {
      dropDone = true;
      return;
    }
    if (new URLSearchParams(location.search).has("sheet")) {
      dropDone = true;
      return;
    }
    if (dropActedKey === location.key) return;
    dropActedKey = location.key;
    const idx = historyIndex();
    if (idx != null && idx > 0) {
      void navigate(-Math.min(stack.length, idx));
      return;
    }
    dropDone = true;
    const prev = isRecord(location.state) ? { ...location.state } : {};
    delete prev.flowLayer;
    delete prev.flowLayers;
    void navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: true,
      state: Object.keys(prev).length === 0 ? null : prev,
    });
  }, [location, navigate]);
  return null;
}

/** Drop open sheet entries in one step. A second close must not push another entry. */
export function popSheetLayers(navigate: NavigateFunction, count: number): void {
  if (count <= 0) return;
  const idx = historyIndex();
  const steps = idx == null ? count : Math.min(count, idx);
  if (steps > 0) void navigate(-steps);
}
