

export type ToastInput = {
  message: string;
  tone?: "ok" | "bad" | "info";
  action?: string;
  onAction?: () => void;
  /** Sit under the page header even while a sheet is open. A card-line pick closes that sheet. */
  /** `tab` sits above the Home tab bar. A confirmation does not move it under the band. */
  /** `bar` sits just above the screen's pinned action bar (decision 0137). A confirmation stays there too. */
  place?: "page" | "tab" | "bar";
};

/** A plain confirmation stays 4s. A toast with an action (ניסיון חוזר, ביטול) stays 5s. An error, or an info notice without an action, stays 4s. Hover, focus, and a press pause it. Decision 0074. */
export const OK_MS = 4000;
const ACTION_MS = 5000;
const BAD_MS = 4000;
export const SWIPE_PX = 48;

export function toastMs(input: ToastInput): number {
  if (input.action && input.onAction) return ACTION_MS;
  if (input.tone === "bad" || input.tone === "info") return BAD_MS;
  return OK_MS;
}

export function cssPx(name: string): number {
  const value = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
  return Number.isFinite(value) ? value : 0;
}

function lengthPx(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.includes("env(")) return null;
  if (trimmed.endsWith("rem")) {
    const root = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const parsed = Number.parseFloat(trimmed);
    return Number.isFinite(parsed) ? parsed * root : null;
  }
  const value = Number.parseFloat(trimmed);
  return Number.isFinite(value) ? value : null;
}

/** The top safe area in pixels. `env()` stays unresolved on the custom property, so a probe reads the used length. */
export function safeTopPx(): number {
  const declared = lengthPx(getComputedStyle(document.documentElement).getPropertyValue("--safe-top"));
  if (declared != null) return declared;
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.blockSize = "var(--safe-top)";
  document.body.appendChild(probe);
  const height = probe.getBoundingClientRect().height;
  probe.remove();
  return Number.isFinite(height) ? height : 0;
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

/** The open sheet, or the page header, and the spacing tokens that sit the toast under it. A page toast ignores the sheet. */
export function toastAnchor(layer?: HTMLElement | null): { sheet: Element | null; anchor: Element | null; gap: number; inset: number } {
  const page = layer?.dataset.place === "page" || layer?.dataset.place === "tab" || layer?.dataset.place === "bar";
  const sheet = page ? null : document.querySelector("[data-vaul-drawer][data-state='open']");
  const anchor = sheet?.querySelector(".ui-sheet-hint, .ui-sheet-head")
    ?? document.querySelector("header.ui-page, header.ui-band");
  return { sheet, anchor, gap: cssPx("--space-2"), inset: cssPx("--space-4") };
}

type ToastBox = { top: number; bottom: number };

function toastControls(layer: HTMLElement, sheet: Element | null, ignoreDrawers = false): ToastBox[] {
  const boxes: ToastBox[] = [];
  for (const control of document.querySelectorAll("button, a[href], input, textarea, select")) {
    if (!(control instanceof HTMLElement) || layer.contains(control)) continue;
    if (ignoreDrawers && control.closest("[data-vaul-drawer]")) continue;
    if (sheet instanceof Element && !sheet.contains(control)) continue;
    const rect = control.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const top = sheet instanceof HTMLElement ? restingControlTop(control, sheet) : rect.top;
    boxes.push({ top, bottom: top + rect.height });
  }
  boxes.sort((left, right) => left.top - right.top);
  return boxes;
}

/** The tab bar chrome is not a button, so a toast can sit on it without hitting a control. */
function tabBarObstacle(): ToastBox | null {
  const bar = document.querySelector(".ui-tabbar");
  if (!(bar instanceof HTMLElement)) return null;
  const rect = bar.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  return { top: rect.top, bottom: rect.bottom };
}

/** The top of the topmost visible `[data-toast-floor]`, such as a pinned ActionBar; else the tab bar. */
export function toastFloor(): ToastBox | null {
  let best: ToastBox | null = null;
  for (const node of document.querySelectorAll("[data-toast-floor]")) {
    if (!(node instanceof HTMLElement)) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (best == null || rect.top < best.top) best = { top: rect.top, bottom: rect.bottom };
  }
  return best ?? tabBarObstacle();
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

export function sheetSurface(sheet: Element): HTMLElement | null {
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
export function pinSheetScroll(surface: HTMLElement): void {
  const panel = surface.closest("[data-vaul-drawer]");
  if (panel instanceof HTMLElement && panel.scrollTop !== 0) panel.scrollTop = 0;
}

/** The sheet's own content. Padding from the toast pad does not change this. */
export function sheetContentKey(sheet: Element): string {
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
export function shiftPad(surface: HTMLElement): number {
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
  if (layer.dataset.place === "bar") {
    // Decision 0137: just above the bar, near the thumb. It may cover the bottom of the
    // scrolling card, never the bar. No control-collision pass, the same as `tab`.
    const gap = cssPx("--space-2");
    layer.style.paddingInline = "var(--space-card-inset)";
    const safe = safeTopPx();
    // No bar (the last card was handled): above the tab bar, else the screen edge (0137 §3).
    const floor = toastFloor() ?? tabBarObstacle();
    const top = floor && height > 0
      ? Math.max(safe, floor.top - gap - height)
      : Math.max(safe, window.innerHeight - gap - height);
    layer.style.top = `${String(top)}px`;
    return;
  }
  if (layer.dataset.place === "tab") {
    const gap = cssPx("--space-4");
    layer.style.paddingInline = "var(--space-4)";
    const safe = safeTopPx();
    const bar = tabBarObstacle();
    const top = bar && height > 0
      ? Math.max(safe, bar.top - gap - height)
      : Math.max(safe, window.innerHeight - gap - height);
    layer.style.top = `${String(top)}px`;
    return;
  }
  layer.style.paddingInline = "";
  const { sheet, anchor, gap, inset } = toastAnchor(layer);
  const safe = safeTopPx();
  const ignoreDrawers = layer.dataset.place === "page";
  const measured = anchor instanceof HTMLElement
    ? anchor.getBoundingClientRect().bottom + gap
    : safe + inset;
  const floor = window.innerHeight - gap;
  const boxes = toastControls(layer, sheet, ignoreDrawers);
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
  const bar = tabBarObstacle();
  if (bar && height > 0) {
    const limit = bar.top;
    let top = measured;
    for (let step = 0; step < boxes.length + 1; step += 1) {
      if (top < safe) top = safe;
      if (top + height > limit) {
        top = Math.max(safe, measured);
        break;
      }
      const hit = boxes.find((box) => box.top < top + height && box.bottom > top);
      if (!hit) break;
      const next = hit.bottom + gap;
      if (next + height > limit) {
        top = Math.max(safe, measured);
        break;
      }
      top = next;
    }
    layer.style.top = `${String(top)}px`;
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
