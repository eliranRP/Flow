/**
 * FLOW-172: the measuring half of `HintText` (hint-cut.tsx), loaded once with import() so Home's first
 * load stays small. A hint part that overflows gets its cut at the last letter that fits with "…".
 */
const ELLIPSIS = "…";
/** Spaces and the separating punctuation a cut never leaves before its "…" ("Quick …", "חשמל, …"). */
const TRAILING = /[\s,;:\-–]+$/u;
const graphemes = typeof Intl !== "undefined" && "Segmenter" in Intl ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : null;

/** The drawn cut: the prefix without the spaces and separators it ends in, then "…". */
export function cutText(prefix: string): string {
  return `${prefix.replace(TRAILING, "")}${ELLIPSIS}`;
}

/** The code-unit offsets where a cut may fall: after each grapheme, so a letter and its marks stay together. */
export function cutPoints(text: string): number[] {
  const points: number[] = [];
  if (graphemes != null) {
    for (const { index, segment } of graphemes.segment(text)) points.push(index + segment.length);
    return points;
  }
  let at = 0;
  for (const char of text) {
    at += char.length;
    points.push(at);
  }
  return points;
}

/**
 * The cut that fits `room`, or null when the whole text fits. `widthTo(end)` is the drawn width of the
 * text's first `end` code units; the longest prefix whose width and the "…" fit is found by binary search,
 * so a long part costs a handful of measurements, and the cut then drops its trailing spaces.
 */
export function fitCut(text: string, room: number, widthTo: (end: number) => number, ellipsis: number): string | null {
  const points = cutPoints(text);
  if (points.length === 0 || widthTo(text.length) <= room + 1) return null;
  let low = 0;
  let high = points.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (widthTo(points[mid - 1] ?? 0) + ellipsis <= room) low = mid;
    else high = mid - 1;
  }
  return cutText(text.slice(0, low === 0 ? 0 : points[low - 1]));
}

const registered = new Set<HTMLElement>();
const pending = new Set<HTMLElement>();
const ellipsisWidths = new Map<string, number>();
let observer: ResizeObserver | null = null;
let flushQueued = false;
let fontsWatched = false;
/** Only where the drawn cut can be hidden from screen readers (`content: … / ""`); elsewhere CSS's own "…" stays. */
const draws = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("content", '"" / ""');

function ellipsisWidth(style: CSSStyleDeclaration): number {
  const font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
  let width = ellipsisWidths.get(font);
  if (width == null) {
    const context = document.createElement("canvas").getContext("2d");
    if (context == null) return 0;
    context.font = font;
    width = context.measureText(ELLIPSIS).width;
    ellipsisWidths.set(font, width);
  }
  // 1px of slack, so a rounding in the canvas never lets the drawn "…" overflow.
  return width + (Number.parseFloat(style.letterSpacing) || 0) + 1;
}

/** Reads only: the cut an element's text needs now, null when it fits, undefined when it is not plain text. */
function measure(element: HTMLElement): string | null | undefined {
  const node = element.firstChild;
  if (node == null || node !== element.lastChild || node.nodeType !== Node.TEXT_NODE) return undefined;
  // Only a part that overflows is measured further.
  if (element.scrollWidth <= element.clientWidth + 1) return null;
  // A part that dropped to the hint's hidden second line (FLOW-168) is never seen: it is not cut.
  const part = element.parentElement;
  const first = part?.parentElement?.firstElementChild;
  if (part != null && first instanceof HTMLElement && part.offsetTop > first.offsetTop) return null;
  const text = node.textContent ?? "";
  const range = document.createRange();
  const widthTo = (end: number) => {
    range.setStart(node, 0);
    range.setEnd(node, end);
    // The bounding box, not the sum of the client rects: an overflowing text gives its cut fragment too.
    return range.getBoundingClientRect().width;
  };
  return fitCut(text, element.getBoundingClientRect().width, widthTo, ellipsisWidth(getComputedStyle(element)));
}

/** Every read first, then every write, so a long list lays out once. */
function flush(elements: Iterable<HTMLElement>) {
  const cuts = [...elements].filter((element) => element.isConnected).map((element) => [element, measure(element)] as const);
  for (const [element, cut] of cuts) {
    if (cut == null) element.removeAttribute("data-cut");
    else if (element.getAttribute("data-cut") !== cut) element.setAttribute("data-cut", cut);
  }
}

/** Measures the part in one batch with the others queued in this task, before the frame is drawn. */
export function queue(element: HTMLElement) {
  if (!draws) return;
  pending.add(element);
  if (flushQueued) return;
  flushQueued = true;
  queueMicrotask(() => {
    flushQueued = false;
    const elements = [...pending];
    pending.clear();
    flush(elements);
  });
}

/** Starts measuring a part (its first report from the shared observer measures it); returns the stop. */
export function watch(element: HTMLElement): () => void {
  if (!draws) return () => undefined;
  registered.add(element);
  if (typeof ResizeObserver !== "undefined") {
    // One observer for every hint part on the page.
    observer ??= new ResizeObserver((entries) => { flush(entries.map((entry) => entry.target as HTMLElement)); });
    observer.observe(element);
  } else {
    queue(element);
  }
  // Rubik loads with `font-display: swap`: a cut measured in the fallback font is measured again once it
  // arrives. The fonts read "loaded" until the first text that needs one is laid out, so `ready` alone
  // can miss it; every load that finishes later measures the parts again too, in one batch.
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fontsWatched && fonts != null) {
    fontsWatched = true;
    const again = () => {
      ellipsisWidths.clear();
      for (const part of registered) queue(part);
    };
    void fonts.ready.then(again);
    fonts.addEventListener("loadingdone", again);
  }
  return () => {
    registered.delete(element);
    pending.delete(element);
    observer?.unobserve(element);
  };
}
