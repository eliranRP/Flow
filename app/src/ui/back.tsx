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

function layerName(state: unknown): string | null {
  if (!isRecord(state) || typeof state.flowLayer !== "string") return null;
  return state.flowLayer;
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
): (next: boolean) => void {
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
    const prev = isRecord(location.state) ? location.state : {};
    void navigate(`${location.pathname}${location.search}${location.hash}`, {
      replace: replaceEntry,
      state: { ...prev, flowLayer: name },
    });
    queueMicrotask(() => {
      pushingLayer = false;
    });
  }, [open, name, layer, navigate, location.pathname, location.search, location.hash, location.state, adopt]);

  useEffect(() => {
    function onPop() {
      if (!openRef.current) return;
      void (async () => {
        const allowed = allowRef.current ? await allowRef.current() : true;
        if (!allowed) {
          pushed.current = true;
          const prev = isRecord(window.history.state) ? window.history.state : {};
          void navigate(`${location.pathname}${location.search}${location.hash}`, {
            state: { ...prev, flowLayer: name },
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

  return useCallback((next: boolean) => {
    if (next) {
      onOpenChange(true);
      return;
    }
    const current = locationRef.current;
    if (layerName(current.state) === name && canGoBack()) {
      void navigate(-1);
      return;
    }
    onOpenChange(false);
  }, [name, navigate, onOpenChange]);
}

/** Drop open sheet entries in one step. A second close must not push another entry. */
export function popSheetLayers(navigate: NavigateFunction, count: number): void {
  if (count <= 0) return;
  const idx = historyIndex();
  const steps = idx == null ? count : Math.min(count, idx);
  if (steps > 0) void navigate(-steps);
}
