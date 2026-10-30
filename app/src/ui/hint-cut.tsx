import { useLayoutEffect, useRef } from "react";

const ELLIPSIS = "…";
/** Spaces and punctuation that a cut never leaves before its "…" ("Quick …", "חשמל, …"). */
const TRAILING = /[\s\p{P}]+$/u;

/** The drawn cut: the prefix without the spaces and punctuation it ends in, then "…". */
export function cutText(prefix: string): string {
  return `${prefix.replace(TRAILING, "")}${ELLIPSIS}`;
}

/** The code-unit offsets where a cut may fall: after each grapheme, so a letter and its marks stay together. */
export function cutPoints(text: string): number[] {
  const points: number[] = [];
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    for (const { index, segment } of new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)) points.push(index + segment.length);
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
  return width + (Number.parseFloat(style.letterSpacing) || 0);
}

/** Reads only: the cut an element's text needs now, null when it fits, undefined when it is not plain text. */
function measure(element: HTMLElement): string | null | undefined {
  const node = element.firstChild;
  if (node == null || node !== element.lastChild || node.nodeType !== Node.TEXT_NODE) return undefined;
  // Only a part that overflows is measured further.
  if (element.scrollWidth <= element.clientWidth + 1) return null;
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

function queue(element: HTMLElement) {
  pending.add(element);
  if (flushQueued) return;
  flushQueued = true;
  // Before paint: a layout effect's microtask runs before the frame is drawn.
  queueMicrotask(() => {
    flushQueued = false;
    const elements = [...pending];
    pending.clear();
    flush(elements);
  });
}

function watch(element: HTMLElement) {
  registered.add(element);
  if (typeof ResizeObserver !== "undefined") {
    // One observer for every hint part on the page; its first report measures the part.
    observer ??= new ResizeObserver((entries) => { flush(entries.map((entry) => entry.target as HTMLElement)); });
    observer.observe(element);
  } else {
    queue(element);
  }
  // Rubik loads with `font-display: swap`: a cut measured in the fallback font is measured again once it
  // arrives. The fonts read "loaded" until the first text that needs one is laid out, so `ready` alone
  // can miss it; every load that finishes later measures the parts again too.
  const fonts = typeof document === "undefined" ? undefined : document.fonts;
  if (!fontsWatched && fonts != null) {
    fontsWatched = true;
    const again = () => {
      ellipsisWidths.clear();
      flush(registered);
    };
    void fonts.ready.then(again);
    fonts.addEventListener("loadingdone", again);
  }
}

function unwatch(element: HTMLElement) {
  registered.delete(element);
  pending.delete(element);
  observer?.unobserve(element);
}

/**
 * FLOW-172: a hint part's text, cut where it overflows at its last letter that fits with "…", never after
 * a space ("Quick…", not "Quick …"; CSS's own ellipsis cannot trim it). The text stays whole in the DOM,
 * so the part keeps its width and screen readers read all of it; the cut is drawn over it from `data-cut`
 * (css/02-fields-sheets.css). Only a part that overflows is measured, by one shared ResizeObserver.
 */
export function HintText({ text, dir }: { text: string; dir?: "auto" }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useRef(false);
  useLayoutEffect(() => {
    const element = ref.current;
    if (element == null) return;
    watch(element);
    return () => { unwatch(element); };
  }, []);
  // A new text in the same box is measured again: the observer reports only a new size.
  useLayoutEffect(() => {
    const element = ref.current;
    if (element == null) return;
    if (seen.current) queue(element);
    seen.current = true;
  }, [text]);
  return <span ref={ref} className="ui-hint-text" dir={dir} data-clip-ok="">{text}</span>;
}
